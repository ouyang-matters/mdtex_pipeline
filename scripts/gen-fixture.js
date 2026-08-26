#!/usr/bin/env node
/**
 * Generate tests/fixtures/long_technical_article.md — the WeChat performance
 * regression fixture. Deterministic: no randomness, so the fixture hash is
 * stable and benchmark numbers stay comparable across runs.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { resolve } from 'path';

const appRoot = resolve(import.meta.dirname, '..');

const DISPLAY = [
  String.raw`\mathcal{L}(\theta) = \frac{1}{N}\sum_{i=1}^{N} \ell\bigl(f_\theta(x_i),\, y_i\bigr) + \frac{\lambda}{2}\lVert\theta\rVert_2^2`,
  String.raw`\frac{\partial}{\partial t}\rho(x,t) = -\nabla\cdot\bigl(\mu(x)\rho(x,t)\bigr) + \tfrac{1}{2}\nabla^2\bigl(\sigma^2(x)\rho(x,t)\bigr)`,
  String.raw`\hat{\beta} = \bigl(X^{\top}X + \lambda I_p\bigr)^{-1} X^{\top} y`,
  String.raw`\begin{aligned} q_\phi(z\mid x) &= \mathcal{N}\bigl(z;\, \mu_\phi(x),\, \operatorname{diag}\sigma^2_\phi(x)\bigr) \\ \mathrm{KL}\bigl(q_\phi \,\|\, p\bigr) &= \tfrac{1}{2}\sum_{j=1}^{d}\bigl(\mu_j^2 + \sigma_j^2 - \log\sigma_j^2 - 1\bigr) \end{aligned}`,
  String.raw`\operatorname{Attention}(Q,K,V) = \operatorname{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}}\right)V`,
  String.raw`\int_{\Omega} \nabla u \cdot \nabla v \, \mathrm{d}x = \int_{\Omega} f v \, \mathrm{d}x \qquad \forall v \in H_0^1(\Omega)`,
  String.raw`\Pr\bigl[\lvert \bar{X}_n - \mu \rvert \geq t\bigr] \leq 2\exp\!\left(-\frac{2n t^2}{(b-a)^2}\right)`,
  String.raw`\begin{pmatrix} a_{11} & a_{12} & a_{13} \\ a_{21} & a_{22} & a_{23} \\ a_{31} & a_{32} & a_{33} \end{pmatrix} \begin{pmatrix} v_1 \\ v_2 \\ v_3 \end{pmatrix} = \lambda \begin{pmatrix} v_1 \\ v_2 \\ v_3 \end{pmatrix}`,
  String.raw`\mathbb{E}_{x\sim p_{\mathrm{data}}}\bigl[\log D(x)\bigr] + \mathbb{E}_{z\sim p_z}\bigl[\log\bigl(1 - D(G(z))\bigr)\bigr]`,
  String.raw`\zeta(s) = \sum_{n=1}^{\infty} \frac{1}{n^{s}} = \prod_{p \text{ prime}} \frac{1}{1 - p^{-s}}, \qquad \Re(s) > 1`,
  String.raw`\theta_{t+1} = \theta_t - \eta \frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}, \qquad \hat{m}_t = \frac{m_t}{1-\beta_1^t}`,
  String.raw`\lim_{n\to\infty} \sqrt{n}\,\bigl(\bar{X}_n - \mu\bigr) \xrightarrow{\;d\;} \mathcal{N}\bigl(0, \sigma^2\bigr)`,
];

const INLINE = [
  String.raw`x \in \mathbb{R}^{d}`,
  String.raw`\mathcal{O}(n \log n)`,
  String.raw`\sigma(z) = (1+e^{-z})^{-1}`,
  String.raw`\lVert A \rVert_F`,
  String.raw`\alpha \le \beta`,
  String.raw`p(y \mid x)`,
  String.raw`\nabla_\theta \mathcal{L}`,
  String.raw`\sum_{k=0}^{K} w_k`,
  String.raw`\mathbb{E}[X^2]`,
  String.raw`\Gamma(n) = (n-1)!`,
  String.raw`H_0^1(\Omega)`,
  String.raw`\det(X^\top X)`,
];

const CODE = [
  ['python', `import numpy as np\n\ndef ridge(X, y, lam=1e-3):\n    p = X.shape[1]\n    A = X.T @ X + lam * np.eye(p)\n    return np.linalg.solve(A, X.T @ y)`],
  ['javascript', `export function softmax(xs) {\n  const m = Math.max(...xs);\n  const e = xs.map(x => Math.exp(x - m));\n  const s = e.reduce((a, b) => a + b, 0);\n  return e.map(v => v / s);\n}`],
  ['rust', `pub fn gauss_seidel(a: &Matrix, b: &[f64], x: &mut [f64]) {\n    for i in 0..b.len() {\n        let mut acc = b[i];\n        for j in 0..b.len() {\n            if i != j { acc -= a[(i, j)] * x[j]; }\n        }\n        x[i] = acc / a[(i, i)];\n    }\n}`],
  ['bash', `latexmk -xelatex -interaction=nonstopmode \\\n  -output-directory=build main.tex`],
];

// A tiny deterministic 1x1 transparent PNG, used so the fixture exercises the
// image path without carrying a large binary blob in the repo.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const SECTION_TITLES = [
  'Problem Setting', 'Regularized Empirical Risk', 'Continuous-Time Dynamics',
  'Variational Bounds', 'Attention as Kernel Smoothing', 'Weak Formulations',
  'Concentration Inequalities', 'Spectral Structure', 'Adversarial Objectives',
  'Analytic Continuation', 'Adaptive Step Sizes', 'Asymptotic Normality',
  'Numerical Conditioning', 'Discretization Error', 'Implementation Notes',
  'Benchmark Methodology', 'Failure Modes', 'Related Work',
];

const PROSE = [
  'The estimator below is stated in its regularized form so that the conditioning of the normal equations stays bounded even when the design matrix is rank deficient.',
  'Throughout this section we assume the loss is twice differentiable and that its Hessian is positive semidefinite on the relevant domain.',
  'A practical consequence is that the iteration count needed to reach a fixed tolerance grows only logarithmically in the inverse tolerance.',
  'Note that the constant hidden in the bound depends on the dimension only through the effective rank, not the ambient dimension.',
  'In practice the dominant cost is not the linear solve but the repeated evaluation of the forward map, which we cache aggressively.',
  'The derivation mirrors the classical argument, with the difference that we track the second moment explicitly rather than bounding it away.',
];

let out = [];
out.push('# Numerical Methods for Regularized Inference');
out.push('');
out.push('> A long technical article used as the MDTeX WeChat compilation performance');
out.push('> regression fixture. It intentionally mixes dozens of display and inline');
out.push('> equations with code blocks, tables, images and nested structure.');
out.push('');

for (let s = 0; s < SECTION_TITLES.length; s++) {
  out.push(`## ${s + 1}. ${SECTION_TITLES[s]}`);
  out.push('');

  // Two prose paragraphs with inline math.
  for (let p = 0; p < 2; p++) {
    const i1 = INLINE[(s * 2 + p) % INLINE.length];
    const i2 = INLINE[(s * 3 + p + 5) % INLINE.length];
    const prose = PROSE[(s + p) % PROSE.length];
    out.push(`${prose} We write $${i1}$ for the parameter vector and note that the update costs $${i2}$ per step.`);
    out.push('');
  }

  // Display equation.
  out.push('$$');
  out.push(DISPLAY[s % DISPLAY.length]);
  out.push('$$');
  out.push('');

  out.push(`### ${s + 1}.1 Discussion`);
  out.push('');
  const i3 = INLINE[(s * 5 + 2) % INLINE.length];
  out.push(`Because $${i3}$ is bounded on compact sets, the argument extends verbatim to the constrained case.`);
  out.push('');

  // Every third section gets a second display equation.
  if (s % 3 === 0) {
    out.push('$$');
    out.push(DISPLAY[(s + 4) % DISPLAY.length]);
    out.push('$$');
    out.push('');
  }

  // Every second section gets a code block.
  if (s % 2 === 0) {
    const [lang, code] = CODE[(s / 2) % CODE.length];
    out.push('```' + lang);
    out.push(code);
    out.push('```');
    out.push('');
  }

  // Every fourth section gets a table.
  if (s % 4 === 0) {
    out.push('| Method | Cost | Stability | Notes |');
    out.push('| --- | --- | --- | --- |');
    out.push('| Direct solve | $O(p^3)$ | high | exact for small $p$ |');
    out.push('| Conjugate gradient | $O(kp^2)$ | medium | needs preconditioner |');
    out.push('| Stochastic gradient | $O(kp)$ | low | tune $\\eta$ carefully |');
    out.push('');
  }

  // Every fifth section gets a figure and a list.
  if (s % 5 === 0) {
    out.push(`![Convergence profile for section ${s + 1}](${PIXEL})`);
    out.push('');
    out.push('- The residual decreases monotonically after the first few iterations.');
    out.push('- Restarting resets the Krylov subspace and costs one extra matvec.');
    out.push('- Preconditioning changes the constant, not the asymptotic rate.');
    out.push('');
  }
}

out.push('## Appendix A. Summary of Notation');
out.push('');
out.push('| Symbol | Meaning |');
out.push('| --- | --- |');
out.push('| $\\theta$ | model parameters |');
out.push('| $\\lambda$ | regularization strength |');
out.push('| $\\eta$ | learning rate |');
out.push('| $\\Omega$ | problem domain |');
out.push('');

const text = out.join('\n') + '\n';
const target = join(appRoot, 'tests', 'fixtures', 'long_technical_article.md');
writeFileSync(target, text, 'utf-8');

const display = (text.match(/^\$\$$/gm) || []).length / 2;
const inline = (text.match(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g) || []).length;
console.log(`Wrote ${target}`);
console.log(`  ${text.length} bytes, ${text.split('\n').length} lines`);
console.log(`  ~${display} display equations, ~${inline} inline equations`);
