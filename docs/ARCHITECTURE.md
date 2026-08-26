# Architecture

MDTeX Studio is a local desktop-style application: a browser UI in front of a
local backend process. It is not a web service and nothing is exposed beyond the
machine it runs on.

---

## The split

```text
┌──────────────────────────────┐        ┌───────────────────────────────────┐
│  Browser (the UI)            │        │  Local backend (Node)             │
│                              │        │                                   │
│  editor                      │  HTTP  │  workspace on disk                │
│  live preview (KaTeX)        │◀──────▶│  latexmk / PDF templates          │
│  library, dialogs, menus     │ 127.0. │  MathJax + juice publishing       │
│  math fitting                │ 0.1    │  AI orchestration + tool layer    │
│  clipboard                   │ +token │  theme and settings storage       │
│                              │        │  formula and target caches        │
│  no filesystem               │        │                                   │
│  no process spawning         │        │                                   │
│  no publishing build         │        │                                   │
└──────────────────────────────┘        └───────────────────────────────────┘
```

The rule is simple: anything native belongs to the backend. The browser owns
interaction, the editor and the fast local preview, and reaches everything else
through `src/ui/api.js`. That is what makes the platform differences — paths,
process spawning, executable resolution, environment activation — invisible to
the frontend.

### Why the browser does the preview but not the publish

The live preview is KaTeX HTML: fast, incremental, selectable, and it never
leaves the page. Round-tripping every keystroke through a backend would be worse
in every way.

