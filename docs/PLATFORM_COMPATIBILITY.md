# Platform Compatibility

Documented differences between WeChat Official Account and Zhihu editors.

## WeChat Official Account

### What Survives

- Inline `style=""` attributes (primary styling mechanism)
- Basic HTML elements: `<p>`, `<h1>`-`<h6>`, `<strong>`, `<em>`, `<s>`, `<a>`, `<img>`, `<table>`, `<tr>`, `<td>`, `<th>`, `<ul>`, `<ol>`, `<li>`, `<blockquote>`, `<pre>`, `<code>`, `<br>`, `<hr>`, `<span>`, `<section>`, `<sup>`, `<sub>`
- `<section>` elements (sometimes preferred over `<div>`)
- Images hosted on WeChat CDN (`mmbiz.qpic.cn`)
- SVG elements (with limitations)
- `data-*` attributes (generally preserved)

### What Gets Stripped

- `<style>` tags (all CSS must be inline)
- `<script>` tags
- `<link>` tags
- `<iframe>` tags
- `<video>` and `<audio>` elements
- `class` attributes
- Most `id` attributes
- `on*` event handlers
- External fonts (`@font-face`)
- Media queries
- CSS animations (`@keyframes`)
- CSS variables (`var()`)
- `position: fixed` / `position: absolute` (unreliable)

### Known Issues

1. **Code block whitespace**: WeChat may collapse whitespace in `<pre>` blocks. Converting `\n` to `<br>` and spaces to `&nbsp;` can help but is not always necessary with inline styles.
2. **Nested lists**: `<ul>` inside `<li>` may render incorrectly. Some tools move nested lists outside `<li>`.
3. **Table width**: Tables may overflow on mobile. Use `max-width: 100%` and `overflow-x: auto`.
4. **Images**: Must be uploaded to WeChat CDN before publishing. External URLs are blocked.
5. **Links**: Only work within WeChat browser. External links may show a warning page.
6. **KaTeX HTML**: KaTeX output uses many nested `<span>` elements with specific CSS classes. After CSS inlining and class stripping, the inline styles usually preserve the visual rendering, but complex formulas may have alignment issues. SVG rendering is more robust for math.
7. **Font stacks**: Only system fonts work. Use standard Chinese font stacks (`PingFang SC`, `Microsoft YaHei`, etc.).
8. **Max width**: Articles are viewed on mobile (~375px viewport). All content must be mobile-responsive.

### Recommended Approach

- All styles inlined with juice
- CSS variables resolved before inlining
- Classes and IDs stripped after inlining
- Images flagged for manual upload; a WeChat CDN uploader is not built yet
- Code blocks: `overflow-x: auto` with `-webkit-overflow-scrolling: touch`
- Math: MathJax inline `<svg>` containing only `<path>` elements — see
  [WECHAT_RENDERING.md](WECHAT_RENDERING.md). `--math png` is the fallback.

---

## Zhihu

### What Survives

- Inline `style=""` attributes
- `class` attributes (Zhihu may use them for its own styling)
- Most HTML elements similar to WeChat
- External image URLs (Zhihu will cache/proxy them)
- Links with `target="_blank"`
- Native LaTeX support (Zhihu has its own LaTeX renderer)

### What Gets Stripped

- `<script>` tags
- `<style>` tags
- `id` attributes
- `on*` event handlers
- `<iframe>` tags

### Differences from WeChat

| Feature | WeChat | Zhihu |
|---------|--------|-------|
| `class` attributes | Stripped | Preserved |
| `id` attributes | Stripped (except root) | Stripped |
| External images | Blocked (CDN required) | Allowed (proxied) |
| Links | WeChat browser only | Normal browser |
| Native LaTeX | No | Yes (own renderer) |
| `<details>`/`<summary>` | Not supported | Not supported |
| `<video>` | Not supported | Limited support |
| Code blocks | Inline styles only | Better native support |
| SVG | Limited support | Limited support |
| `<section>` vs `<div>` | `<section>` preferred | `<div>` fine |

### Recommended Approach

