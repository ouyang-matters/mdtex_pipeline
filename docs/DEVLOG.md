# Development Log

## 2026-08-17 — Phase 1 Complete

### Goal

Build a standalone local publishing pipeline for Markdown + LaTeX articles targeting WeChat Official Account (primary) and Zhihu (secondary). Phase 1 focuses on the compiler, live preview UI, and rich-text clipboard — not automatic publishing.

### Research

Studied three reference projects before implementation:

**mdnice/markdown-nice** (GPL-3.0, ~4.7k stars)
- React + MobX, markdown-it with 11+ plugins (7 custom), MathJax for math rendering
- Themes are CSS strings scoped under `#nice`, inlined with juice on export
- Clipboard copy uses `document.execCommand('copy')` with hidden input workaround to set `text/html` MIME type
- Code highlighting via highlight.js with `\n` → `<br>` and space → `&nbsp;` conversion for WeChat
- GPL-3.0 license — cannot derive code, only study patterns

**doocs/md** (WTFPL, ~11k stars)
- Vue 3 monorepo, marked parser, MathJax `tex2svg()` for SVG math output
- Extensive WeChat clipboard pipeline: DOM cloning, SVG flattening (expand markers, bake gradients, remove `<defs>`), list nesting fix (`<ul>` outside `<li>`), font sanitization, dark→light mode re-render
- 12 image upload providers, 73 code themes, marketplace themes
- Much more complex than needed for Phase 1 but good architectural reference

**Automattic/juice** (MIT, ~3.3k stars)
- CSS inliner using cheerio + PostCSS, handles specificity correctly (4-tuple vector)
- Resolves CSS variables by walking the DOM tree
- Strips `<style>` tags after inlining, configurable preservation of media queries/keyframes/font-faces
- Supports pseudo-element inlining (`::before`/`::after` → `<span>`)
- Perfect fit for WeChat publishing (designed for exactly this "inline everything" pattern)

Findings recorded in `docs/REFERENCE_ANALYSIS.md`.

### Architecture Decisions

1. **Parser**: markdown-it (proven by mdnice, more pluggable than marked)
2. **Math**: KaTeX for Phase 1 (deterministic, fast, no DOM dependency). MathNode abstraction reserves `renderedSvg` field for Phase 2 SVG fallback if KaTeX HTML proves unreliable on WeChat.
3. **CSS inlining**: juice with WeChat-optimized options (`removeStyleTags`, `resolveCSSVariables`, `inlinePseudoElements`, no preserved media queries/keyframes/font-faces)
4. **Theme scoping**: `#nice` root (mdnice-compatible, enables theme reuse)
5. **Platform adapters**: Thin adapter pattern — one shared renderer, platform-specific transform/sanitize/validate methods
6. **UI**: Vanilla JS + Vite (no framework needed for a dual-pane editor)

### Implementation

Built smallest vertical slice first:
```
Markdown → parse → KaTeX → CSS theme → inline CSS → WeChat HTML → preview → clipboard
```

Then added Zhihu adapter, validation, CLI, tests, and documentation.

**Core pipeline** (`src/core/`):
- `parser/` — markdown-it configured with footnote and texmath (KaTeX) plugins
- `renderer/` — Custom fence/code_block renderers, output scoped under `<div id="nice">`
- `math/` — MathNode class with sourceLatex/displayMode/renderedHtml/renderedSvg/error fields
- `code/` — highlight.js wrapper producing deterministic HTML with language labels
- `images/` — ImageNode classification (local/remote), path resolution, ImageUploader interface
- `themes/` — File-based theme loading, CSS variable resolution, theme listing
- `compiler/` — Pipeline orchestration, juice CSS inlining, validation pass

**Platform adapters** (`src/platforms/`):
- `WeChatAdapter` — `<div>` → `<section>` transform, strips classes/IDs/event handlers, mobile CSS overrides
- `ZhihuAdapter` — Adds `target="_blank"` to links, strips IDs but keeps classes, different sanitization rules

