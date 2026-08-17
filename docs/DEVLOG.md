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

1. KaTeX HTML may have alignment issues on WeChat for complex formulas — both reference projects use MathJax SVG instead
2. WeChat images must be on its CDN — Phase 1 flags with warnings, Phase 2 adds API upload
3. WeChat may break nested lists (`<ul>` inside `<li>`) — doocs/md restructures these
4. Code block whitespace may collapse on WeChat in edge cases — mdnice converts to HTML entities
5. Rich-text clipboard requires secure context (HTTPS/localhost)
6. Browser-side CSS inlining (DOM-based) is less precise than server-side juice — CLI build uses juice for production output
