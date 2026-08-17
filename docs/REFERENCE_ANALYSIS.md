# Reference Project Analysis

Analysis of existing tools to inform the architecture of mdtex-pipeline.

## 1. mdnice/markdown-nice

**Repository**: https://github.com/mdnice/markdown-nice
**License**: GPL-3.0 (viral copyleft -- derivative works must be GPL-3.0)
**Stars**: ~4.7k

### Architecture

React + MobX SPA with dual-panel editor. Can also be embedded as a library.

- **Editor**: CodeMirror (`@uiw/react-codemirror`)
- **State**: MobX stores for content, navbar, view, footer, dialog, imageHosting
- **Markdown**: `markdown-it` with 11+ plugins (7 custom)
- **Math**: MathJax for rendering + custom `markdown-it-math` plugin for parsing `$`/`$$` delimiters
- **CSS inlining**: `juice` with `{ inlinePseudoElements: true, preserveImportant: true }`
- **Clipboard**: `document.execCommand('copy')` with hidden input workaround for Safari cross-browser HTML copy
- **Syntax highlighting**: `highlight.js` with post-processing to convert `\n` → `<br/>` and spaces → `&nbsp;` for WeChat

### Theme System

Themes are CSS strings scoped under `#nice`, stored in JS modules, injected via `<style>` tags. Multiple style elements are managed:
- basic theme, code theme, markdown theme, font theme
- Custom themes via built-in CSS editor (CodeMirror in CSS mode)
- Themes loaded from API for authenticated users, localStorage fallback

### Copy-for-WeChat Flow

1. Save DOM snapshot: `layout.innerHTML`
2. Transform MathJax containers: `solveWeChatMath()` -- strips attributes from `<mjx-container>`, converts to `<section>`
3. Inline CSS: `solveHtml()` collects theme CSS, calls `juice()`
4. Copy via `document.execCommand('copy')` setting `text/html` + `text/plain` MIME types
5. Restore original DOM

### Platform-Specific Math Transforms

- **WeChat**: Strip MathJax attributes, convert width/height to inline styles
- **Zhihu**: Replace MathJax containers with `<img>` tags (alt = formula text)
- **Juejin**: Convert to `<img>` using Juejin's equation API

### Key Takeaways

- `markdown-it` is proven for this use case
- MathJax is used over KaTeX for broader LaTeX compatibility
- `juice` is the standard CSS inliner
- Code block whitespace must be converted to HTML entities for WeChat
- GPL-3.0 license means we cannot derive from this codebase

---

## 2. doocs/md

**Repository**: https://github.com/doocs/md
**License**: WTFPL (permissive)
**Version**: 2.1.0 | **Stars**: ~11k

### Architecture

Monorepo (pnpm workspaces) with Vue 3, Vite, Pinia. Much more complex than mdnice.

| Package | Purpose |
|---------|---------|
| `@md/core` | Markdown parsing, rendering, theme engine |
| `@md/shared` | Types, configs, CodeMirror setup |
| `@md/web` | Main Vue 3 app |
| `@md/api` | Cloudflare Workers backend |

- **Editor**: CodeMirror 6
- **Markdown**: `marked` parser (not markdown-it)
- **Math**: MathJax `tex2svg()` -- produces SVG, which survives WeChat better than HTML math
- **CSS inlining**: `juice` 12.x
- **Highlighting**: highlight.js with 73 code themes
- **Diagrams**: Mermaid + PlantUML SVG

### CSS / Theme System

- 3 built-in themes + marketplace themes
- CSS scoped under `#output` via `wrapCSSWithScope()`
- CSS variables: `--md-primary-color`, `--md-font-family`, `--md-font-size`
- Variable resolution done in JS at runtime (not PostCSS)
- Theme injection via singleton `ThemeInjector` managing a `<style>` element

### WeChat Clipboard Pipeline (Critical)

1. Deep-clone the `#output` DOM (never mutate live DOM)
2. Process SVG diagrams: expand markers, flatten gradients, remove `<defs>`, strip `id`/`class`/`clip-path`
3. Process math: MathJax SVG output
4. Resolve images: convert width/height attrs to inline CSS
5. Fix list nesting: move nested `<ul>`/`<ol>` outside `<li>` (WeChat requirement!)
6. Sanitize CSS: map custom fonts to generic families
7. Apply juice CSS inlining
8. Dark mode → force light mode re-render before export