**UI** (`src/ui/`, `index.html`):
- Dual-pane layout: textarea editor + live preview
- Theme and platform dropdowns
- Rich-text clipboard copy via `navigator.clipboard.write()` with `ClipboardItem` (text/html + text/plain)
- DOM-based CSS inlining for browser-side export (DOMParser + style application)
- File open, HTML export, CSS reload, diagnostics bar

**CLI** (`src/cli/`):
- `publisher build article.md --target wechat --theme default`
- `publisher validate article.md --target wechat`
- `publisher themes`
- `publisher preview article.md`

**Themes** (`themes/`):
- `default.css` — Clean neutral style, system font stack, GitHub-inspired code colors
- `academic-orange.css` — Warm academic style, Georgia/serif fonts, orange accents, dark code blocks

### Testing

53 tests across 4 suites:
- `parser.test.js` — Headings, paragraphs, bold/italic, lists, nested lists, blockquotes, links, images, tables, horizontal rules, inline code, fenced code blocks, Chinese text, source preservation
- `math.test.js` — Inline math, display math, aligned equations, MathNode class, invalid LaTeX handling, math expression counting, complex math rendering
- `compiler.test.js` — Renderer output (#nice scoping, code blocks, headings), CSS inlining (basic styles, nested selectors, style tag removal), validator (element counting, script/iframe detection, CSS variable warnings, local image warnings), full compiler (WeChat/Zhihu targets, fixture article, content preservation, theme switching)
- `platforms.test.js` — WeChat adapter (sanitization, class removal, event handler removal, CSS overrides), Zhihu adapter (ID removal, target="_blank", details warning), content preservation after sanitization

### Fixture Article

`tests/fixtures/math_article.md` — A real technical article about variational inference containing:
- Chinese and English prose
- 12 headings (h1–h3)
- 27 paragraphs
- 37 math expressions (9 display, 28 inline) including aligned equations and underbrace
- 1 Python code block with docstring
- 1 table (3 columns, 3 rows with inline math)
- 4 links
- 2 footnotes with full citations
- 1 image reference
- Blockquotes used as theorem-like boxes
- Nested lists (ordered and unordered)

Compiles successfully for both WeChat and Zhihu with both themes. All content preserved (verified programmatically).

### Known Limitations

1. KaTeX HTML has alignment issues on WeChat for complex formulas — resolved by rendering publish output with MathJax SVG
2. WeChat images must be on its CDN — MDTeX flags them with warnings; an API uploader is not built
3. WeChat may break nested lists (`<ul>` inside `<li>`) — doocs/md restructures these
4. Code block whitespace may collapse on WeChat in edge cases — mdnice converts to HTML entities
5. Rich-text clipboard requires secure context (HTTPS/localhost)
6. Browser-side CSS inlining (DOM-based) was less precise than juice and far slower — removed; all publishing now runs in the backend with juice

---

## 2026-08-25 — Local backend, desktop-style UI, and the WeChat performance work

### The problem

Four things were broken or missing at once, and they turned out to share a root
cause: the browser was being asked to do work it cannot do.

1. **PDF compilation did not exist in the UI.** Pressing the button printed
   "PDF compilation from the browser UI requires a backend server (planned)".
2. **Articles lived in `localStorage`**, disconnected from the workspace the CLI
   managed on disk.
3. **Article management used `window.prompt()` and `window.confirm()`** — for
   creating articles, folders, renaming, and every destructive action.
4. **Copying to WeChat stalled the editor**, and the output it produced was not
   something WeChat could render anyway.

### What was built

A local backend (`src/server/`) bound to `127.0.0.1`, authenticated with a
per-session token, that owns every native capability: the workspace on disk,
`latexmk`, the MathJax/juice publishing pipeline, AI orchestration. The browser
reaches all of it through one module, `src/ui/api.js`.

Expensive work runs as a job with Server-Sent Events progress and a working
Cancel button, which is what lets the UI show `Rendering formulas 18/143`
instead of appearing frozen.

### Profiling the WeChat freeze — and a false start worth recording

The first reproduction ran the old browser path under jsdom and reported the
CSS-inlining stage taking **over 274 seconds**. That looked like a smoking gun.
It was wrong: jsdom's `getComputedStyle` is pathologically slow, and no user ever
experienced that. The lesson is that a DOM emulator is not a browser, and a
performance claim made in one does not transfer.

Rebuilding the benchmark to drive real Chrome over the DevTools Protocol
(`scripts/lib/chrome.js`, no new dependency — Node 22 ships a WebSocket client)
gave the real picture. At 572 formulas:

| | Old | Now |
| --- | ---: | ---: |
| Cost per press of Copy | 1908 ms, all blocking | 150 ms |
| Worst single main-thread stall | 1086 ms | 66 ms |
| Output | 23.61 MB | 3.22 MB |

The dominant cost was `math-to-image.js` embedding a complete copy of
`katex.min.css` (24.7 KB) inside **every** formula's `foreignObject` data URI.
The CSS inliner's `getComputedStyle`-per-element sweep was secondary — 166 ms,
not the headline.

Worth being precise about what improved: cold wall-clock compilation is
*slower* now at scale (2191 ms against 1518 ms), because MathJax path-only SVG
is more work than wrapping KaTeX HTML in a `foreignObject`. It is also the only
one of the two that WeChat renders. What changed is that the work no longer
blocks the UI, is cancellable, is cached, and produces 7x smaller output — and
that a repeat Copy costs nothing at all.

The measurement harness needed fixing too: the first version stopped its
`requestAnimationFrame` sampler when the measured function resolved, which
happens in a microtask, before any frame. A fully blocked run therefore reported
a stall of 0 ms. The sampler now runs one frame past the end.

### Bugs found by testing real software

Every one of these was invisible to unit tests and surfaced only by driving the
actual browser or the actual CLI:

- **Stray vertical scrollbars beside every equation.** All three built-in themes
  set `overflow-x: auto` on `.katex-display`. CSS promotes a `visible` axis to
  `auto` when the other axis is not `visible`, so that produced a vertical
  scrollbar on content that overflowed by a few pixels.
- **The word "null" in the article header.** `Node.append()` stringifies `null`,
  so a `cond ? node : null` argument rendered as text. Fixed with a null-safe
  `mount()` helper.
- **Modals rendered in the top-left corner.** The universal reset zeroed the
  UA's `margin: auto` on `<dialog>`, which is what centres a modal.
- **Display equations cropped once their container hid overflow.**
  `transform: scale()` shrinks what is painted but not the layout box, so the
  container still measured the equation at full width. Fixed with a `.math-sizer`
  element carrying the painted dimensions.
- **`latexmk` produced an `.xdv` and no PDF.** This machine has `latexmk` and
  `xelatex` in `/usr/bin` but `xdvipdfmx` only under
  `/usr/local/texlive/2024/bin/x86_64-linux`, which is not on PATH. Detection now
  collects every directory a TeX binary was found in and prepends all of them to
  the build's PATH.
- **`claude --print` hung waiting for stdin.** The spawn helper left the child's
  stdin open.
- **The prompt vanished into the tool list.** `--allowedTools` and
  `--disallowed-tools` are variadic, so a trailing positional prompt was absorbed
  into them. The prompt now goes over stdin.
- **`listings` could not load `Rust`, `Go` or `JavaScript`.** The package
  predates them. MDTeX now only emits a `language=` option for languages that are
  actually defined, and defines the modern ones in the template preamble.

### Decisions

**Backend, not Web Worker.** A worker could render formulas off the main thread,
but the CLI and the AI tool layer need the same pipeline. One implementation
serving three callers beat a second copy of it in a worker.

**Compile and Copy are separate operations.** The expensive step caches against
a content hash of everything that can change the bytes. Copy writes bytes that
already exist, from memory, so the clipboard write is synchronous with the click
— which is also what browsers require for a rich-text `clipboard.write()`.

**MDTeX owns the AI tools, not the connection.** The Anthropic and ClaudeClaw
backends share MDTeX's tool loop. Claude Code brings its own loop, so it gets the
same tools over a stdio MCP bridge instead, with its own filesystem tools
switched off. All three end up in the same `ToolExecutor`, so permissions,
validation, diffs and checkpoints are identical.

**Identity is enforced server-side.** An article's ID, creation time and
directory name cannot be changed by any request. The properties dialog shows
them read-only with an explanation, so renaming is obviously safe.

---

## 2026-08-26 — Windows installer: stderr is not failure

### The report

`.\install.ps1` aborted during "Installing dependencies..." with:

```text
node.exe : npm warn deprecated whatwg-encoding@3.1.1 ...
At C:\Program Files\nodejs\npm.ps1:29 char:3
... FullyQualifiedErrorId : NativeCommandError
```

npm had exited 0. Nothing had actually failed.

### Two traps, both stepped in at once

1. **PowerShell prefers the `.ps1`.** npm ships `npm.cmd` *and* `npm.ps1` side
   by side, and PowerShell's command discovery ranks an ExternalScript above an
   Application. So `& npm install` runs npm.ps1, which invokes `node.exe` from
   inside a PowerShell scope that inherits the caller's
   `$ErrorActionPreference`. Confirmed directly — `Get-Command npm` returns the
   `.ps1` even on Linux, which is why the fix is testable off Windows.

2. **Windows PowerShell 5.1 turns native stderr into ErrorRecords.** Under
   `'Stop'` the first one is terminating. The installer's `2>&1` on several
   calls made this certain rather than merely likely.

A third, newer trap was found while testing: PowerShell 7.3+ can turn a non-zero
*exit code* into a terminating error via
`$PSNativeCommandUseErrorActionPreference`, which would rob the installer of the
chance to print its own message.

### An honest note on reproduction

PowerShell 7 does **not** reproduce trap 2 — stderr no longer becomes
ErrorRecords there. This bug only fires in Windows PowerShell 5.1, which is what
`powershell.exe` and "Run with PowerShell" give you. Anyone testing the
installer with `pwsh` would never see it. The regression tests therefore assert
the properties that hold on both engines, and the simulated-installer test
records which engine it observed rather than pretending 5.1 semantics exist
everywhere.

### The fix

`scripts/windows/NativeCommand.ps1`, dot-sourced by the installer:

- `Resolve-NativeCommand` walks PATHEXT order with `.ps1` removed and uses
  `Get-Command -CommandType Application`, so a script cannot be selected even
  by accident.
- `Invoke-NativeCommand` relaxes both preference traps in **function scope**,
  runs the command, reads `$LASTEXITCODE`, restores the preferences, and returns
  a result object. It never throws because of output.
- The installer keeps `$ErrorActionPreference = 'Stop'` globally, prints npm's
  deprecation warnings, and fails only on a non-zero exit code.

The generated `publisher.ps1` shim got the same treatment: `publisher doctor`
writes diagnostics to stderr, which would have hit trap 2 in a user's strict
session.

### A related defect in the Node spawner

Reviewing the same class of problem for `latexmk` and `xelatex` — which the
installer does not run, but our Node code does — turned up a real Windows bug:
`runCommand` used `spawn(..., { shell: false })`, and `CreateProcess` cannot
execute a `.bat` or `.cmd` file. npm installs its global binaries as `.cmd`
shims, so `claude.cmd` would never have started on Windows, and a
Strawberry-Perl `latexmk.bat` likewise. Those are now launched through
`cmd.exe /d /s /c` with explicit quoting, with the program always quoted so the
command-line shape does not depend on whether a particular install path happens
to contain a space.

`publisher update` needed no change: it uses `execSync`, which already goes
through `cmd.exe` and only throws on a non-zero exit.

### Testing

Two dependency-free PowerShell suites (no Pester) plus static and unit checks in
`tests/windows-installer.test.js`, which run everywhere and execute the
PowerShell suites when a PowerShell is available. The tests found two real
defects of their own while being written: `Get-NativeCommandCandidateName`
returned a bare string instead of a one-element array, because PowerShell
unwraps `@('npm')` on return; and the executable path was only quoted when it
happened to contain a space.

`install.sh` is byte-identical, and a test asserts it stays that way.

---

## Article assets: one reference, every target

An imported image was invisible in the live preview, and a PDF built from the
same article reported `image not found`. Both symptoms had the same root cause,
and it was not a path bug in either renderer: there was no single answer to the
question *"what does `assets/figure-01.png` mean?"* Each target had improvised
one.

The fix is a canonical rule rather than per-target repairs. Article source
always carries an **article-relative POSIX path** under `assets/`, and every
target resolves it through one shared `AssetResolver` (`src/core/assets/`).
`docs/WORKSPACE.md` has the per-target table.

### Reproducing it first

The preview was straightforward once observed rather than assumed: `<img
src="assets/figure-01.png">` resolves against the *page* origin, so the browser
requested `http://127.0.0.1:PORT/assets/figure-01.png`, got the SPA's index
document back, and rendered nothing. The article directory was never involved.

The PDF was more interesting, because for saved articles it *worked* — across
plain, nested, spaces-in-folder, Chinese-title and native-LaTeX configurations.
The failure was the unsaved-buffer case, where the image was dropped and the
build still reported success. That is the worse of the two bugs: a PDF that
compiles without its figures looks fine until someone reads it.

So unresolvable assets are now a hard build failure with a diagnostic that names
the reference, the article root and the exact path that was expected — any
remaining trigger becomes immediately diagnosable instead of silent.

### Two bugs found by looking rather than reasoning

**The preview raced itself.** The DOM rewrite pointed each `<img>` at the
backend *after* `innerHTML` had already assigned the raw `assets/…` path. The
browser starts loading the moment the attribute is parsed, so every render fired
one request guaranteed to fail, and that doomed request's `error` event could
arrive after the rewrite and mark a perfectly good image as missing. The rewrite
now happens on the rendered HTML string, inside an inert `<template>`, before it
reaches the document — the losing request is never started. It still applies to
the rendered HTML only; the preview URL never enters the article source.

**`compileArticleToPdf` silently compiled nothing.** Its subject is a plain
descriptor carrying `source`, so an unsaved editor buffer can be compiled — but
the parameter is named `article`, and a workspace `Article` keeps its text on
disk and exposes `readSource()`. Passing a real `Article` made `article.source`
`undefined`, `?? ''` turned that into an empty document, and the build reported
success. Every shipped caller (UI route, CLI, AI tools) passes a descriptor, so
this never reached a user, but it is exactly the trap that produces a
figure-less PDF. `subjectSource()` now accepts either.

Both were found by driving the real thing — a real browser, a real latexmk —
and inspecting the output, not by reading the code and reasoning about it.

### A note on fixtures

The preview investigation cost an extra cycle to a self-inflicted wound: the PNG
used to reproduce it was hand-fabricated base64 with a broken CRC and an IDAT
that would not inflate. MDTeX was right and the fixture was wrong — the file was
stored, served with a 200, and failed to decode in the browser. Test images are
now generated programmatically.

It did surface a genuine defect, though: an image that exists but cannot be
decoded reported "Image not found", sending the reader to look for a file that
was already there. That case now says the file is on disk and is not a readable
image.

### Verification

`node scripts/workflow-check.js` now asserts that the image dragged in at step 8
is carried into the PDF — `\includegraphics` present and the file copied into
the build directory. "It compiled" is not evidence that it compiled correctly.
