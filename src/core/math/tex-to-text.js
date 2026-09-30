/**
 * Best-effort Unicode text for a short TeX formula.
 *
 * For places that can hold only text, never a formula — Zhihu's table cells
 * are the case that needs it. `\operatorname{im} A` becomes `im A`,
 * `A^{-1}(y)` becomes `A⁻¹(y)`, `r \cdot (1,0,-1)` becomes `r · (1,0,−1)`.
 *
 * It maps what it knows and leaves everything else as written: a formula it
 * cannot express in text keeps its TeX, which is still more honest than a
 * garbled approximation.
 */

const SYMBOLS = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', circ: '∘', ast: '∗',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', cong: '≅',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
  to: '→', rightarrow: '→', leftarrow: '←', mapsto: '↦', Rightarrow: '⇒', Leftrightarrow: '⇔', iff: '⇔', implies: '⇒',
  oplus: '⊕', otimes: '⊗', perp: '⊥', parallel: '∥', infty: '∞', partial: '∂', nabla: '∇',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
  langle: '⟨', rangle: '⟩', lVert: '‖', rVert: '‖', Vert: '‖', vert: '|', mid: '|',
  ldots: '…', dots: '…', cdots: '⋯', top: 'ᵀ', prime: '′',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

// Operator names that print as upright words.
const WORDS = new Set([
  'ker', 'im', 'dim', 'det', 'rank', 'tr', 'span', 'sin', 'cos', 'tan', 'log', 'ln', 'exp',
  'max', 'min', 'sup', 'inf', 'lim', 'arg', 'deg', 'gcd', 'Hom', 'End', 'id',
]);

const SPACING = { ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', quad: ' ', qquad: '  ' };
const DELIMS = { '{': '{', '}': '}', '|': '‖', '%': '%', '&': '&', '_': '_', '#': '#', '$': '$' };
const BLACKBOARD = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', F: '𝔽', P: 'ℙ' };
const ACCENTS = { bar: '̄', overline: '̅', tilde: '̃', widetilde: '̃', hat: '̂', widehat: '̂', vec: '⃗', dot: '̇' };
const PASS_THROUGH = new Set(['operatorname', 'mathrm', 'text', 'textrm', 'mathbf', 'boldsymbol', 'mathit', 'mathsf', 'mathcal', 'mathscr', 'left', 'right', 'big', 'Big', 'bigl', 'bigr', 'Bigl', 'Bigr']);

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', T: 'ᵀ', ᵀ: 'ᵀ', '*': '*', '′': '′', k: 'ᵏ', m: 'ᵐ' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', n: 'ₙ', m: 'ₘ', x: 'ₓ', o: 'ₒ', r: 'ᵣ', t: 'ₜ' };

// Constructs that cannot be written as a line of text.
const UNREPRESENTABLE = /\\(frac|dfrac|tfrac|sqrt|begin|sum|prod|int|oint|binom|substack|stackrel|overset|underset|underbrace|overbrace)(?![A-Za-z])/;

export function texToText(tex) {
  const source = String(tex).trim();
  if (UNREPRESENTABLE.test(source)) return source;

  let pos = 0;

  const readGroup = () => {
    while (source[pos] === ' ') pos++;
    if (source[pos] === '{') {
      let depth = 1;
      const start = ++pos;
      while (pos < source.length && depth > 0) {
        if (source[pos] === '\\') { pos += 2; continue; }
        if (source[pos] === '{') depth++;
        else if (source[pos] === '}') depth--;
        pos++;
      }
      return source.slice(start, pos - 1);
    }
    if (source[pos] === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(source.slice(pos));
      pos += m[0].length;
      return m[0];
    }
    return source[pos++] ?? '';
  };

  const script = (body, table, marker) => {
    const text = texToText(body);
    const chars = [...text];
    if (chars.every(ch => table[ch])) return chars.map(ch => table[ch]).join('');
    return chars.length === 1 ? `${marker}${text}` : `${marker}(${text})`;
  };

  let out = '';
  while (pos < source.length) {
    const ch = source[pos];
    if (ch === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(source.slice(pos));
      pos += m[0].length;
      const name = m[1];
      if (name in SYMBOLS) out += SYMBOLS[name];
      else if (WORDS.has(name)) out += name;
      else if (name in SPACING) out += SPACING[name];
      else if (name in DELIMS) out += DELIMS[name];
      else if (name === 'mathbb') {
        const arg = readGroup();
        out += [...arg].map(c => BLACKBOARD[c] || c).join('');
      } else if (name in ACCENTS) {
        const arg = texToText(readGroup());
        out += [...arg].map(c => c + ACCENTS[name]).join('');
      } else if (PASS_THROUGH.has(name)) {
        // \left( … \right) and font commands: keep only what they wrap.
        if (!/^(left|right|[bB]ig[lr]?)$/.test(name)) out += texToText(readGroup());
      } else {
        out += m[0]; // unknown: leave as written
      }
    } else if (ch === '^') {
      pos++;
      out += script(readGroup(), SUP, '^');
    } else if (ch === '_') {
      pos++;
      out += script(readGroup(), SUB, '_');
    } else if (ch === '{' || ch === '}') {
      pos++;
    } else if (ch === '-') {
      out += '−';
      pos++;
    } else if (ch === "'") {
      out += '′';
      pos++;
    } else {
      out += ch;
      pos++;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}
