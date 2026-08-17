# MDTeX Pipeline

Local publishing pipeline for long-form technical and mathematical articles, targeting **WeChat Official Account** (primary) and **Zhihu** (secondary).

Converts Markdown + LaTeX source into platform-ready rich text with customizable CSS themes, live preview, and one-click clipboard copy.

## Features

- Markdown + LaTeX rendering (KaTeX)
- Syntax-highlighted code blocks (highlight.js)
- Customizable CSS themes (mdnice-compatible `#nice` scoping)
- Platform-specific adapters (WeChat, Zhihu)
- CSS inlining via juice (styles survive platform editors)
- Rich-text clipboard copy (paste directly into WeChat/Zhihu editor)
- Live preview with theme/platform switching
- Validation and diagnostics
- CLI for batch compilation

## Quick Start

```bash
# Install dependencies
npm install

# Start the local UI
npm run dev
# Open http://localhost:3000

# Or use the CLI
node src/cli/index.js build article.md --target wechat --theme default
node src/cli/index.js build article.md --target zhihu --theme academic-orange
node src/cli/index.js validate article.md --target wechat
node src/cli/index.js themes
```

## UI Workflow

1. Open the UI (`npm run dev`)
2. Paste or open a Markdown file
3. Select a theme and target platform
4. Preview the rendered article
5. Click **Copy for Platform** to copy rich text
6. Paste into WeChat/Zhihu editor

## Themes

Themes are CSS files in `themes/`. Two built-in themes:

- `default` -- Clean, neutral style
- `academic-orange` -- Warm academic style with orange accents

Add custom themes by dropping `.css` files into `themes/`. See `docs/THEME_GUIDE.md`.

## Project Structure

```
src/
  core/           Markdown parser, renderer, math, code, images, themes, compiler
  platforms/      WeChat and Zhihu adapters
  ui/             Browser-side rendering and UI
  cli/            CLI commands
themes/           CSS theme files
tests/            Test suites and fixtures
docs/             Documentation
dist/             Build output (gitignored)
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Reference Analysis](docs/REFERENCE_ANALYSIS.md)
- [Platform Compatibility](docs/PLATFORM_COMPATIBILITY.md)
- [Theme Guide](docs/THEME_GUIDE.md)
- [Phase 2 Plan](docs/PHASE2.md)

## Testing

```bash
npm test          # Run all tests
npm run test:watch  # Watch mode
```

## License

MIT
