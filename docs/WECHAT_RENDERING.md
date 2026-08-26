# WeChat Rendering

How MDTeX turns an article into something that survives a paste into the WeChat
Official Account editor, and what it costs.

---

## The constraint

The WeChat editor keeps inline styles and drops almost everything else:
stylesheets, `<style>` tags, classes, ids, external resources, scripts,
iframes, and any construct it does not recognise. Whatever you paste has to be
self-contained.

That rules out KaTeX HTML, which depends on a stylesheet and a web font, and it
rules out `<img src="data:…">` for formulas, which WeChat strips.

## What MDTeX produces

Formulas are **inline `<svg>` elements containing only `<path>` data**, the same
approach mdnice and doocs/md use.

```html
<section data-latex="E = mc^2" data-display="true" data-mdtex-math="display"
         style="text-align:center;margin:1em 0;max-width:100%;overflow-x:auto;overflow-y:visible;">
  <section style="display:inline-block;max-width:100%;">
    <svg style="max-width:100%;height:auto;…" xmlns="http://www.w3.org/2000/svg"
         width="6.2em" height="1.4em" viewBox="0 -750 2740 620">
      <g …><path d="M62 -22T47…"/></g>
    </svg>
  </section>
</section>
```

MathJax runs with `fontCache: 'none'`, so each SVG carries its own glyph
outlines. No `<defs>`, no `<use>`, no `id`, no `class`, no font dependency.

### Inline and display are sized by different rules

The mode is explicit — `data-mdtex-math="inline"` or `"display"` — and travels
with the element through every remaining stage. Nothing downstream has to infer
it from context.

| | Inline | Display |
| --- | --- | --- |
| Width | its intrinsic width, in em | intrinsic, capped at the column |
| `max-width` | `none` — it must never be shrunk to fit | `100%` |
| Display | `inline-block`, flowing with the text | its own centred block |
| Baseline | em-based `vertical-align` | `middle`, inside its container |
| Overflow | `visible`; an inline formula must never grow a scrollbar | scrolls horizontally rather than cropping |

An inline formula states its size **three times over**: as `width`/`height`
attributes on the `<svg>`, in that element's inline `style`, and again on the
`<span>` that wraps it. That is not redundancy for its own sake — see
*Why inline maths states its size three times* below.

### Sizing is re-asserted after CSS inlining

`juice` folds every matching theme rule into each element's `style`, and a rule
as ordinary as `#nice svg { width: 100% }` lands on inline maths along with
everything else. So a normalization pass runs immediately after inlining
(`src/core/math/normalize-sizing.js`): it drops every geometry property from each
maths element and restates the ones that belong there, from the intrinsic
dimensions recorded when the element was built.

Non-geometry declarations — fill, colour, opacity — are left alone. A theme is
entitled to style those; it is not entitled to decide how big a formula is.

Everything else — theme CSS, code highlighting, tables — is flattened into
inline `style` attributes by `juice`, and then the WeChat adapter strips classes
and ids.

---

## The pipeline

```text
Markdown
  → markdown-it + markdown-it-texmath (KaTeX)          scoped HTML under #nice
  → replace <eq>/<eqn> with MathJax inline SVG         formula cache
  → WeChat adapter transform (div → section)
  → juice: inline the theme CSS in one pass
  → normalize maths sizing (undo leaked width/display rules)
  → WeChat adapter sanitize (drop classes, ids, …)
  → validate (formula counts, images, dangerous markup)
```

Validation checks that the number of formulas in the source equals the number
rendered. A dropped equation is a silent correctness failure, so it is an error,
not a warning.

---

## Compile and Copy are separate

`Compile` produces and caches the platform representation. `Copy` writes bytes
that already exist.

The prepared output is cached against a content hash covering everything that
can change the result:

```text
sha256(source + resolved theme CSS + theme name + platform + math output mode
       + renderer version)
```

If nothing relevant changed, `Compile` returns the cached entry immediately and
`Copy` never touches the compiler at all. The UI also prepares in the background
a couple of seconds after you stop typing, so the output is usually ready before
you reach for the button. That can be turned off in Settings → Publishing.

Anything that would change the bytes — editing the source, switching theme,
editing the theme CSS, switching platform, opening a different article, an
applied AI edit — marks the prepared output stale.

Progress is reported stage by stage and the build can be cancelled:

```text
Rendering Markdown…
Rendering formulas 18/143
Inlining styles…
Validating…
Ready to copy
```

---

## Performance

### What was wrong

The original implementation did everything on the browser's main thread, on
every press of Copy:

1. `math-to-image.js` converted each formula into a `<foreignObject>` SVG data
   URI **with a complete copy of `katex.min.css` (24.7 KB) embedded in every
   one**. 143 formulas produced 5.9 MB of HTML; 572 produced 23.6 MB.
2. `inlineCssSimple` re-parsed that document and ran a `getComputedStyle()` call
   per element plus a full rules × elements `matches()` sweep.
3. The result was serialised straight to the clipboard.

None of it was cached, cancellable, or off the UI thread — and the output was a
`foreignObject` SVG, which WeChat does not render anyway.

### Measured

`node scripts/bench-wechat.js [--scale N]` runs both paths in the same real
browser against the same fixture. The legacy path is preserved verbatim in
`bench/legacy-wechat-path.js` so the comparison stays honest.

Fixture: `tests/fixtures/long_technical_article.md` — 18 sections, 24 display
and 119 inline equations, 9 code blocks, 6 tables, 4 images, custom theme.
Environment: Chrome 146, Node 22.22.1, Linux.

**143 formulas (20 KB of Markdown)**

