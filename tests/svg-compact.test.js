import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { compactSvg, compactPath } from '../src/core/math/svg-compact.js';
import { renderLatexToSvg } from '../src/core/math/publish-renderer.js';

const FORMULAS = [
  '\\gamma\'(t)',
  '\\int_0^1 f(x)\\,dx < 1',
  '\\sum_{i=1}^n x_i^2 \\le \\Bigl(\\sum_{i=1}^n |x_i|\\Bigr)^2',
  '\\frac{a^p}{p} + \\frac{b^q}{q} \\ge ab',
  '\\sqrt[3]{\\frac{1+\\sqrt{5}}{2}}',
  '\\begin{pmatrix}1 & 0\\\\0 & 1\\end{pmatrix}\\begin{bmatrix}a\\\\b\\end{bmatrix}',
  '\\begin{aligned} \\lVert f+g\\rVert_p &\\le \\lVert f\\rVert_p + \\lVert g\\rVert_p \\\\ &< \\infty \\end{aligned}',
  '\\overline{\\mathbb{R}}\\setminus\\widetilde{X}, \\ \\hat\\mu(\\xi) = \\mathcal{F}\\mu',
  '\\lim_{n\\to\\infty} \\operatorname*{ess\\,sup}_{x\\in X} |f_n(x) - f(x)| = 0',
  'x_{n_{k}}^{(j)} \\xrightarrow[k\\to\\infty]{} x',
];

async function raster(svg, width = 1600) {
  const px = svg.replace(/width="[\d.]+ex"/, `width="${width}"`).replace(/height="[\d.]+ex"/, '');
  return sharp(Buffer.from(px)).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
}

describe('compactSvg', () => {
  it.each(FORMULAS)('renders %s pixel-for-pixel as MathJax drew it', async (tex) => {
    const { svg } = renderLatexToSvg(tex, true, { compact: false });
    const compact = compactSvg(svg);
    expect(compact.length).toBeLessThan(svg.length);

    const a = await raster(svg);
    const b = await raster(compact);
    expect([b.info.width, b.info.height]).toEqual([a.info.width, a.info.height]);
    let differing = 0;
    for (let i = 0; i < a.data.length; i++) if (Math.abs(a.data[i] - b.data[i]) > 8) differing++;
    // Rounding deltas to 1/1000 of a font unit may move an anti-aliased edge
    // by a shade; it may not move a glyph.
    expect(differing / a.data.length).toBeLessThan(0.0005);
  });

  it('shrinks a formula-heavy article substantially', () => {
    let before = 0, after = 0;
    for (const tex of FORMULAS) {
      const { svg } = renderLatexToSvg(tex, false, { compact: false });
      before += svg.length;
      after += compactSvg(svg).length;
    }
    expect(after / before).toBeLessThan(0.75);
  });

  it('is what the publish renderer emits by default', () => {
    const raw = renderLatexToSvg('x^2', false, { compact: false }).svg;
    expect(renderLatexToSvg('x^2', false).svg).toBe(compactSvg(raw));
  });

  it('keeps only paths and the groups that still carry a transform or style', () => {
    const { svg } = renderLatexToSvg('a+b', false, { compact: false });
    const compact = compactSvg(svg);
    expect(compact).not.toMatch(/<g>/);
    expect(compact).not.toMatch(/<(use|defs|symbol)\b/);
  });
});

describe('compactPath', () => {
  it('writes relative segments and omits repeated command letters', () => {
    expect(compactPath('M100 200L110 200L120 210Z')).toBe('M100 200h10l10 10z');
  });

  it('leaves a path it does not understand untouched', () => {
    expect(compactPath('M0 0A5 5 0 0 1 10 10')).toBe('M0 0A5 5 0 0 1 10 10');
    expect(compactPath('M0 0 foo')).toBe('M0 0 foo');
  });
});
