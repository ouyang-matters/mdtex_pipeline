# Theme Guide

## Overview

mdtex-pipeline themes are CSS files that control the visual appearance of compiled articles. Themes are scoped under `#nice`, making them compatible with the mdnice theme ecosystem.

## Theme Structure

A theme is a single CSS file placed in the `themes/` directory:

```
themes/
  default.css
  minimal.css
  modern.css
  your-custom-theme.css
```

The compiler discovers themes automatically. Select them by name (without `.css`) in the UI or CLI.

## Writing a Theme

### Basic Template

```css
/* my-theme.css */

:root {
  --primary-color: #333;
  --accent-color: #1a73e8;
  --bg-color: #fff;
  --code-bg: #f5f5f5;
  --font-size: 15px;
  --line-height: 1.75;
  --font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  --code-font: Consolas, "Liberation Mono", Menlo, monospace;
}

#nice {
  font-family: var(--font-family);
  font-size: var(--font-size);
  color: var(--primary-color);
  line-height: var(--line-height);
  padding: 16px;
}

#nice h1 { /* ... */ }
#nice h2 { /* ... */ }
#nice p { /* ... */ }
#nice strong { /* ... */ }
#nice em { /* ... */ }
#nice a { /* ... */ }
#nice ul { /* ... */ }
#nice ol { /* ... */ }
#nice li { /* ... */ }
#nice blockquote { /* ... */ }
#nice table { /* ... */ }
#nice th { /* ... */ }
#nice td { /* ... */ }
#nice hr { /* ... */ }
#nice code { /* inline code */ }
#nice pre.code-block { /* code blocks */ }
#nice pre.code-block code { /* code block content */ }
#nice .code-block-wrapper { /* code block outer wrapper */ }
#nice .code-lang { /* language label */ }
#nice img { /* ... */ }
#nice .katex { /* KaTeX math */ }
#nice .katex-display { /* display math — do NOT set overflow here, see below */ }
#nice .footnotes { /* footnotes section */ }
```

### Required Selectors

At minimum, a theme should style:

| Selector | Element |
|----------|---------|
| `#nice` | Root container |
| `#nice p` | Paragraphs |
| `#nice h1` through `#nice h6` | Headings |
| `#nice strong` | Bold text |
| `#nice em` | Italic text |
| `#nice a` | Links |
| `#nice ul`, `#nice ol`, `#nice li` | Lists |
| `#nice blockquote` | Blockquotes |
| `#nice code` | Inline code |
| `#nice pre.code-block` | Code block container |
| `#nice pre.code-block code` | Code block content |
| `#nice table`, `#nice th`, `#nice td` | Tables |
| `#nice img` | Images |
| `#nice hr` | Horizontal rules |

### Code Block Structure

The renderer produces this HTML for code blocks:

```html
<div class="code-block-wrapper">
  <span class="code-lang">python</span>
  <pre class="code-block">
    <code class="hljs language-python">
      <span class="hljs-keyword">def</span> ...
    </code>
  </pre>
</div>
```

Style the `hljs-*` classes for syntax highlighting colors:

```css
#nice .hljs-keyword { color: #d73a49; }
#nice .hljs-string { color: #032f62; }
#nice .hljs-number { color: #005cc5; }
#nice .hljs-comment { color: #6a737d; font-style: italic; }
#nice .hljs-function { color: #6f42c1; }
#nice .hljs-title { color: #6f42c1; }
#nice .hljs-built_in { color: #e36209; }
```

### CSS Variables

You can use CSS variables in your theme. The compiler resolves `var(--name)` references before inlining, so they work even on platforms that don't support variables:

```css
:root {
  --accent: #e67e22;
}

#nice h2 {
  color: var(--accent);           /* Resolved to #e67e22 */
  border-left: 4px solid var(--accent);
}
```

**Limitation**: Only simple `var(--name)` and `var(--name, fallback)` references are resolved. Nested `var()` calls may not resolve fully. Complex `calc()` expressions with variables are not evaluated.

## Adapting mdnice Themes

mdnice themes use the same `#nice` scoping convention. To adapt an mdnice theme:

1. Copy the CSS content
2. Save as `themes/your-theme.css`
3. Adjust code block selectors:
   - mdnice: `#nice pre code` → our format: `#nice pre.code-block code`
   - Add `.code-block-wrapper` and `.code-lang` styling
4. Add highlight.js token colors (`#nice .hljs-keyword`, etc.) if not present
5. Add KaTeX math styling (`#nice .katex`, `#nice .katex-display`)
6. Test with the preview

Most mdnice themes will work with minimal changes since we use the same `#nice` root selector.

## Platform Considerations

### WeChat

- Use only system fonts: `-apple-system`, `PingFang SC`, `Hiragino Sans GB`, `Microsoft YaHei`, `Arial`, `sans-serif`
- Avoid `position: absolute/fixed`
- Use `max-width: 100%` on images and tables
- Code blocks need `overflow-x: auto` for mobile scrolling
- **Never set `overflow` on `#nice .katex-display`.** MDTeX owns display-maths
  overflow: the preview wraps each equation in a `.math-block` that scales it to
  fit and only scrolls when it must, and published output ships its own scroll
  container. A theme that adds its own overflow promotes `overflow-y` to `auto`
  (CSS does that whenever the other axis is not `visible`) and paints a stray
  vertical scrollbar beside every equation.
- Avoid CSS animations and transitions
- `box-shadow` works but may render differently

### Zhihu

- Similar font constraints
- Slightly more CSS flexibility
- Code blocks have better native support

## Live Editing

In the UI:
1. Select your theme from the dropdown
2. Edit the CSS file externally
3. Click "Reload CSS" to see changes immediately

The dev server (Vite) also supports hot module replacement for theme files during development.

## CLI Theme Selection

```bash
# Use built-in theme
publisher build article.md --theme modern

# Use custom theme file
publisher build article.md --theme /path/to/my-theme.css
```
