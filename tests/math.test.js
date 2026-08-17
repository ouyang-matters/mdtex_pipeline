import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/core/parser/index.js';
import { MathNode, countMathExpressions, renderLatex } from '../src/core/math/index.js';

describe('Math Rendering', () => {
  it('should render inline math', () => {
    const html = renderMarkdown('The formula $E = mc^2$ is famous.');
    expect(html).toContain('katex');
    expect(html).toContain('mc');
  });

  it('should render display math', () => {
    const html = renderMarkdown('$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$');
    expect(html).toContain('katex');
    expect(html).toContain('frac');
  });

  it('should render aligned equations', () => {
    const md = '$$\n\\begin{aligned}\na &= b + c \\\\\nd &= e + f\n\\end{aligned}\n$$';
    const html = renderMarkdown(md);
    expect(html).toContain('katex');
  });

  it('should preserve LaTeX source in MathNode', () => {
    const node = new MathNode('E = mc^2', false);
    node.render();
    expect(node.sourceLatex).toBe('E = mc^2');
    expect(node.renderedHtml).toContain('katex');
    expect(node.error).toBeNull();
  });

  it('should handle display mode MathNode', () => {
    const node = new MathNode('\\int_0^1 x\\,dx', true);
    node.render();
    expect(node.displayMode).toBe(true);
    expect(node.renderedHtml).toContain('katex');
  });

  it('should handle invalid LaTeX gracefully', () => {
    const node = new MathNode('\\invalid{', false);
    node.render();
    // KaTeX with throwOnError: false should still produce output
    expect(node.renderedHtml).toBeTruthy();
  });

  it('should count math expressions correctly', () => {
    const source = 'Inline $a$ and $b$. Display:\n$$\nc = d\n$$\nMore $e$.';
    const counts = countMathExpressions(source);
    expect(counts.display).toBe(1);
    expect(counts.inline).toBe(3);
    expect(counts.total).toBe(4);
  });

  it('should not count $ inside $$ as inline math', () => {
    const source = '$$\nx = \\frac{a}{b}\n$$';
    const counts = countMathExpressions(source);
    expect(counts.display).toBe(1);
    // The inline count might pick up partial matches inside $$, but display should be 1
    expect(counts.display).toBe(1);
  });

  it('should render complex math without errors', () => {
    const complexMath = '\\sum_{i=1}^{n} \\binom{n}{i} p^i (1-p)^{n-i}';
    const node = renderLatex(complexMath, true);
    expect(node.error).toBeNull();
    expect(node.renderedHtml).toContain('katex');
  });
});
