# WeChat Rendering Pipeline

## Architecture

```
LaTeX source
    ├── Preview: KaTeX HTML (fast, selectable)
    └── Publish: MathJax tex2svg()
                    → Inline SVG with <path> elements
                    → Wrapped in <span> (inline) or <section> (display)
                    → CSS inlined via juice
                    → WeChat adapter sanitization
```

## Why Inline SVG (Not Data-URI Images)

Previous approach: `<img src="data:image/svg+xml;base64,...">`
- WeChat's rich text editor strips data URI image sources
- Formulas disappeared completely after paste

Current approach (mdnice-style): inline `<svg>` directly in HTML
- SVG contains only `<path>` elements (vector outlines)
- No `<defs>`, `<use>`, `id`, `class`, `clip-path` (WeChat strips these)
- No external CSS or font dependencies
- Self-contained: survives WeChat paste

## MathJax Configuration

```js
const svg = new SVG({ fontCache: 'none' });
```

`fontCache: 'none'` is critical — it ensures each SVG contains its own path
data instead of referencing shared `<defs>` via `<use>` elements.

## Formula Sizing

### Inline Formulas
- Wrapped in `<span>` with `display:inline-block`
- Width/height in `em` units (1ex ≈ 0.44em) for text-relative scaling
- `vertical-align` in `em` for baseline alignment
- SVG uses original MathJax `ex` units with `viewBox` for intrinsic dimensions

### Display Formulas
- Wrapped in centered `<section>`
- Inner `<section>` with `display:inline-block; max-width:100%`
- SVG width in `em`, height removed (controlled by viewBox aspect ratio)
- `overflow-x:auto; overflow-y:visible` — scrolls if too wide, never clips vertically

### Formula Not Clipped
- SVG `viewBox` is always preserved from MathJax output
- No `overflow:hidden` is used anywhere in the formula container
- Height is never fixed — viewBox controls aspect ratio
- Long equations scale proportionally via `max-width:100%` on the container

## CSS Inlining

Theme CSS and platform overrides are inlined by juice before export.
Formula `<svg>` elements are not affected by `#nice img` rules since
they are SVG elements, not `<img>` tags.

## WeChat Adapter Processing

1. `transform()`: Convert `<div>` to `<section>` for WeChat compatibility
2. `inlineCss()`: juice inlines all CSS into style attributes
3. `sanitize()`: Strip `<script>`, `<style>`, `<link>`, `class=`, `id=`,
   `on*` handlers, `xmlns:xlink`

## PNG Fallback

If inline SVG doesn't work in a specific WeChat version:
```bash
publisher build article.md --target wechat --math png
```

PNG mode renders formulas as `<img src="data:image/png;base64,...">` at 3x
resolution via sharp. This is larger but universally supported.

## Formula Count Validation

Before export, the validator checks:
- Source inline formula count = rendered inline formula count
- Source display formula count = rendered display formula count
- Any rendering error blocks the build
- No remaining `<eq>` or `<eqn>` KaTeX elements
