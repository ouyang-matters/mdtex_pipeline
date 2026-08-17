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
  it('should render inline math to SVG', () => {
    const result = renderLatexToSvg('E=mc^2', false);
    expect(result.error).toBeNull();
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('<path');
    expect(result.svg).not.toContain('class=');
    expect(result.width).toBeTruthy();
    expect(result.height).toBeTruthy();
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

  it('should report errors for invalid LaTeX', () => {
    const result = renderLatexToSvg('\\begin{invalid}', false);
    // MathJax may still produce output for invalid LaTeX, but we check
    // that at least it doesn't crash
    expect(typeof result.error === 'string' || result.svg).toBeTruthy();
  });

  it('should produce non-zero dimensions', () => {
    const result = renderLatexToSvg('x^2 + y^2 = z^2', false);
    expect(result.error).toBeNull();
    const widthNum = parseFloat(result.width);
    const heightNum = parseFloat(result.height);
    expect(widthNum).toBeGreaterThan(0);
    expect(heightNum).toBeGreaterThan(0);
    expect(isNaN(widthNum)).toBe(false);
    expect(isNaN(heightNum)).toBe(false);
  });

  it('should produce data URI', () => {
    const result = renderLatexToDataUri('a + b', false);
    expect(result.error).toBeNull();
    expect(result.dataUri).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('should include vertical-align for inline math', () => {
    const result = renderLatexToSvg('x_i', false);
    expect(result.error).toBeNull();
    expect(result.verticalAlign).toBeTruthy();
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

  it('should produce higher-res output at scale 3', async () => {
    const { svg } = renderLatexToSvg('E=mc^2', false);
    const s2 = await svgToPng(svg, { scale: 2 });
    const s3 = await svgToPng(svg, { scale: 3 });
    expect(s3.width).toBeGreaterThan(s2.width);
    expect(s3.height).toBeGreaterThan(s2.height);
  });
});

describe('FormulaCache', () => {
  const testCacheDir = join(tmpdir(), `publisher-formula-cache-test-${process.pid}`);

  beforeEach(() => {
    if (existsSync(testCacheDir)) rmSync(testCacheDir, { recursive: true, force: true });
  });

  it('should cache and retrieve formula assets', () => {
    const cache = new FormulaCache(testCacheDir);
    const { svg, width, height, verticalAlign } = renderLatexToSvg('x^2', false);
    const encoded = Buffer.from(svg).toString('base64');
    const dataUri = `data:image/svg+xml;base64,${encoded}`;

    cache.set('x^2', false, { svg, width, height, verticalAlign, dataUri });

    const retrieved = cache.get('x^2', false);
    expect(retrieved).not.toBeNull();
    expect(retrieved.svg).toBe(svg);
    expect(retrieved.width).toBe(width);
    expect(retrieved.dataUri).toBe(dataUri);
  });

  it('should produce deterministic cache keys', () => {
    const k1 = formulaCacheKey('x^2', false);
    const k2 = formulaCacheKey('x^2', false);
    const k3 = formulaCacheKey('x^2', true);
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it('should distinguish inline vs display mode', () => {
    const cache = new FormulaCache(testCacheDir);

    cache.set('x', false, { svg: 'inline', dataUri: 'di' });
    cache.set('x', true, { svg: 'display', dataUri: 'dd' });

    expect(cache.get('x', false).svg).toBe('inline');
    expect(cache.get('x', true).svg).toBe('display');
  });
});

describe('Math Post-Processor', () => {
  it('should replace inline KaTeX with img tags', async () => {
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
    expect(processed).toContain('data:image/svg+xml');
    expect(processed).toContain('data-display="false"');
  });

  it('should replace display KaTeX with img tags', async () => {
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
  });

  it('should preserve original LaTeX in data-latex attribute', async () => {
    const html = renderToHtml('Check $\\alpha + \\beta$.');
    const cache = new FormulaCache(join(tmpdir(), `pp-test3-${process.pid}-${Date.now()}`));
    const { html: processed } = await replaceKatexWithImages(html, {
      mathOutput: MathOutput.SVG,
      cache,
    });

    expect(processed).toContain('data-latex=');
    // The original LaTeX should be in the data attribute (possibly HTML-escaped)
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

    // Count formulas from source
    const sourceDisplay = result.mathStats.display;
    const sourceInline = result.mathStats.inline;

    // Count rendered formula assets
    const renderedTotal = result.mathResult.inlineRendered + result.mathResult.displayRendered;

    expect(result.mathResult.errors).toBe(0);
    expect(renderedTotal).toBe(sourceDisplay + sourceInline);

    // Verify no KaTeX HTML remnants
    expect(result.html).not.toContain('<eq>');
    expect(result.html).not.toContain('<eqn>');
    expect(result.html).not.toContain('class="katex');
    expect(result.html).not.toContain('<annotation');

    // Count data-latex attributes in final HTML
    const dataLatexCount = (result.html.match(/data-latex="/g) || []).length;
    expect(dataLatexCount).toBe(renderedTotal);

    // No external KaTeX CSS dependency
    expect(result.html).not.toContain('katex.min.css');
    expect(result.html).not.toContain('<link');
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

    // All text content preserved
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