### Image Upload

12 providers: GitHub, Alibaba OSS, Tencent COS, Qiniu, MinIO, S3, R2, WeChat MP, Upyun, Telegram, Cloudinary, custom.

### Key Takeaways

- Math rendered as SVG (tex2svg) is more reliable for WeChat than HTML math
- SVG processing for WeChat is extensive (marker expansion, gradient baking, foreignObject conversion)
- List nesting must be fixed for WeChat (`<ul>` inside `<li>` breaks)
- WTFPL license -- we can freely study and learn from patterns
- Much more complex than we need for Phase 1

---

## 3. Automattic/juice

**Repository**: https://github.com/Automattic/juice
**License**: MIT
**Version**: 12.1.2 | **Stars**: ~3.3k

### How It Works

1. Parse HTML with cheerio
2. Extract `<style>` tags
3. Flatten nested CSS via postcss-nesting
4. Parse CSS via PostCSS (safe parser)
5. For each rule: compute specificity, find matching elements, attach properties
6. Resolve conflicts by specificity (standard 4-tuple: inline, ids, classes, types)
7. Resolve CSS variables (walks up DOM tree for `--custom-property` declarations)
8. Serialize properties into `style=""` attributes
9. Strip `<style>` tags (configurable)

### Recommended Options for WeChat

```js
juice(html, {
  removeStyleTags: true,         // WeChat strips <style>
  preserveMediaQueries: false,   // WeChat doesn't support
  preserveFontFaces: false,      // WeChat strips
  preserveKeyFrames: false,      // WeChat strips
  resolveCSSVariables: true,     // Essential -- WeChat can't resolve var()
  preserveImportant: false,      // WeChat may strip !important
  inlinePseudoElements: true,    // Convert ::before/::after to <span>
  applyWidthAttributes: false,   // Not needed for non-email
  applyAttributesTableElements: false,
});
```

### CSS Features Support

| Feature | Supported |
|---------|-----------|
| CSS specificity | Yes, full 4-tuple |
| CSS variables | Yes, resolved and substituted |
| CSS nesting | Yes, via postcss-nesting |
| Media queries | Preserved in `<style>` (not inlined) |
| Pseudo-classes (:hover) | Preserved in `<style>` |
| Pseudo-elements (::before) | Optional injection as `<span>` |
| `!important` | Configurable |
| CSS counters | Supported |
| `@font-face` | Preserved (not inlined) |
| `@keyframes` | Preserved (not inlined) |

### Browser Compatibility

Has a `client.js` entry point for browser use, but the full server-side version (with cheerio) is more reliable. For our local tool, server-side via CLI is ideal. The browser UI can use a simpler DOM-based approach for preview, with juice on the export path.

### Suitability Assessment

**Excellent fit for our use case.** Juice was designed for exactly this problem (inlining CSS for contexts that strip `<style>` tags). Its CSS variable resolution and specificity handling eliminate the need for us to implement these from scratch.

---

## License Implications

| Project | License | Can we use code? | Can we study patterns? |
|---------|---------|-------------------|----------------------|
| mdnice | GPL-3.0 | No (viral copyleft) | Yes (clean-room) |
| doocs/md | WTFPL | Yes | Yes |
| juice | MIT | Yes | Yes |

**Our approach**: MIT license for mdtex-pipeline. We use juice directly as a dependency. We study architectural patterns from all three projects but write our own implementation. We do not copy code from mdnice.

---

## Architectural Decisions Informed by Research

1. **Parser**: `markdown-it` (proven by mdnice, more pluggable than marked)
2. **Math**: KaTeX for Phase 1 HTML rendering. If WeChat compatibility is poor, Phase 2 can add SVG rendering (like doocs/md's tex2svg approach)
3. **CSS inlining**: juice (used by both reference projects)
4. **Clipboard**: `navigator.clipboard.write()` with `ClipboardItem` for modern browsers, `document.execCommand('copy')` fallback
5. **Theme scoping**: `#nice` root (compatible with mdnice theme ecosystem)
6. **Code blocks**: highlight.js (used by both), with whitespace → HTML entity conversion for WeChat
7. **WeChat list fix**: nested lists may need restructuring (doocs/md finding)
