import { describe, it, expect } from 'vitest';
import { renderLatexToSvg } from '../src/core/math/publish-renderer.js';
import { Compiler } from '../src/core/compiler/index.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const fixtureDir = resolve(import.meta.dirname, 'fixtures');

describe('Formula SVG dimensions', () => {
  it('should produce pixel-based width/height (not ex)', () => {
    const r = renderLatexToSvg('E=mc^2', false);
    expect(r.error).toBeNull();
    expect(r.svg).toMatch(/width="\d+"/);
    expect(r.svg).toMatch(/height="\d+"/);
    expect(r.svg).not.toMatch(/width="[\d.]+ex"/);
    expect(r.svg).not.toMatch(/height="[\d.]+ex"/);
  });

  it('should have valid viewBox', () => {
    const r = renderLatexToSvg('\\frac{a}{b}', false);
    const vb = r.svg.match(/viewBox="([^"]+)"/);
    expect(vb).not.toBeNull();
    const parts = vb[1].split(' ').map(Number);
    expect(parts).toHaveLength(4);
    expect(parts[2]).toBeGreaterThan(0);
    expect(parts[3]).toBeGreaterThan(0);
  });

  it('should provide widthPx/heightPx as positive numbers', () => {
    const r = renderLatexToSvg('x_i^2', false);
    expect(r.widthPx).toBeGreaterThan(0);
    expect(r.heightPx).toBeGreaterThan(0);
    expect(isNaN(r.widthPx)).toBe(false);
    expect(isNaN(r.heightPx)).toBe(false);
  });

  it('should provide widthEx/heightEx for em conversion', () => {
    const r = renderLatexToSvg('\\int_0^1 x\\,dx', true);
    expect(r.widthEx).toBeGreaterThan(0);
    expect(r.heightEx).toBeGreaterThan(0);
  });

  it('should not include inline style attribute in SVG', () => {
    const r = renderLatexToSvg('x', false);
    expect(r.svg).not.toMatch(/<svg[^>]*style="/);
  });
});

describe('Formula img tag sizing', () => {
  it('inline formula should use em-based height', async () => {
    const compiler = new Compiler();
    const result = await compiler.compile('Text $x^2$ text.', {
      theme: 'default', platform: 'wechat', baseDir: '.',
    });

    const imgMatch = result.html.match(/<img[^>]*data-display="false"[^>]*style="([^"]*)"/);
    expect(imgMatch).not.toBeNull();
    const style = imgMatch[1];
    // em-based height (may have spaces from juice: "height: 0.893em")
    expect(style).toMatch(/height:\s*[\d.]+em/);
    expect(style).toMatch(/width:\s*[\d.]+em/);
    expect(style).toMatch(/vertical-align:\s*-?[\d.]+em/);
    // Must not be zero
    const heightVal = parseFloat(style.match(/height:\s*([\d.]+)em/)[1]);
    expect(heightVal).toBeGreaterThan(0);
  });

  it('display formula should have max-width constraint', async () => {
    const compiler = new Compiler();
    const result = await compiler.compile('Display:\n\n$$\\sum_{i=1}^n x_i$$', {
      theme: 'default', platform: 'wechat', baseDir: '.',
    });

    const imgMatch = result.html.match(/<img[^>]*data-display="true"[^>]*style="([^"]*)"/);
    expect(imgMatch).not.toBeNull();
    const style = imgMatch[1];
    expect(style).toMatch(/max-width:\s*100%/);
    expect(style).toMatch(/height:\s*auto/);
  });

  it('display formula container should not clip content', async () => {
    const compiler = new Compiler();
    const result = await compiler.compile('$$\\mathcal{L}(\\theta) = \\sum_{i=1}^{N} y_i \\log \\sigma(\\theta^T x_i)$$', {
      theme: 'default', platform: 'wechat', baseDir: '.',
    });

    // Should not have overflow:hidden or overflow-y:hidden
    expect(result.html).not.toMatch(/overflow:\s*hidden/);
    expect(result.html).not.toMatch(/overflow-y:\s*hidden/);
  });

  it('long display equation width should be positive em value', async () => {
    const longEq = '\\mathcal{L}(\\theta; \\mathcal{D}) = \\sum_{i=1}^{N} \\left[ y_i \\log \\sigma(\\theta^T x_i) + (1 - y_i) \\log(1 - \\sigma(\\theta^T x_i)) \\right]';
    const compiler = new Compiler();
    const result = await compiler.compile(`Display:\n\n$$${longEq}$$`, {
      theme: 'default', platform: 'wechat', baseDir: '.',
    });

    const imgMatch = result.html.match(/<img[^>]*data-display="true"[^>]*style="([^"]*)"/);
    const style = imgMatch[1];
    expect(style).toMatch(/max-width:\s*100%/);
    const widthVal = parseFloat(style.match(/width:\s*([\d.]+)em/)[1]);
    expect(widthVal).toBeGreaterThan(0);
  });
});

describe('Formula sizing in full fixture', () => {
  it('should render all formula types with valid dimensions', async () => {
    const source = readFileSync(resolve(fixtureDir, 'math_formulas.md'), 'utf-8');
    const compiler = new Compiler();
    const result = await compiler.compile(source, {
      theme: 'default', platform: 'wechat', baseDir: fixtureDir,
    });

    expect(result.mathResult.errors).toBe(0);

    // No zero or NaN em dimensions (with or without spaces from juice)
    expect(result.html).not.toMatch(/width:\s*0\.000em/);
    expect(result.html).not.toMatch(/height:\s*0\.000em/);
    expect(result.html).not.toMatch(/width:\s*NaNem/);

    // All display formulas should have max-width constraint
    const displayImgs = result.html.match(/<img[^>]*data-display="true"[^>]*/g) || [];
    for (const img of displayImgs) {
      expect(img).toMatch(/max-width:\s*100%/);
    }

    // All inline formulas should have positive em-based sizing
    const inlineStyles = [...result.html.matchAll(/<img[^>]*data-display="false"[^>]*style="([^"]*)"/g)];
    for (const [, style] of inlineStyles) {
      const h = parseFloat(style.match(/height:\s*([\d.]+)em/)?.[1] || '0');
      expect(h).toBeGreaterThan(0);
    }
  });
});
