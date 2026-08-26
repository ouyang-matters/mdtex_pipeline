# AI Connections

MDTeX can drive Claude in three ways. All three get **the same editing
capabilities**, because MDTeX — not the connection — owns the tools, the
permissions, the validation, the diffs and the checkpoints.

---

## Quick Connect

When no connection is configured, the AI panel *is* the connection flow. Open
the AI panel and the three options are on screen immediately, with local
detection already done:

```text
Local Claude Code      detected      Use the Claude Code CLI already signed in on this machine.
Remote ClaudeClaw                    Connect to a ClaudeClaw worker over HTTP or an SSH tunnel.
Anthropic API                        Use an Anthropic API key directly.
```

No trip through Settings, no restart. Once a connection is saved it becomes
active immediately and the panel turns into a chat against the open article.

### Local Claude Code

Nothing to enter. MDTeX looks for the `claude` command on PATH plus the usual
npm and nvm bin directories, runs a real print-mode round trip to confirm the
CLI is *authenticated* (not merely installed), and activates it.

If the command is not found, the dialog says where MDTeX looked and offers
**Check again**, so installing Claude Code in another terminal does not require
restarting MDTeX.

### Remote ClaudeClaw

A compact form: connection name, transport, endpoint, workspace, auth header and
token, and model.

| Transport | What MDTeX does |
| --- | --- |
| `http` | Talks to `http://<host>:<port><basePath>` directly. |
| `ssh` | Opens `ssh -N -L <local>:<remote-host>:<remote-port> <target>` and talks HTTP over the tunnel. A worker bound to loopback on a remote machine is reachable without exposing it to the network. |

**Test Connection** runs before the profile can be saved; the Save button stays
disabled until a test succeeds. The token goes to the local secret store, never
into the profile file.

### Anthropic API

API key, model and effort level. **Test Connection** performs a real 16-token
round trip, which proves the key, the network and access to the chosen model.

The key is written to `~/.config/publisher/secrets.env` with owner-only
permissions and **is never shown again**. The UI only ever sees a fingerprint
like `sk-ant-…a1b2`, which is enough to tell two keys apart and useless to
anyone who sees it. The backend test asserts that the key does not appear in any
API response.

---

## Switching backends

The AI panel header shows the active connection and is itself the switcher:

```text
● Local Claude Code   Local Claude Code   ▾        claude-opus-5   ⚙
```

Switching is a config write plus a cache drop. It takes effect on the next
message — **no application restart**, which is asserted by the backend tests.

Use Local Claude for small edits and Remote ClaudeClaw for a larger task without
opening Settings.

---

## The tool layer

MDTeX builds the task context and exposes a controlled set of tools. The model
never sees the filesystem and never talks to the editor directly.

| Tool | Permission | What it does |
| --- | --- | --- |
| `read_source` | read | The open source, plus the active selection |
| `read_metadata` | read | Title, language, tags, series, targets, themes, templates |
| `read_theme` | read | A theme stylesheet |
| `list_assets` | read | Images and files in the article |
| `read_build_log` | read | The most recent PDF compiler log |
| `apply_patch` | write:content | Replace an exact, unique span of the source |
| `write_source` | write:content | Replace the whole source (conversions only) |
| `write_theme` | write:theme | Replace a **user** theme's CSS |
| `update_metadata` | write:metadata | Editable metadata fields only |
| `compile_pdf` | build | Compile locally and return parsed errors |
| `render_wechat` | build | Compile for WeChat and return validation results |
| `blogpipe_check` | publish:check | Read-only Blog Pipeline detection and status |

### Context

Assembled by MDTeX, identical for every backend:

```text
## Current MDTeX state
- Article: "Bayesian Notes" (id 9db815…, markdown, source.md)
- Language: zh-CN
- Tags: stats, bayes
- Publish targets: wechat, pdf
- WeChat theme: default
- PDF template: default (xelatex)
- Editor buffer: 425 lines, 20387 characters
- The user has selected 218 characters (offsets 1204–1422).
  Unless told otherwise, scope your edit to that selection.
- Preview target: wechat
- LaTeX: TeX Live, engines xelatex, lualatex, pdflatex
- Last PDF build: failed with 1 error(s)

## This run
- Scope: Fix compile errors
- Read the build log, find the cause of the failure, apply the smallest fix …
```

