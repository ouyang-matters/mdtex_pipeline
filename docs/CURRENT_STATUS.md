# Current Status

## What Is Working

### Core Publishing Pipeline
- Markdown + LaTeX rendering with KaTeX (preview) and MathJax (publish)
- Inline SVG formula output for WeChat (no data-URI images, no external CSS)
- CSS inlining via juice with theme CSS variable resolution
- Platform adapters: WeChat and Zhihu
- Formula count validation (source count = rendered count)
- SVG and PNG formula output modes

### Article Workspace
- Multi-article library with folder organization
- Create, rename, search, import articles
- Stable article IDs across renames and moves
- Markdown and LaTeX source format support
- Asset management with safe filenames
- Article metadata (title, tags, series, targets, theme)

### Themes and Styles
- Three built-in themes: Classic (default), Minimal, Modern
- Custom CSS editor in the UI with live preview
- Custom styles persisted in localStorage (browser) and user data dir (CLI)
- Built-in styles read-only; user styles editable
- Styles scoped to `#nice` container

### Installation and Updates
- `./install.sh` (Linux/macOS), `.\install.ps1` (Windows PowerShell)
- Safe in-place updates with automatic backup
- Config migration with unknown-key preservation
- Rendering regression selftest during update

### AI Backends (Interface Ready)
- LocalClaudeCodeBackend: invokes installed Claude Code CLI
- RemoteClaudeClawBackend: connects via HTTP or SSH
- Scope constraints: content-only, theme-only, metadata-only edits

### Blog Pipeline Integration (Interface Ready)
- Detects `blogpipe` CLI in PATH
- Hands off source, metadata, assets to blog pipeline for deployment
- MDTeX does not reimplement deployment, sync, or rollback

## How To

### Install
```bash
git clone git@github.com:ouyang-matters/mdtex_pipeline.git
cd mdtex_pipeline
./install.sh          # Linux/macOS
.\install.ps1         # Windows PowerShell
```

### Launch the UI
```bash
cd /path/to/mdtex_pipeline && npm run dev
# Open http://localhost:3000
```

### Create and Search Articles
```bash
publisher ws create "My Article"
publisher ws create "Paper" --format latex --folder research
publisher ws list
publisher ws search "bayesian"
publisher ws import existing-article.md
```

### Compile for WeChat
```bash
publisher build article.md --target wechat
publisher build article.md --target wechat --math png  # PNG fallback
```

### Compile for Zhihu
```bash
publisher build article.md --target zhihu
```

### Manage Themes
```bash
publisher themes list
publisher themes copy default my-custom
# Edit ~/.local/share/publisher/themes/my-custom.css
```

### System Maintenance
```bash
publisher doctor        # Full health check
publisher update        # Safe in-place update
publisher version       # Version and schema info
publisher backups list  # List backups
```

## Math Rendering

Dual-renderer architecture:
- **Preview**: KaTeX HTML (fast, selectable text)
- **Publish**: MathJax `tex2svg()` → inline SVG with `<path>` elements

Publishing output: Formulas are embedded as inline `<svg>` elements directly
in the HTML (mdnice-style), not as `<img src="data:...">` tags. This survives
WeChat paste because the SVGs contain only `<path>` elements with no external
CSS, font, `<defs>`, `<use>`, `id`, or `class` dependencies.

Formula cache: `~/.cache/publisher/formulas/` with SHA-256 content-hash keys.

### Compile PDF
PDF compilation requires a LaTeX distribution (TeX Live / MiKTeX):
```bash
# LaTeX projects: latexmk compiles main.tex
# Markdown projects: converted to LaTeX intermediate first
```

### AI Editing
The AI panel is in the bottom panel (click "AI" button). Backends:
- **Local**: Uses installed Claude Code CLI (`claude`)
- **Remote**: Connects to ClaudeClaw worker via HTTP/SSH
- Configure in `~/.config/publisher/config.json`

### Blog Pipeline
If `blogpipe` CLI is installed, articles can be handed off for deployment.
MDTeX delegates to blog-pipeline for GitHub sync, releases, and deployment.

## Workspace UI Features

- **Three-pane layout**: Library (left) + Editor (center) + Preview (right)
- **Article library**: Create, search, rename, delete articles
- **Folder organization**: Create folders, organize articles
- **Drag-and-drop images**: Drop images onto editor to insert
- **Clipboard paste images**: Paste screenshots directly into editor
- **Image button**: Insert images via file chooser
- **Bottom panel with tabs**: CSS Editor, AI Assistant, Build Output
- **Style editor**: Live CSS editing with Save/SaveAs/Duplicate/Rename/Delete
- **Target selector**: Switch between WeChat and Zhihu preview
- **Library toggle**: Collapse sidebar for more editor space

## Incomplete / Planned

| Feature | Status |
|---------|--------|
| PDF preview in UI | Backend implemented, UI preview pending |
| Blog pipeline publish button | Interface defined, needs blogpipe CLI |
| AI Claude Code integration | Backend implemented, needs local claude CLI |
| WeChat image CDN upload | Upload interface defined, API not implemented |
| Full-text article search | Title/tag search implemented, body search pending |

## Known WeChat Rendering Limitations

1. Inline SVG formulas are the most compatible approach, but some very old WeChat
   versions may not render inline SVG. Use `--math png` as fallback.
2. WeChat content images must be on WeChat CDN (manual upload for now).
3. Custom fonts are not available in WeChat articles.
4. `position: fixed/absolute` is unreliable in WeChat.
5. Very wide equations scroll horizontally on mobile (by design, not clipped).

## CLI Commands

| Command | Description |
|---------|-------------|
| `publisher build <file>` | Compile for a target platform |
| `publisher validate <file>` | Validate without compiling |
| `publisher preview [file]` | Start preview UI info |
| `publisher themes list` | List all themes |
| `publisher themes copy <src> <dst>` | Copy theme for customization |
| `publisher ws create <title>` | Create a new article |
| `publisher ws list` | List articles |
| `publisher ws search <query>` | Search articles |
| `publisher ws import <file>` | Import a Markdown file |
| `publisher init` | Initialize user directories |
| `publisher version` | Version and schema info |
| `publisher doctor` | Full health check |
| `publisher update` | Safe in-place update |
| `publisher backups list/create/restore` | Backup management |

## Persistent Data Locations

| Category | Path |
|----------|------|
| Config | `~/.config/publisher/` |
| User themes | `~/.local/share/publisher/themes/` |
| Article workspace | `~/.local/share/publisher/workspace/` |
| Backups | `~/.local/share/publisher/backups/` |
| Formula cache | `~/.cache/publisher/formulas/` |

## Test Coverage

127 tests across 8 suites:
- Parser, math rendering, CSS inlining, platform adapters
- Formula asset generation (SVG, PNG, caching)
- Formula sizing (dimensions, viewBox, no clipping)
- Installation, config, themes, backup/restore
- Article workspace (create, search, import, rename, migrate)