Publishing is different work: MathJax path-only SVG, CSS inlining, platform
adaptation, validation. It is expensive, it is not incremental, and doing it on
the browser's main thread is what used to freeze the editor. It now runs in the
backend process as a cancellable job. See
[WECHAT_RENDERING.md](WECHAT_RENDERING.md#performance) for the measurements.

A Web Worker was the other option. The backend won because the same work is
needed by the CLI, by AI tool calls and by the UI — one implementation serves
all three, and it is the implementation that was already correct.

---

## Security

- The server binds to `127.0.0.1` only.
- Every `/api` request must carry a per-session token, generated at startup and
  injected into the page when it is served.
- Requests whose `Host` or `Origin` is not a loopback address are refused, which
  closes the DNS-rebinding path.
- Only files under the workspace, data or cache directories can be read back
  through the build-artifact endpoint.
- Folder paths from the client are normalised and rejected if they escape the
  workspace root.
- Secrets live in `~/.config/publisher/secrets.env` at mode `0600` and are never
  returned to the UI — only a fingerprint.

All of the above is covered by `tests/backend-api.test.js`.

---

## Modules

### `src/core/` — platform-agnostic engine

| Module | Responsibility |
| --- | --- |
| `parser/` | markdown-it with footnotes and texmath (KaTeX) |
| `renderer/` | Markdown → HTML scoped under `#nice` |
| `code/` | highlight.js code blocks |
| `math/` | KaTeX preview rendering, MathJax publish SVG, formula cache, post-processor |
| `compiler/` | The publishing pipeline, CSS inlining, validation, plain-text extraction |
| `themes/` | Built-in and user theme loading, CSS variable resolution |
| `images/` | Image extraction and classification |
| `targets/` | Content-hash cache of compiled platform output |
| `exec/` | Cross-platform executable resolution and process spawning |
| `latex/` | Environment detection, Markdown → LaTeX, PDF templates |
| `pdf/` | latexmk driver and compiler-log parsing |
| `config/` | Configuration, preferences, backups, secret store |
| `diff.js` | Line diffing and unified diff output |
| `paths.js` | XDG-style paths, with Windows equivalents |

### `src/server/` — the local backend

| Module | Responsibility |
| --- | --- |
| `index.js` | HTTP server, routing, auth, static UI serving |
| `http.js` | Request helpers, path matching, loopback checks |
| `jobs.js` | Job manager: SSE progress, replayable event log, cancellation |
| `runtime.js` | Runtime handshake file (port + session token) |
| `routes/system.js` | Health, environment detection, preferences |
| `routes/workspace.js` | Article and folder lifecycle, assets, checkpoints |
| `routes/build.js` | Target and PDF builds, artifact serving |
| `routes/themes.js` | Theme and PDF-template CRUD |
| `routes/ai.js` | Connections, agent runs, the MCP tool callback |

### `src/ai/` — AI layer

| Module | Responsibility |
| --- | --- |
| `tools.js` | The tool definitions and the executor that stages every write |
| `session.js` | Task context, scopes and permissions, the run |
| `registry.js` | Connection profiles and the active backend |
| `backends/` | Local Claude Code, Remote ClaudeClaw, Anthropic API |
| `mcp-bridge.js` | stdio MCP server exposing the tool layer to the Claude Code CLI |

### `src/workspace/` — articles on disk

| Module | Responsibility |
| --- | --- |
| `article.js` | The article model; identity versus presentation |
| `library.js` | The collection: folders, move, duplicate, trash, search |
| `checkpoints.js` | Per-article snapshots |
| `blogpipe.js` | Blog Pipeline CLI detection and handoff |

### `src/ui/` — the browser application

| Module | Responsibility |
| --- | --- |
| `main.js` | Shell, editor, preview, wiring |
| `api.js` | The only place that talks to the backend |
| `state.js` | Shared state and a small event bus |
| `ui-kit.js` | Modals, context menus, toasts, form fields |
| `library-panel.js` | The article library |
| `properties-dialog.js` | Article properties |
| `settings-dialog.js` | Settings |
| `ai-panel.js` | Quick Connect, backend switcher, runs, diffs |
| `build-panel.js` | Target and PDF builds, PDF preview |
| `math-fit.js` | Display-mathematics fitting and overflow |
| `browser-compiler.js` | Preview-only Markdown rendering and validation |
| `snippets.js` | Snippet definitions and insertion |

---

## Publishing pipeline

```text
Markdown source
      │
      ▼  markdown-it + footnotes + texmath(KaTeX), highlight.js
Scoped HTML under #nice
      │
      ├─────────────── preview ──────────▶  KaTeX HTML, in the browser
      │
      ▼  replace <eq>/<eqn> with MathJax inline SVG   ← formula cache
HTML with path-only SVG formulas
      │
      ▼  platform adapter transform (div → section for WeChat)
      ▼  juice: inline the theme CSS in one pass
      ▼  platform adapter sanitize (drop classes, ids, scripts)
      ▼  validate (formula counts, images, dangerous markup)
      │
      ▼  cache under sha256(source + css + platform + mode + version)
Ready to copy
```

## PDF pipeline

```text
Markdown article                     LaTeX project
      │                                    │
      ▼ token-based Markdown → LaTeX       │
      ▼ selected PDF template              │
      ▼ materialise images into build dir  │
      │                                    │
      └──────────────┬─────────────────────┘
                     ▼
           latexmk, run in the project directory
           (multi-file, .sty, .bib, figures, reruns)
                     ▼
           parse the final .log for diagnostics
                     ▼
           PDF + log in <article>/dist/pdf/
```

## AI run

```text
User prompt + scope
      │
      ▼  MDTeX builds the task context (article, selection, environment,
      │  last build results) and grants the scope's permissions
      │
      ├── Anthropic API / ClaudeClaw ──▶ MDTeX runs the tool loop
      │                                   Messages API + tool definitions
      │
      └── Local Claude Code ───────────▶ the CLI runs its own loop
                                          MDTeX tools bridged over stdio MCP
      │
      ▼  every tool call executes in the same ToolExecutor
      ▼  writes are staged, never applied directly
      ▼  unified diffs returned to the UI
      ▼  user accepts → checkpoint, then write
```

---

## Jobs

Expensive backend work runs as a job:

- streams progress over Server-Sent Events, with a replayable event log so a
  client that connects late sees the whole story
- can be cancelled through an `AbortController` that reaches the child process
- keeps a bounded history so a chatty LaTeX build cannot grow without limit

This is what lets the UI show `Rendering formulas 18/143` with a working Cancel
button instead of appearing frozen.

---

## Caching

| Cache | Key | Location |
| --- | --- | --- |
| Formula | LaTeX + display mode + renderer version | `~/.cache/publisher/formulas/` |
| Target | source + theme CSS + theme name + platform + math mode + renderer version | `~/.cache/publisher/targets/` |

The formula cache is shared across articles, so a symbol used in fifty documents
is rendered once. The target cache is what makes Copy instant.

---

## Design decisions

**The backend owns everything native.** Not because a Web Worker could not
render formulas, but because the CLI and the AI tool layer need the same code.
One implementation, three callers.

**Identity is not presentation.** An article's ID, creation time and directory
name are fixed. Enforced server-side, so no client bug or malformed request can
rewrite them.

**Writes are staged.** AI edits produce diffs; nothing reaches disk until the
user accepts, and accepting checkpoints first.

**Preview and publish are different renderers on purpose.** KaTeX is right for a
live preview; MathJax path-only SVG is right for WeChat. Trying to use one for
both is how the old browser path ended up producing 5.9 MB of `foreignObject`
SVG that WeChat could not render.

**No prompt(), no confirm().** One dialog system, one context menu, one toast,
so every interaction looks and behaves the same.
