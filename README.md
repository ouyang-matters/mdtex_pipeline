# MDTeX Studio

A local writing and publishing workspace for long-form technical and
mathematical articles. Write in Markdown or LaTeX, preview live, compile a PDF,
and paste finished rich text into WeChat or Zhihu.

Everything runs on your machine. Nothing is uploaded anywhere.

---

## Install

**Linux / macOS**

```bash
git clone git@github.com:ouyang-matters/mdtex_pipeline.git
cd mdtex_pipeline
./install.sh
```

**Windows** (PowerShell)

```powershell
git clone git@github.com:ouyang-matters/mdtex_pipeline.git
cd mdtex_pipeline
.\install.ps1
```

Both installers set up the `publisher` command and put it on your PATH. There is
no environment to activate and no script path to type.

## Run

```bash
publisher start
```

Starts the local backend, serves the UI, and opens your browser.

---

## Commands

Identical on Windows and Linux:

```text
publisher start                                  launch MDTeX Studio
publisher init                                   create user directories and defaults
publisher doctor                                 full health check
publisher update                                 safe in-place update
publisher build <article-dir> --target pdf       compile a PDF
publisher build <article-dir> --target wechat    compile for WeChat
publisher version                                version and schema information
```

Also: `publisher validate`, `publisher latex`, `publisher themes`,
`publisher ws`, `publisher backups`.

---

## What it does

**Writing**

- Markdown and LaTeX, with a live preview and KaTeX mathematics
- An article library with folders, drag-and-drop, search, trash and restore
- Full article metadata: tags, series, language, publishing targets, themes
- Images by button, drag-and-drop at the cursor, or paste
- Snippets, auto-closing delimiters, quick-insert toolbar

**Publishing**

- **WeChat** — inline path-only SVG mathematics that survives the WeChat editor,
  theme CSS flattened into inline styles, validated formula counts
- **Zhihu** — a separate adapter for Zhihu's editor
- **PDF** — `latexmk` locally, from the UI. Markdown goes through a
  deterministic Markdown → LaTeX conversion into a selectable template; LaTeX
  projects are compiled as they are, with multi-file `\input`, local `.sty`,
  bibliographies, figures and reruns
- Compilation and copying are separate: the expensive work is cached, runs off
  the UI thread, reports progress and can be cancelled

**AI**

- Quick Connect for Local Claude Code, Remote ClaudeClaw or the Anthropic API,
  right in the AI panel
- All three get the same tools: read the source and selection, apply scoped
  patches, edit themes, compile PDFs, read compiler logs, validate WeChat output
- Every change arrives as a diff and is checkpointed before it is applied

---

## Requirements

Node 18+ (22 recommended). LaTeX and an AI connection are optional — both show a
setup state rather than failing.

---

## Data layout

```text
Application (this repo):  src/, themes/builtin/, tests/, scripts/
Configuration:            ~/.config/publisher/
Workspace and themes:     ~/.local/share/publisher/
Cache:                    ~/.cache/publisher/
```

Updates only touch the application directory. Your articles are never modified.

---

## Documentation

Start with [Current Status](docs/CURRENT_STATUS.md) — it lists exactly what
works in the UI, what is command-line only, and what is not built yet.

- [Installation](docs/INSTALLATION.md)
- [Workspace and UI](docs/WORKSPACE.md)
- [LaTeX and PDF](docs/LATEX_AND_PDF.md)
- [WeChat Rendering](docs/WECHAT_RENDERING.md)
- [AI Connections](docs/AI_CONNECTIONS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Theme Guide](docs/THEME_GUIDE.md)
- [Platform Compatibility](docs/PLATFORM_COMPATIBILITY.md)
- [Blog Pipeline Integration](docs/BLOG_PIPELINE_INTEGRATION.md)
- [Updating](docs/UPDATING.md) · [Data Layout](docs/DATA_LAYOUT.md) · [Migrations](docs/MIGRATIONS.md)
- [Development log](docs/DEVLOG.md)

---

## Testing

```bash
npm test                       # 205 unit tests
node scripts/e2e.js            # drive the built UI in real Chrome
node scripts/bench-wechat.js   # measure both WeChat compilation paths
publisher doctor               # full system health check
```

## License

MIT
