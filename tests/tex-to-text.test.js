import { describe, it, expect } from 'vitest';
import { texToText } from '../src/core/math/tex-to-text.js';
import { Compiler } from '../src/core/compiler/index.js';

describe('texToText', () => {
  it.each([
    ['V', 'V'],
    ['\\ker A', 'ker A'],
    ['\\operatorname{im} A', 'im A'],
    ['A^{-1}(y)', 'A⁻¹(y)'],
    ['r \\cdot (1,0,-1)', 'r · (1,0,−1)'],
    ['-1', '−1'],
    ['x_i^2', 'xᵢ²'],
    ['\\mathbb{R}^3', 'ℝ³'],
    ['A^\\top', 'Aᵀ'],
    ['V / \\ker A', 'V / ker A'],
    ['\\theta_0 + \\ker A', 'θ₀ + ker A'],
    ['\\gamma\'(t)', 'γ′(t)'],
    ['x_{ab}', 'x_(ab)'],
    ['\\bar{A}', 'A\u0304'],
  ])('%s → %s', (tex, text) => {
    expect(texToText(tex)).toBe(text);
  });

  it('leaves what it cannot write as text in TeX', () => {
    expect(texToText('\\frac{1}{2}')).toBe('\\frac{1}{2}');
    expect(texToText('\\sum_{i=1}^n x_i')).toBe('\\sum_{i=1}^n x_i');
  });
});

describe('Zhihu tables', () => {
  it('writes formulas in table cells as text, and keeps native formulas elsewhere', async () => {
    const source = 'Before $\\ker A$.\n\n| a | b |\n| --- | --- |\n| $A^{-1}(y)$ | $r \\cdot (1,0,-1)$ |\n\nAfter $x$.';
    const result = await new Compiler().compile(source, { theme: 'default', platform: 'zhihu', includePlainText: true });
    const table = result.html.match(/<table[\s\S]*<\/table>/)[0];
    expect(table).not.toContain('eeimg');
    expect(table).toContain('A⁻¹(y)');
    expect(table).toContain('r · (1,0,−1)');
    expect((result.html.match(/eeimg="1"/g) || []).length).toBe(2);
    expect(result.validation.valid).toBe(true);
    // The source TeX still reaches the plain-text flavour.
    expect(result.plainText).toContain('$A^{-1}(y)$');
  });
});
