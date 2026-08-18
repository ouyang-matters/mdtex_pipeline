import { describe, it, expect } from 'vitest';
import { renderLatexToSvg } from '../src/core/math/publish-renderer.js';
import { Compiler } from '../src/core/compiler/index.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const fixtureDir = resolve(import.meta.dirname, 'fixtures');

describe('Formula SVG dimensions', () => {
  it('should retain ex-based width/height in SVG for proper scaling', () => {
    const r = renderLatexToSvg('E=mc^2', false);
    expect(r.error).toBeNull();
    // SVG retains ex units; the container wrapper handles em conversion
    expect(r.svg).toMatch(/width="[\d.]+ex"/);
    expect(r.svg).toMatch(/height="[\d.]+ex"/);
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

  it('should provide widthEx/heightEx as positive numbers', () => {
    const r = renderLatexToSvg('x_i^2', false);
    expect(r.widthEx).toBeGreaterThan(0);
    expect(r.heightEx).toBeGreaterThan(0);
    expect(isNaN(r.widthEx)).toBe(false);
  });

  it('should not include inline style in SVG element', () => {
    const r = renderLatexToSvg('x', false);
    expect(r.svg).not.toMatch(/<svg[^>]*style="/);
  });

  it('should strip role and focusable attributes', () => {
    const r = renderLatexToSvg('x', false);
    expect(r.svg).not.toContain('role=');
    expect(r.svg).not.toContain('focusable=');
  });
});

describe('Inline SVG formula sizing in output', () => {
  it('inline formula should use em-based span wrapper', async () => {
    const compiler = new Compiler();
    const result = await compiler.compile('Text $x^2$ text.', {
      theme: 'default', platform: 'wechat', baseDir: '.',
    });

    // Should have a span wrapper with em-based sizing
    const spanMatch = result.html.match(/<span[^>]*data-display="false"[^>]*style="([^"]*)"/);
    expect(spanMatch).not.toBeNull();
    const style = spanMatch[1];
    expect(style).toContain('inline-block');
    expect(style).toMatch(/vertical-align:\s*-?[\d.]+em/);
  });

  it('display formula should be in centered section', async () => {
    const compiler = new Compiler();
    const result = await compiler.compile('Display:\n\n$$\\sum_{i=1}^n x_i$$', {
      theme: 'default', platform: 'wechat', baseDir: '.',
    });

    const sectionMatch = result.html.match(/<section[^>]*data-display="true"[^>]*style="([^"]*)"/);
    expect(sectionMatch).not.toBeNull();
    const style = sectionMatch[1];
    expect(style).toMatch(/text-align:\s*center/);
  });

  it('display formula container should not clip content', async () => {
    const compiler = new Compiler();
    const result = await compiler.compile('$$\\mathcal{L}(\\theta) = \\sum_{i=1}^{N} y_i \\log \\sigma(\\theta^T x_i)$$', {
      theme: 'default', platform: 'wechat', baseDir: '.',
    });

    expect(result.html).not.toMatch(/overflow:\s*hidden/);
    expect(result.html).not.toMatch(/overflow-y:\s*hidden/);
  });

  it('long display equation should contain max-width constraint', async () => {
    const longEq = '\\mathcal{L}(\\theta; \\mathcal{D}) = \\sum_{i=1}^{N} \\left[ y_i \\log \\sigma(\\theta^T x_i) + (1 - y_i) \\log(1 - \\sigma(\\theta^T x_i)) \\right]';
    const compiler = new Compiler();
    const result = await compiler.compile(`Display:\n\n$$${longEq}$$`, {
      theme: 'default', platform: 'wechat', baseDir: '.',
    });

    // The inner wrapper should have max-width:100%
    expect(result.html).toMatch(/max-width:\s*100%/);
  });
});

describe('Formula sizing in full fixture', () => {
  it('should render all formula types with valid inline SVGs', async () => {
    const source = readFileSync(resolve(fixtureDir, 'math_formulas.md'), 'utf-8');
    const compiler = new Compiler();
    const result = await compiler.compile(source, {
      theme: 'default', platform: 'wechat', baseDir: fixtureDir,
    });

    expect(result.mathResult.errors).toBe(0);

    // All formulas should be inline SVGs
    expect(result.html).toContain('<svg');
    expect(result.html).toContain('viewBox=');

    // All display formulas should be centered sections
    const displaySections = result.html.match(/<section[^>]*data-display="true"/g) || [];
    expect(displaySections.length).toBeGreaterThan(0);

    // All inline formulas should be span wrappers
    const inlineSpans = result.html.match(/<span[^>]*data-display="false"/g) || [];
    expect(inlineSpans.length).toBeGreaterThan(0);

    // No data URI images for SVG mode
    expect(result.html).not.toMatch(/src="data:image\/svg/);
  });

  it('WeChat output should not depend on external KaTeX CSS', async () => {
    const source = readFileSync(resolve(fixtureDir, 'math_formulas.md'), 'utf-8');
    const compiler = new Compiler();
    const result = await compiler.compile(source, {
      theme: 'default', platform: 'wechat', baseDir: fixtureDir,
    });

    // No external stylesheet references
    expect(result.html).not.toContain('<link');
    expect(result.html).not.toContain('katex');
    expect(result.html).not.toContain('<style');

    // Theme CSS should be fully inlined
    expect(result.html).not.toMatch(/class="katex/);
  });
});
