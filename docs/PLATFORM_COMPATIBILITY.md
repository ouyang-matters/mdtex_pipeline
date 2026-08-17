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
- Images flagged for manual upload (Phase 1) or API upload (Phase 2)
- Code blocks: `overflow-x: auto` with `-webkit-overflow-scrolling: touch`
- Math: KaTeX inline styles (Phase 1), consider SVG fallback (Phase 2)

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

## Math Rendering Compatibility

### KaTeX HTML (Current)

KaTeX renders math as nested `<span>` elements with inline styles for positioning, sizing, and alignment. After CSS inlining:

- **Inline math**: Generally works on both platforms. The many nested spans survive because they use inline styles.
- **Display math**: Works but may have alignment issues with complex expressions.
- **Aligned equations**: May have width/positioning issues.

### Potential Issues

1. KaTeX uses `position: relative` and `top` offsets for vertical alignment -- these may be affected by WeChat's CSS stripping.
2. Very wide equations may overflow on mobile.
3. Some KaTeX CSS classes (`.katex-display`, `.katex-html`) are stripped, but their inline-styled children remain.

### SVG Alternative (Phase 2)

If KaTeX HTML proves unreliable, rendering math to SVG (like doocs/md's MathJax `tex2svg()`) provides:
- Self-contained vector graphics
- No CSS dependency
- Perfect rendering fidelity
- Slightly larger HTML output
- Loss of text selectability in formulas

The `MathNode.renderedSvg` field is reserved for this purpose.

---

## Testing Recommendations

1. Compile the fixture article for both platforms
2. Paste into WeChat Official Account test editor
3. Paste into Zhihu article editor
4. Check on mobile devices
5. Verify: headings, paragraphs, math, code blocks, tables, images, links
6. Document any rendering differences in this file
