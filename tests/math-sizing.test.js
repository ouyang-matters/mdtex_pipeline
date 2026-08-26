import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { replaceKatexWithImages, MathOutput } from '../src/core/math/post-processor.js';
import { normalizeMathSizing } from '../src/core/math/normalize-sizing.js';
import { FormulaCache, formulaCacheKey } from '../src/core/math/formula-cache.js';
import { renderLatexToSvg } from '../src/core/math/publish-renderer.js';

/**
 * Inline and display formulas are different objects and are sized by different
 * rules. The bug these guard against is a short inline formula — `$K$` — being
 * rendered enormous, by inheriting a rule meant for images or display maths, or
 * by losing the dimensions that keep an SVG from filling its container.
 */

/** KaTeX-shaped input, which is what the post-processor consumes. */
function katex(latex, display) {
  const annotated = `<annotation encoding="application/x-tex">${latex}</annotation>`;
  return display
    ? `<section><eqn>${annotated}</eqn></section>`
    : `<eq>${annotated}</eq>`;
}

const tagsOf = (html, mode) =>
  [...html.matchAll(new RegExp(`<(svg|span|img|section)\\b[^>]*data-mdtex-math="${mode}"[^>]*>`, 'g'))]
    .map(m => m[0]);

const styleOf = tag => (tag.match(/style="([^"]*)"/) || [, ''])[1];

/** `width:100%` as its own declaration — not the tail of `max-width:100%`. */
const FULL_WIDTH = /(^|;)\s*width\s*:\s*100%/;

let cacheDir;
let cache;
beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'mdtex-formula-cache-'));
  cache = new FormulaCache(cacheDir);
  return () => rmSync(cacheDir, { recursive: true, force: true });
});

// ── Mode is explicit and survives the pipeline ───────────────────────────────

describe('inline and display mode are explicit', () => {
  it('marks every inline element inline and every display element display', async () => {
    const html = `<p>${katex('K', false)}</p>${katex('\\int_0^1 x\\,dx', true)}`;
    const { html: out } = await replaceKatexWithImages(html, { cache });

    expect(tagsOf(out, 'inline').length).toBeGreaterThan(0);
    expect(tagsOf(out, 'display').length).toBeGreaterThan(0);
    expect(out).toContain('data-display="false"');
    expect(out).toContain('data-display="true"');
  });

  it('records the intrinsic dimensions on the element', async () => {
    const { html } = await replaceKatexWithImages(`<p>${katex('K', false)}</p>`, { cache });
    const svg = tagsOf(html, 'inline').find(t => t.startsWith('<svg'));

    expect(svg).toMatch(/data-mdtex-w="[\d.]+em"/);
    expect(svg).toMatch(/data-mdtex-h="[\d.]+em"/);
    expect(svg).toMatch(/data-mdtex-va="-?[\d.]+em"/);
  });

  it('never renders the same LaTeX identically inline and in display', async () => {
    const { html: inline } = await replaceKatexWithImages(`<p>${katex('K', false)}</p>`, { cache });
    const { html: display } = await replaceKatexWithImages(katex('K', true), { cache });

    expect(tagsOf(inline, 'display')).toHaveLength(0);
    expect(tagsOf(display, 'inline')).toHaveLength(0);

    // Display maths is centred in its own block; inline maths flows with text.
    expect(display).toContain('text-align:center');
    expect(inline).not.toContain('text-align:center');
  });
});

// ── Inline maths keeps its intrinsic size ────────────────────────────────────