### Scopes

The scope you pick decides which tools the run is granted. A run cannot exceed
its scope: a denied tool returns an error to the model explaining why.

| Scope | Grants |
| --- | --- |
| Edit content | read, write content, build |
| Edit theme CSS | read, write theme, build |
| Edit article info | read, write metadata |
| Convert Markdown → LaTeX | read, write content, build |
| Convert LaTeX → Markdown | read, write content, build |
| Fix compile errors | read, write content, build |
| Fix WeChat output | read, write content, write theme, build |
| Review only | read, build, publish check — **no write tools at all** |

### Safety

- **Staged, never silent.** Writes accumulate in the run and are shown as a
  unified diff with `+`/`−` counts. Nothing reaches disk until you press Apply.
- **Checkpointed.** Applying takes a snapshot into `<article>/.checkpoints/`
  first, so every AI edit is one click from being undone.
- **`apply_patch` is strict.** The target text must appear exactly once; zero or
  multiple matches return an error telling the model to include more context.
  It cannot make an edit it did not precisely locate.
- **Built-in themes are read-only.** `write_theme` refuses and suggests
  duplicating the theme first.
- **Identity is immutable.** `update_metadata` cannot change an article's ID or
  creation time.

---

## How each backend runs

The split is deliberate: two backends can use MDTeX's own agent loop, and the
third brings its own — so it is given the same tools over MCP instead.

### Anthropic API and Remote ClaudeClaw

MDTeX runs the loop. Each turn is a streaming Messages request carrying the tool
definitions; every `tool_use` block is executed by the shared `ToolExecutor` and
returned as a `tool_result`. ClaudeClaw is the same client pointed at a
different base URL, which is what guarantees identical behaviour.

Adaptive thinking is enabled with a configurable effort level. Requests stream,
so long turns do not hit an HTTP timeout and text appears as it arrives.

### Local Claude Code

Claude Code runs its own agent loop, so MDTeX hands it the tool layer instead:
`src/ai/mcp-bridge.js` is a stdio MCP server that proxies every `tools/call`
back into the running backend, into the same `ToolExecutor`.

```text
claude --print --mcp-config {mdtex: node src/ai/mcp-bridge.js}
       --strict-mcp-config --allowedTools mcp__mdtex
       --disallowed-tools Bash,Edit,Write,Read,Glob,Grep,…
```

Claude Code's own filesystem and network tools are switched off: the agent
reaches the article only through MDTeX's tools, with MDTeX's permissions.

The bridge receives the backend URL, the session token and the run id through
its environment, so no secret appears in a process listing. The prompt goes over
stdin — the CLI's tool-list options are variadic and would otherwise absorb a
trailing prompt argument.

---

## Configuration on disk

`~/.config/publisher/ai.json`:

```json
{
  "version": 1,
  "activeProfileId": "a1b2c3d4",
  "profiles": [
    {
      "id": "a1b2c3d4",
      "type": "anthropic-api",
      "name": "Anthropic API",
      "model": "claude-opus-5",
      "effort": "high",
      "secretKey": "ANTHROPIC_API_KEY_A1B2C3D4",
      "createdAt": "2026-08-25T21:00:00.000Z",
      "lastTestedAt": "2026-08-25T21:00:04.000Z",
      "lastTestOk": true
    }
  ]
}
```

Profiles reference a secret by **name**. Values live in
`~/.config/publisher/secrets.env`, mode `0600`. Deleting a profile deletes its
secret.

An `ANTHROPIC_API_KEY` in the environment takes precedence over the stored one,
which is convenient in a shell but means a stale environment variable can shadow
a key you just entered.

---

## Diagnosing

```bash
publisher doctor
```

reports whether the Claude Code CLI was found, how many connections are
configured, which is active, each one's key fingerprint, and when it was last
tested successfully.
