import { describe, it, expect, beforeEach } from 'vitest';
import { renderLatexToSvg, renderLatexToDataUri } from '../src/core/math/publish-renderer.js';
import { replaceKatexWithImages, MathOutput } from '../src/core/math/post-processor.js';
import { FormulaCache, formulaCacheKey } from '../src/core/math/formula-cache.js';
import { svgToPng } from '../src/core/math/svg-to-png.js';
import { Compiler } from '../src/core/compiler/index.js';
import { renderToHtml } from '../src/core/renderer/index.js';
import { readFileSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, existsSync } from 'fs';

const fixtureDir = resolve(import.meta.dirname, 'fixtures');

describe('PublishMathRenderer (MathJax SVG)', () => {
  it('should render inline math to SVG with ex dimensions', () => {
    const result = renderLatexToSvg('E=mc^2', false);
    expect(result.error).toBeNull();
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('<path');
    expect(result.svg).not.toContain('class=');
    expect(result.widthEx).toBeGreaterThan(0);
    expect(result.heightEx).toBeGreaterThan(0);
  });

  it('should render display math to SVG', () => {
    const result = renderLatexToSvg('\\int_0^1 x^2\\,\\mathrm{d}x = \\frac{1}{3}', true);
    expect(result.error).toBeNull();
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('<path');
  });

  it('should render fractions', () => {
    const result = renderLatexToSvg('\\frac{a}{b}', false);
    expect(result.error).toBeNull();
    expect(result.svg.length).toBeGreaterThan(100);
  });

  it('should render matrices', () => {
    const result = renderLatexToSvg('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', true);
    expect(result.error).toBeNull();
    expect(result.svg).toContain('<svg');
  });

  it('should render aligned equations', () => {
    const result = renderLatexToSvg('\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}', true);
    expect(result.error).toBeNull();
    expect(result.svg.length).toBeGreaterThan(100);
  });

  it('should render Greek letters', () => {
    const result = renderLatexToSvg('\\alpha + \\beta = \\gamma', false);
    expect(result.error).toBeNull();
  });

  it('should render blackboard bold', () => {
    const result = renderLatexToSvg('\\mathbb{R}', false);
    expect(result.error).toBeNull();
  });

  it('should handle invalid LaTeX gracefully', () => {
    const result = renderLatexToSvg('\\begin{invalid}', false);
    expect(typeof result.error === 'string' || result.svg).toBeTruthy();
  });

  it('should produce non-zero ex dimensions', () => {
    const result = renderLatexToSvg('x^2 + y^2 = z^2', false);
    expect(result.error).toBeNull();
    expect(result.widthEx).toBeGreaterThan(0);
    expect(result.heightEx).toBeGreaterThan(0);
    expect(isNaN(result.widthEx)).toBe(false);
  });

  it('should produce data URI via renderLatexToDataUri', () => {
    const result = renderLatexToDataUri('a + b', false);
    expect(result.error).toBeNull();
    expect(result.dataUri).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('should provide verticalAlignEx for inline math', () => {
    const result = renderLatexToSvg('x_i', false);
    expect(result.error).toBeNull();
    expect(typeof result.verticalAlignEx).toBe('number');
  });

  it('should preserve viewBox', () => {
    const result = renderLatexToSvg('\\sum_{i=1}^n x_i', true);
    expect(result.error).toBeNull();
    expect(result.viewBox).toBeTruthy();
    expect(result.viewBox.split(' ')).toHaveLength(4);
  });

  it('should strip data attributes for smaller SVG', () => {
    const result = renderLatexToSvg('x', false);
    expect(result.svg).not.toContain('data-mml-node');
    expect(result.svg).not.toContain('data-c=');
  });

  it('should not contain defs, use, id, or class', () => {
    const result = renderLatexToSvg('\\int_0^1 f(x)\\,dx', true);
    expect(result.svg).not.toContain('<defs');
    expect(result.svg).not.toContain('<use');
    expect(result.svg).not.toMatch(/\bid="/);
    expect(result.svg).not.toMatch(/\bclass="/);
  });
});

describe('SVG to PNG', () => {
  it('should convert SVG to PNG buffer', async () => {
    const { svg } = renderLatexToSvg('E=mc^2', false);
    const result = await svgToPng(svg, { scale: 2 });
    expect(result.pngBuffer).toBeInstanceOf(Buffer);
    expect(result.pngBuffer.length).toBeGreaterThan(0);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });
});

describe('FormulaCache', () => {
  const testCacheDir = join(tmpdir(), `publisher-formula-cache-test-${process.pid}`);

  beforeEach(() => {
    if (existsSync(testCacheDir)) rmSync(testCacheDir, { recursive: true, force: true });
  });

  it('should cache and retrieve formula assets', () => {
    const cache = new FormulaCache(testCacheDir);
    const { svg, widthEx, heightEx, verticalAlignEx, viewBox } = renderLatexToSvg('x^2', false);

    cache.set('x^2', false, { svg, widthEx, heightEx, verticalAlignEx, viewBox });

    const retrieved = cache.get('x^2', false);
    expect(retrieved).not.toBeNull();
    expect(retrieved.svg).toBe(svg);
    expect(retrieved.widthEx).toBe(widthEx);
  });

  it('should produce deterministic cache keys', () => {
    const k1 = formulaCacheKey('x^2', false);
    const k2 = formulaCacheKey('x^2', false);
    const k3 = formulaCacheKey('x^2', true);
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });
});

describe('Math Post-Processor', () => {
  it('should replace inline KaTeX with inline SVG', async () => {
    const html = renderToHtml('The value $x^2$ is important.');
    const cache = new FormulaCache(join(tmpdir(), `pp-test-${process.pid}-${Date.now()}`));
    const { html: processed, stats, errors } = await replaceKatexWithImages(html, {
      mathOutput: MathOutput.SVG,
      cache,
    });

    expect(errors).toHaveLength(0);
    expect(stats.inlineRendered).toBe(1);
    expect(processed).not.toContain('<eq>');
    expect(processed).not.toContain('<annotation');
    expect(processed).toContain('data-latex=');
    expect(processed).toContain('<svg');          // inline SVG, not data URI
    expect(processed).toContain('data-display="false"');
  });

  it('should replace display KaTeX with inline SVG section', async () => {
    const html = renderToHtml('Display:\n\n$$\\sum_{i=1}^n x_i$$');
    const cache = new FormulaCache(join(tmpdir(), `pp-test2-${process.pid}-${Date.now()}`));
    const { html: processed, stats, errors } = await replaceKatexWithImages(html, {
      mathOutput: MathOutput.SVG,
      cache,
    });

    expect(errors).toHaveLength(0);
    expect(stats.displayRendered).toBe(1);
    expect(processed).not.toContain('<eqn>');
    expect(processed).toContain('data-display="true"');
    expect(processed).toContain('text-align:center');
    expect(processed).toContain('<svg');
  });

  it('should preserve original LaTeX in data-latex attribute', async () => {
    const html = renderToHtml('Check $\\alpha + \\beta$.');
    const cache = new FormulaCache(join(tmpdir(), `pp-test3-${process.pid}-${Date.now()}`));
    const { html: processed } = await replaceKatexWithImages(html, {
      mathOutput: MathOutput.SVG,
      cache,
    });

    expect(processed).toContain('data-latex=');
    expect(processed).toContain('alpha');
    expect(processed).toContain('beta');
  });

  it('should handle PNG output mode', async () => {
    const html = renderToHtml('Value $a$.');
    const cache = new FormulaCache(join(tmpdir(), `pp-test4-${process.pid}-${Date.now()}`));
    const { html: processed, errors } = await replaceKatexWithImages(html, {
      mathOutput: MathOutput.PNG,
      cache,
    });

    expect(errors).toHaveLength(0);
    expect(processed).toContain('data:image/png');
  });
});

describe('Full Pipeline Formula Preservation', () => {
  it('should preserve all formulas in math_formulas.md', async () => {
    const source = readFileSync(resolve(fixtureDir, 'math_formulas.md'), 'utf-8');
    const compiler = new Compiler();
    const result = await compiler.compile(source, {
      theme: 'default',
      platform: 'wechat',
      baseDir: fixtureDir,
    });

    const sourceDisplay = result.mathStats.display;
    const sourceInline = result.mathStats.inline;
    const renderedTotal = result.mathResult.inlineRendered + result.mathResult.displayRendered;

    expect(result.mathResult.errors).toBe(0);
    expect(renderedTotal).toBe(sourceDisplay + sourceInline);

    // No KaTeX HTML remnants
    expect(result.html).not.toContain('<eq>');
    expect(result.html).not.toContain('<eqn>');
    expect(result.html).not.toContain('<annotation');

    // Must have inline SVGs
    expect(result.html).toContain('<svg');
    expect(result.html).toContain('data-latex=');

    // No external CSS dependency
    expect(result.html).not.toContain('katex.min.css');
    expect(result.html).not.toContain('<link');

    // No <img src="data:svg"> (should be inline SVG now)
    expect(result.html).not.toMatch(/src="data:image\/svg\+xml/);
  });

  it('should preserve all formulas in math_article.md', async () => {
    const source = readFileSync(resolve(fixtureDir, 'math_article.md'), 'utf-8');
    const compiler = new Compiler();
    const result = await compiler.compile(source, {
      theme: 'default',
      platform: 'wechat',
      baseDir: fixtureDir,
    });

    expect(result.mathResult.errors).toBe(0);
    const total = result.mathResult.inlineRendered + result.mathResult.displayRendered;
    expect(total).toBeGreaterThan(0);

    expect(result.html).toContain('贝叶斯推断');
    expect(result.html).toContain('ELBO');
    expect(result.html).toContain('variational_inference');
  });

  it('should work with Zhihu target', async () => {
    const source = 'Inline $x^2$ and display:\n\n$$y = mx + b$$';
    const compiler = new Compiler();
    const result = await compiler.compile(source, {
      theme: 'default',
      platform: 'zhihu',
      baseDir: '.',
    });

    expect(result.mathResult.errors).toBe(0);
    expect(result.html).toContain('data-latex=');
    expect(result.html).not.toContain('<eq>');
  });
});