describe('inline maths keeps its intrinsic dimensions', () => {
  it('states a width and height in em, not a percentage', async () => {
    const { html } = await replaceKatexWithImages(`<p>${katex('K', false)}</p>`, { cache });
    for (const tag of tagsOf(html, 'inline')) {
      const style = styleOf(tag);
      expect(style).toMatch(/width:\s*[\d.]+em/);
      expect(style).not.toMatch(FULL_WIDTH);
    }
  });

  it('opts out of responsive sizing', async () => {
    const { html } = await replaceKatexWithImages(`<p>${katex('K', false)}</p>`, { cache });
    for (const tag of tagsOf(html, 'inline')) {
      expect(styleOf(tag)).toContain('max-width:none');
    }
  });

  it('is never a block, and never has centring margins', async () => {
    const { html } = await replaceKatexWithImages(`<p>${katex('K', false)}</p>`, { cache });
    for (const tag of tagsOf(html, 'inline')) {
      const style = styleOf(tag);
      expect(style).not.toMatch(/display:\s*block/);
      expect(style).not.toMatch(/margin:[^;]*auto/);
    }
  });

  it('keeps a baseline offset so it sits on the text baseline', async () => {
    const { html } = await replaceKatexWithImages(`<p>${katex('x_i', false)}</p>`, { cache });
    const span = tagsOf(html, 'inline').find(t => t.startsWith('<span'));
    expect(styleOf(span)).toMatch(/vertical-align:\s*-?[\d.]+em/);
  });

  it('sizes the wrapper too, so a stripped svg still has a sized container', async () => {
    // An <svg> with only a viewBox fills its container: 768px for one glyph.
    // The wrapper is that container, so it carries the dimensions as well.
    const { html } = await replaceKatexWithImages(`<p>${katex('K', false)}</p>`, { cache });
    const span = tagsOf(html, 'inline').find(t => t.startsWith('<span'));
    expect(styleOf(span)).toMatch(/width:\s*[\d.]+em/);
    expect(styleOf(span)).toMatch(/height:\s*[\d.]+em/);
  });

  it('sizes a one-glyph formula far smaller than a long one', async () => {
    const { html } = await replaceKatexWithImages(
      `<p>${katex('K', false)} and ${katex('f(x)=\\sum_{i=1}^{n}\\alpha_i x_i', false)}</p>`,
      { cache },
    );
    const widths = tagsOf(html, 'inline')
      .filter(t => t.startsWith('<svg'))
      .map(t => parseFloat(styleOf(t).match(/width:\s*([\d.]+)em/)[1]));

    expect(widths).toHaveLength(2);
    expect(widths[0]).toBeLessThan(widths[1] / 3);
  });
});

// ── Display maths keeps its own rules ────────────────────────────────────────

describe('display maths keeps its own sizing', () => {
  it('caps at the column width and preserves aspect', async () => {
    const { html } = await replaceKatexWithImages(katex('\\int_0^1 x\\,dx', true), { cache });
    const svg = tagsOf(html, 'display').find(t => t.startsWith('<svg'));
    const style = styleOf(svg);

    expect(style).toContain('max-width:100%');
    expect(style).toContain('height:auto');
    expect(style).toMatch(/width:\s*[\d.]+em/); // not 100%: a short equation must not stretch
    expect(style).not.toMatch(FULL_WIDTH);
  });

  it('scrolls horizontally rather than cropping, and never vertically', async () => {
    const { html } = await replaceKatexWithImages(katex('\\int_0^1 x\\,dx', true), { cache });
    const { html: normalized } = normalizeMathSizing(html);
    const outer = tagsOf(normalized, 'display').find(t => t.startsWith('<section'));

    expect(styleOf(outer)).toContain('overflow-x:auto');
    expect(styleOf(outer)).toContain('overflow-y:visible');
  });
});

// ── Normalization after CSS inlining ─────────────────────────────────────────

describe('leaked styles are removed after CSS inlining', () => {
  const leaked = (mode, extra) =>
    `<span data-mdtex-math="${mode}" data-mdtex-w="0.885em" data-mdtex-h="0.680em" `
    + `data-mdtex-va="0em" style="${extra}">x</span>`;

  it('removes a full-width rule inherited from an image selector', () => {
    const { html } = normalizeMathSizing(leaked('inline', 'width: 100%; display: block; margin: 1em auto;'));
    expect(html).not.toMatch(FULL_WIDTH);
    expect(html).not.toMatch(/display:\s*block/);
    expect(html).toContain('width:0.885em');
  });

  it('removes a declaration that CSS inlining appended after ours', () => {
    // juice puts an !important winner last, and in a style attribute last wins.
    const { html } = normalizeMathSizing(
      leaked('inline', 'display:inline-block;width:0.885em;max-width:none;width: 100%;'),
    );
    const style = html.match(/style="([^"]*)"/)[1];
    expect(style).not.toMatch(FULL_WIDTH);
    expect(style).toContain('width:0.885em');
  });

  it('keeps declarations a theme is entitled to set', () => {
    const { html } = normalizeMathSizing(leaked('inline', 'color: rebeccapurple; fill: red; width: 100%;'));
    expect(html).toContain('color:rebeccapurple');
    expect(html).toContain('fill:red');
    expect(html).not.toMatch(FULL_WIDTH);
  });

  it('removes an overflow rule that would paint a scrollbar beside inline maths', () => {
    const { html } = normalizeMathSizing(leaked('inline', 'overflow: auto;'));
    expect(html).toContain('overflow:visible');
    expect(html).not.toMatch(/overflow:\s*auto/);
  });

  it('leaves elements that are not maths alone', () => {
    const html = '<img src="x.png" style="width: 100%; display: block;">';
    expect(normalizeMathSizing(html).html).toBe(html);
  });

  it('is idempotent', () => {
    const once = normalizeMathSizing(leaked('inline', 'width: 100%; display: block;')).html;
    const twice = normalizeMathSizing(once).html;
    expect(twice).toBe(once);
  });

  it('reports what it changed', () => {
    const result = normalizeMathSizing(leaked('inline', 'width: 100%; display: block;'));
    expect(result.normalized).toBe(1);
    expect(result.stripped).toBeGreaterThan(0);
  });

  it('handles a style value containing a semicolon inside url()', () => {
    // Single quotes: a double quote cannot appear raw inside a "-quoted
    // attribute, so this is the form such a value actually takes.
    const { html } = normalizeMathSizing(
      leaked('inline', "background:url('a;b.png');width:100%;"),
    );
    expect(html).toContain("background:url('a;b.png')");
    expect(html).not.toMatch(FULL_WIDTH);
  });

  it('survives a full compile with a hostile theme', async () => {
    const { Compiler } = await import('../src/core/compiler/index.js');
    const { loadTheme } = await import('../src/core/themes/index.js');
    const css = `${loadTheme('default').css}\n#nice svg { width: 100% !important; display: block !important; }\n`;

    const { html } = await new Compiler().compile('Let $K$ be compact.\n', {
      platform: 'wechat', themeCss: css,
    });

    for (const tag of tagsOf(html, 'inline')) {
      expect(styleOf(tag), tag).not.toMatch(FULL_WIDTH);
      expect(styleOf(tag), tag).not.toMatch(/display:\s*block/);
    }
  });
});