| Path | Total | Worst main-thread stall | Output |
| --- | ---: | ---: | ---: |
| Legacy, on the main thread | 533 ms | 336 ms | 5.90 MB |
| Local backend, cold formula cache | 407 ms | 17 ms | 824.8 KB |
| Local backend, warm cache | 3 ms | 17 ms | — |
| Press Copy on prepared output | 67 ms | 25 ms | — |

**572 formulas (81 KB of Markdown, `--scale 4`)**

| Path | Total | Worst main-thread stall | Output |
| --- | ---: | ---: | ---: |
| Legacy, on the main thread | 1518 ms | 1086 ms | 23.61 MB |
| Local backend, cold formula cache | 2191 ms | 17 ms | 3.22 MB |
| Local backend, warm cache | 6 ms | 17 ms | — |
| Press Copy on prepared output | 150 ms | 66 ms | — |

Legacy stage breakdown at 572 formulas:

| Stage | Time |
| --- | ---: |
| markdown + KaTeX render | 119 ms |
| formula → foreignObject data URI | 1038 ms |
| CSS inlining (getComputedStyle per element) | 166 ms |
| platform sanitize | 73 ms |
| clipboard write of 23.61 MB | 390 ms |

Backend stage breakdown at 572 formulas (cold cache):

| Stage | Time |
| --- | ---: |
| render | 150 ms |
| formulas (MathJax) | 1752 ms |
| inline (juice) | 192 ms |
| validate | 10 ms |

### What the numbers say

Read them carefully, because the headline is not "it got faster":

- **Wall-clock cold compilation is comparable, and at scale the backend is
  slower** — 2191 ms against 1518 ms at 572 formulas. MathJax producing
  path-only SVG is genuinely more work than wrapping KaTeX HTML in a
  `foreignObject`. It is also the only one of the two that WeChat will render.
- **The stall is what changed.** The worst single main-thread freeze drops from
  1086 ms to 17 ms, and it no longer grows with the article: the work happens in
  the backend process, the UI only follows a progress stream. The editor stays
  typable throughout, which `scripts/e2e.js` asserts.
- **Repeat cost changed the most.** Every press of Copy used to redo the whole
  1.9 s. It is now a 150 ms cache read, and 0 ms of compilation.
- **Output shrank 7x**, because a copy of `katex.min.css` is no longer embedded
  in each of 572 formulas. 23.6 MB of HTML is not something the WeChat editor
  handles gracefully either.

A note on how these numbers were obtained: an earlier measurement of the legacy
path under jsdom reported times in the hundreds of seconds. That was a jsdom
artefact — its `getComputedStyle` is pathologically slow — not a real browser
result, and it is not what users experienced. All numbers above come from real
Chrome, which is why the benchmark now drives a browser.

### Guarding against regressions

`scripts/e2e.js` asserts, in a real browser:

- the WeChat build finishes
- progress is reported per formula
- the worst main-thread gap during the build stays under 400 ms
- Copy completes in under 2.5 s and writes rich text to the clipboard
- a repeat Copy makes **zero** compile requests

`scripts/bench-wechat.js` prints the table above and takes `--scale N` to show
how each path grows with article length.

---

## Mathematics overflow

Some equations are legitimately wider than the column. The rules, in order:

1. An equation that fits is left alone.
2. An equation slightly too wide is scaled down, never below 72% of natural
   size — below that it stops being readable.
3. An equation still too wide gets its own horizontal scroll container.

The container, never the page, owns the overflow, so the article never scrolls
sideways. The SVG `viewBox` is never modified, so nothing is cropped: the whole
expression is always reachable.

The scrollbar is styled to match the application — 6 px, subtle, with a soft
edge fade signalling that there is more to the right — rather than the browser
default.

Inline mathematics is excluded entirely: no scaling, no scroll container, normal
text flow and baseline.

In the preview this is `src/ui/math-fit.js`. In published output the display
wrapper carries `overflow-x:auto` inline and the SVG carries `max-width:100%`,
so WeChat's own rendering behaves the same way.

Built-in themes deliberately do **not** set overflow on `.katex-display`. They
used to, and because CSS promotes a `visible` axis to `auto` when the other axis
is not `visible`, that painted a stray vertical scrollbar beside every equation
in the preview.

### Why inline maths states its size three times

An `<svg>` with a `viewBox` and no width or height fills its container. That is
the specification, not a bug, and it is what turns a one-glyph formula into a
full-column image: `$K$` has a roughly square viewBox, so 768px of column width
becomes 590px of height.

A long formula has a wide, short viewBox, so the same treatment leaves it
looking roughly normal — which is exactly why the symptom looks like "short
inline formulas are broken" rather than "inline formulas lost their dimensions".
It also looks intermittent, because whether it happens depends on how much of
the markup a given paste target rewrites.

So the size is stated at three independent levels, and any one of them surviving
keeps the formula correct:

| If a consumer strips… | what still sizes it |
| --- | --- |
| the `<span>` wrapper | the SVG's attributes and its inline style |
| the SVG's `width`/`height` attributes | the SVG's inline style |
| the SVG's `style` too | the wrapper's explicit width and height |

`node scripts/math-sizing-check.js` measures all of this in a real browser: every
built-in and hostile theme, and each of those strippings applied to real
published output. It is a measurement, not an assertion that it ought to work.

---

## PNG fallback

Very old WeChat clients may not render inline SVG. For those:

```bash
publisher build article.md --target wechat --math png
```

Formulas become `<img src="data:image/png;base64,…">` at 3x resolution, rendered
through `sharp`. Larger output and no text selection, so it is not the default.

---

## Known limitations

1. Content images must be on the WeChat CDN. MDTeX warns; uploading is manual.
2. Custom fonts are not available in WeChat articles.
3. `position: fixed/absolute` is unreliable.
4. Video and audio elements are not supported; the validator warns.
5. `target="_blank"` on links may be ignored.
