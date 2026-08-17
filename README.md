# MDTeX Pipeline

Local publishing pipeline for long-form technical and mathematical articles, targeting **WeChat Official Account** (primary) and **Zhihu** (secondary).

Converts Markdown + LaTeX source into platform-ready rich text with customizable CSS themes, live preview, and one-click clipboard copy.

## Install

```bash
git clone git@github.com:ouyang-matters/mdtex_pipeline.git
cd mdtex_pipeline
./install.sh
```

## Usage

```bash
# Start the local UI
publisher preview
# Or: cd /path/to/mdtex_pipeline && npm run dev

# CLI
publisher build article.md --target wechat
publisher build article.md --target zhihu --theme academic-orange
publisher validate article.md --target wechat

# Manage themes
publisher themes list
publisher themes copy academic-orange my-custom

# System
publisher init
publisher doctor
publisher version
publisher update

# Backups
publisher backups list
publisher backups create --label before-experiment
publisher backups restore <backup-name>
```

## Features

- Markdown + LaTeX rendering (KaTeX)
- Syntax-highlighted code blocks (highlight.js)
- Customizable CSS themes (mdnice-compatible `#nice` scoping)
- Platform-specific adapters (WeChat, Zhihu)
- CSS inlining via juice (styles survive platform editors)
- Rich-text clipboard copy (paste directly into WeChat/Zhihu editor)
- Live preview with theme/platform switching
- Validation and diagnostics
- Safe in-place updates with backup
- User data separated from application code

## Themes

Two built-in themes:

- `default` -- Clean, neutral style
- `academic-orange` -- Warm academic style with orange accents

Custom themes live in `~/.local/share/publisher/themes/`. Built-in themes in `themes/builtin/` are updated with the app but never overwrite user themes.

```bash
publisher themes copy academic-orange my-theme
# Edit ~/.local/share/publisher/themes/my-theme.css
```

## Data Layout

```
Application (git repo):   src/, themes/builtin/, tests/, scripts/
Configuration:            ~/.config/publisher/
User data & themes:       ~/.local/share/publisher/
Cache:                    ~/.cache/publisher/
```

Updates only change the application directory. User data is never touched.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Updating](docs/UPDATING.md)
- [Data Layout](docs/DATA_LAYOUT.md)
- [Migrations](docs/MIGRATIONS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Platform Compatibility](docs/PLATFORM_COMPATIBILITY.md)
- [Theme Guide](docs/THEME_GUIDE.md)
- [Phase 2 Plan](docs/PHASE2.md)
- [Reference Analysis](docs/REFERENCE_ANALYSIS.md)

## Testing

```bash
npm test            # Run all tests (77 tests)
publisher doctor    # Full system health check
```

## License

MIT