- Inline styles for consistent rendering
- Keep `class` attributes (may help with Zhihu's own styling)
- Strip `id` attributes
- Add `target="_blank"` to all links
- External images work without upload
- Pre-rendered KaTeX HTML works alongside Zhihu's native LaTeX

---

## Math Rendering

### Architecture

The pipeline uses two separate math renderers:

```
LaTeX source
    ├── Preview: KaTeX HTML     (fast, selectable, for editing)
    └── Publish: MathJax SVG    (self-contained, for clipboard/export)
               └── optional PNG fallback (3x resolution)
```

The original LaTeX source is canonical and never modified. It is preserved in `data-latex` attributes on formula `<img>` tags.

### Preview (KaTeX HTML)

The editor preview uses KaTeX for instant rendering. KaTeX produces nested `<span>` elements with CSS classes — fine for live editing but fragile for publishing.

### Publishing (MathJax SVG)

For clipboard copy and HTML export, formulas are rendered to self-contained SVG images via MathJax `tex2svg()`. These SVGs:

- Use `<path>` elements (vector outlines, no text/font dependency)
- Have zero CSS class dependencies
- Are self-contained (no external resources)
- Include proper vertical alignment for inline math
- Scale perfectly on high-DPI/mobile displays

Formula assets are cached by content hash (LaTeX source + display mode + renderer version) to avoid re-rendering unchanged formulas.

### Why Not KaTeX HTML for Publishing

KaTeX HTML output for `$E=mc^2$` produces deeply nested spans:
```html
<span style="height:0.6833em;"></span>
<span style="margin-right:0.0576em;">E</span>
<span style="margin-right:0.2778em;"></span>
<span>=</span>
...
```

This structure fails in WeChat because:
1. WeChat strips empty `<span>` elements
2. Pixel-level `margin-right` and `height` positioning breaks
3. KaTeX CSS classes are stripped, breaking the layout
4. `position: relative` and `top` offsets may be modified
5. The complex nested DOM structure is not a standard HTML pattern

### SVG vs PNG

| Format | Pros | Cons |
|--------|------|------|
| SVG data URI | Perfect scaling, small size, vector quality | Some platforms may not render inline SVG data URIs |
| PNG data URI | Universal image support, guaranteed rendering | Larger file size, fixed resolution (mitigated by 3x rendering) |

Default: SVG. Select with `--math svg` or `--math png` in CLI.

### Inline Formula Styling

Inline formulas are rendered as `<img>` tags with:
- `height` matching MathJax's computed ex-height
- `vertical-align` from MathJax for baseline alignment
- `margin: 0 0.15em` for horizontal spacing
- `display: inline` to flow with text

### Display Formula Styling

Display formulas are wrapped in centered `<section>` tags:
- `text-align: center`
- `margin: 1em 0`
- `overflow-x: auto` for wide equations
- `max-width: 100%` to prevent overflow

### Formula Asset Pipeline

```
LaTeX source
  → MathJax tex2svg() render
  → Tightly cropped SVG (path-based, no fonts)
  → Cache by SHA-256(latex + displayMode + rendererVersion)
  → Optional: sharp SVG→PNG at 3x resolution
  → <img src="data:image/svg+xml;base64,..." data-latex="..." />
```

### Known Limitations

1. **Inline SVG**: Formulas are inline `<svg>` elements, not data URIs — WeChat
   strips data URIs. Very old WeChat clients may still not render inline SVG;
   `--math png` produces images instead.
2. **Very long equations**: Display equations sit in their own scroll container
   with `overflow-x: auto`, so they scroll rather than being cropped. Inline
   formulas never get a scrollbar.
3. **Text selectability**: Formula text is not selectable in the published
   article. The original LaTeX is preserved in `data-latex`.
4. **File size**: Math-heavy articles produce large HTML. A 143-formula article
   is about 825 KB; the same article under the old data-URI approach was 5.9 MB.
5. **WeChat CDN upload**: Not built. Content images must be uploaded manually;
   the validator warns about each one.

---

## Testing Recommendations

1. Compile the fixture article for both platforms
2. Paste into WeChat Official Account test editor
3. Paste into Zhihu article editor
4. Check on mobile devices
5. Verify: headings, paragraphs, math, code blocks, tables, images, links
6. Compare SVG vs PNG rendering quality
7. Check inline formula baseline alignment in mixed Chinese+math paragraphs
8. Verify formula count preservation (source count = rendered count)
9. Document any rendering differences in this file