// ── The cache ────────────────────────────────────────────────────────────────

describe('the formula cache distinguishes inline from display', () => {
  it('keys on display mode', () => {
    expect(formulaCacheKey('K', false)).not.toBe(formulaCacheKey('K', true));
  });

  it('stores the two modes separately', () => {
    cache.set('K', false, { svg: '<svg id="inline"/>', widthEx: 1, heightEx: 1, verticalAlignEx: 0 });
    cache.set('K', true, { svg: '<svg id="display"/>', widthEx: 9, heightEx: 9, verticalAlignEx: 0 });

    expect(cache.get('K', false).svg).toContain('inline');
    expect(cache.get('K', true).svg).toContain('display');
    expect(cache.get('K', false).widthEx).toBe(1);
    expect(cache.get('K', true).widthEx).toBe(9);
  });

  it('hands out a copy, so one occurrence cannot mutate another', () => {
    cache.set('K', false, { svg: '<svg/>', widthEx: 1, heightEx: 1, verticalAlignEx: 0 });

    const first = cache.get('K', false);
    const second = cache.get('K', false);
    expect(first).not.toBe(second);

    first.widthEx = 999;
    first.svg = '<svg>mutated</svg>';

    expect(cache.get('K', false).widthEx).toBe(1);
    expect(cache.get('K', false).svg).toBe('<svg/>');
    expect(second.widthEx).toBe(1);
  });

  it('gives repeated occurrences of a formula identical markup', async () => {
    const html = `<p>${katex('K', false)} and again ${katex('K', false)}</p>`;
    const { html: out, stats } = await replaceKatexWithImages(html, { cache });

    const svgs = tagsOf(out, 'inline').filter(t => t.startsWith('<svg'));
    expect(svgs).toHaveLength(2);
    expect(svgs[0]).toBe(svgs[1]);
    expect(stats.cached).toBe(1); // the second was served from the cache
  });

  it('renders the same LaTeX to different geometry in each mode', () => {
    // A single glyph typesets identically in both modes, which is why the cache
    // key cannot rely on the output differing. Limits move above and below the
    // operator in display style, so this one genuinely differs.
    const latex = '\\sum_{i=1}^{n} x_i';
    const inline = renderLatexToSvg(latex, false);
    const display = renderLatexToSvg(latex, true);

    expect(inline.svg).toBeTruthy();
    expect(display.svg).toBeTruthy();
    expect(display.svg).not.toBe(inline.svg);
    expect(display.heightEx).toBeGreaterThan(inline.heightEx);
  });
});

// ── PNG fallback gets the same treatment ─────────────────────────────────────

describe('the PNG fallback is sized the same way', () => {
  it('never emits a full-width or block inline image', async () => {
    const { html } = await replaceKatexWithImages(`<p>${katex('K', false)}</p>`, {
      cache, mathOutput: MathOutput.PNG,
    });
    const img = tagsOf(html, 'inline').find(t => t.startsWith('<img'));
    if (!img) return; // PNG conversion unavailable in this environment

    const style = styleOf(img);
    expect(style).not.toMatch(FULL_WIDTH);
    expect(style).not.toMatch(/display:\s*block/);
    expect(style).toContain('max-width:none');
    expect(style).toMatch(/vertical-align:\s*-?[\d.]+em/);
  }, 60000);
});
