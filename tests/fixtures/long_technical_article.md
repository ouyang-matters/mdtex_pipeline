# Numerical Methods for Regularized Inference

> A long technical article used as the MDTeX WeChat compilation performance
> regression fixture. It intentionally mixes dozens of display and inline
> equations with code blocks, tables, images and nested structure.

## 1. Problem Setting

The estimator below is stated in its regularized form so that the conditioning of the normal equations stays bounded even when the design matrix is rank deficient. We write $x \in \mathbb{R}^{d}$ for the parameter vector and note that the update costs $p(y \mid x)$ per step.

Throughout this section we assume the loss is twice differentiable and that its Hessian is positive semidefinite on the relevant domain. We write $\mathcal{O}(n \log n)$ for the parameter vector and note that the update costs $\nabla_\theta \mathcal{L}$ per step.

$$
\mathcal{L}(\theta) = \frac{1}{N}\sum_{i=1}^{N} \ell\bigl(f_\theta(x_i),\, y_i\bigr) + \frac{\lambda}{2}\lVert\theta\rVert_2^2
$$

### 1.1 Discussion

Because $\sigma(z) = (1+e^{-z})^{-1}$ is bounded on compact sets, the argument extends verbatim to the constrained case.

$$
\operatorname{Attention}(Q,K,V) = \operatorname{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}}\right)V
$$

```python
import numpy as np

def ridge(X, y, lam=1e-3):
    p = X.shape[1]
    A = X.T @ X + lam * np.eye(p)
    return np.linalg.solve(A, X.T @ y)
```

| Method | Cost | Stability | Notes |
| --- | --- | --- | --- |
| Direct solve | $O(p^3)$ | high | exact for small $p$ |
| Conjugate gradient | $O(kp^2)$ | medium | needs preconditioner |
| Stochastic gradient | $O(kp)$ | low | tune $\eta$ carefully |

![Convergence profile for section 1](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)

- The residual decreases monotonically after the first few iterations.
- Restarting resets the Krylov subspace and costs one extra matvec.
- Preconditioning changes the constant, not the asymptotic rate.

## 2. Regularized Empirical Risk

Throughout this section we assume the loss is twice differentiable and that its Hessian is positive semidefinite on the relevant domain. We write $\sigma(z) = (1+e^{-z})^{-1}$ for the parameter vector and note that the update costs $\mathbb{E}[X^2]$ per step.

A practical consequence is that the iteration count needed to reach a fixed tolerance grows only logarithmically in the inverse tolerance. We write $\lVert A \rVert_F$ for the parameter vector and note that the update costs $\Gamma(n) = (n-1)!$ per step.

$$
\frac{\partial}{\partial t}\rho(x,t) = -\nabla\cdot\bigl(\mu(x)\rho(x,t)\bigr) + \tfrac{1}{2}\nabla^2\bigl(\sigma^2(x)\rho(x,t)\bigr)
$$

### 2.1 Discussion

Because $\sum_{k=0}^{K} w_k$ is bounded on compact sets, the argument extends verbatim to the constrained case.

## 3. Continuous-Time Dynamics

A practical consequence is that the iteration count needed to reach a fixed tolerance grows only logarithmically in the inverse tolerance. We write $\alpha \le \beta$ for the parameter vector and note that the update costs $\det(X^\top X)$ per step.

Note that the constant hidden in the bound depends on the dimension only through the effective rank, not the ambient dimension. We write $p(y \mid x)$ for the parameter vector and note that the update costs $x \in \mathbb{R}^{d}$ per step.

$$
\hat{\beta} = \bigl(X^{\top}X + \lambda I_p\bigr)^{-1} X^{\top} y
$$

### 3.1 Discussion

Because $x \in \mathbb{R}^{d}$ is bounded on compact sets, the argument extends verbatim to the constrained case.

```javascript
export function softmax(xs) {
  const m = Math.max(...xs);
  const e = xs.map(x => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map(v => v / s);
}
```

## 4. Variational Bounds

Note that the constant hidden in the bound depends on the dimension only through the effective rank, not the ambient dimension. We write $\nabla_\theta \mathcal{L}$ for the parameter vector and note that the update costs $\sigma(z) = (1+e^{-z})^{-1}$ per step.

In practice the dominant cost is not the linear solve but the repeated evaluation of the forward map, which we cache aggressively. We write $\sum_{k=0}^{K} w_k$ for the parameter vector and note that the update costs $\lVert A \rVert_F$ per step.

$$
\begin{aligned} q_\phi(z\mid x) &= \mathcal{N}\bigl(z;\, \mu_\phi(x),\, \operatorname{diag}\sigma^2_\phi(x)\bigr) \\ \mathrm{KL}\bigl(q_\phi \,\|\, p\bigr) &= \tfrac{1}{2}\sum_{j=1}^{d}\bigl(\mu_j^2 + \sigma_j^2 - \log\sigma_j^2 - 1\bigr) \end{aligned}
$$

### 4.1 Discussion

Because $p(y \mid x)$ is bounded on compact sets, the argument extends verbatim to the constrained case.

$$
\begin{pmatrix} a_{11} & a_{12} & a_{13} \\ a_{21} & a_{22} & a_{23} \\ a_{31} & a_{32} & a_{33} \end{pmatrix} \begin{pmatrix} v_1 \\ v_2 \\ v_3 \end{pmatrix} = \lambda \begin{pmatrix} v_1 \\ v_2 \\ v_3 \end{pmatrix}
$$

## 5. Attention as Kernel Smoothing

In practice the dominant cost is not the linear solve but the repeated evaluation of the forward map, which we cache aggressively. We write $\mathbb{E}[X^2]$ for the parameter vector and note that the update costs $p(y \mid x)$ per step.

The derivation mirrors the classical argument, with the difference that we track the second moment explicitly rather than bounding it away. We write $\Gamma(n) = (n-1)!$ for the parameter vector and note that the update costs $\nabla_\theta \mathcal{L}$ per step.

$$
\operatorname{Attention}(Q,K,V) = \operatorname{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}}\right)V
$$

### 5.1 Discussion

Because $H_0^1(\Omega)$ is bounded on compact sets, the argument extends verbatim to the constrained case.

```rust
pub fn gauss_seidel(a: &Matrix, b: &[f64], x: &mut [f64]) {
    for i in 0..b.len() {
        let mut acc = b[i];
        for j in 0..b.len() {
            if i != j { acc -= a[(i, j)] * x[j]; }
        }
        x[i] = acc / a[(i, i)];
    }
}
```

| Method | Cost | Stability | Notes |
| --- | --- | --- | --- |
| Direct solve | $O(p^3)$ | high | exact for small $p$ |
| Conjugate gradient | $O(kp^2)$ | medium | needs preconditioner |
| Stochastic gradient | $O(kp)$ | low | tune $\eta$ carefully |

## 6. Weak Formulations

The derivation mirrors the classical argument, with the difference that we track the second moment explicitly rather than bounding it away. We write $H_0^1(\Omega)$ for the parameter vector and note that the update costs $\mathbb{E}[X^2]$ per step.

The estimator below is stated in its regularized form so that the conditioning of the normal equations stays bounded even when the design matrix is rank deficient. We write $\det(X^\top X)$ for the parameter vector and note that the update costs $\Gamma(n) = (n-1)!$ per step.

$$
\int_{\Omega} \nabla u \cdot \nabla v \, \mathrm{d}x = \int_{\Omega} f v \, \mathrm{d}x \qquad \forall v \in H_0^1(\Omega)
$$

### 6.1 Discussion

Because $\lVert A \rVert_F$ is bounded on compact sets, the argument extends verbatim to the constrained case.

![Convergence profile for section 6](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)

- The residual decreases monotonically after the first few iterations.
- Restarting resets the Krylov subspace and costs one extra matvec.
- Preconditioning changes the constant, not the asymptotic rate.

## 7. Concentration Inequalities

The estimator below is stated in its regularized form so that the conditioning of the normal equations stays bounded even when the design matrix is rank deficient. We write $x \in \mathbb{R}^{d}$ for the parameter vector and note that the update costs $\det(X^\top X)$ per step.

Throughout this section we assume the loss is twice differentiable and that its Hessian is positive semidefinite on the relevant domain. We write $\mathcal{O}(n \log n)$ for the parameter vector and note that the update costs $x \in \mathbb{R}^{d}$ per step.

$$
\Pr\bigl[\lvert \bar{X}_n - \mu \rvert \geq t\bigr] \leq 2\exp\!\left(-\frac{2n t^2}{(b-a)^2}\right)
$$

### 7.1 Discussion

Because $\mathbb{E}[X^2]$ is bounded on compact sets, the argument extends verbatim to the constrained case.

$$
\theta_{t+1} = \theta_t - \eta \frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}, \qquad \hat{m}_t = \frac{m_t}{1-\beta_1^t}
$$

```bash
latexmk -xelatex -interaction=nonstopmode \
  -output-directory=build main.tex
```

## 8. Spectral Structure

Throughout this section we assume the loss is twice differentiable and that its Hessian is positive semidefinite on the relevant domain. We write $\sigma(z) = (1+e^{-z})^{-1}$ for the parameter vector and note that the update costs $\sigma(z) = (1+e^{-z})^{-1}$ per step.

A practical consequence is that the iteration count needed to reach a fixed tolerance grows only logarithmically in the inverse tolerance. We write $\lVert A \rVert_F$ for the parameter vector and note that the update costs $\lVert A \rVert_F$ per step.

$$
\begin{pmatrix} a_{11} & a_{12} & a_{13} \\ a_{21} & a_{22} & a_{23} \\ a_{31} & a_{32} & a_{33} \end{pmatrix} \begin{pmatrix} v_1 \\ v_2 \\ v_3 \end{pmatrix} = \lambda \begin{pmatrix} v_1 \\ v_2 \\ v_3 \end{pmatrix}
$$

### 8.1 Discussion

Because $\mathcal{O}(n \log n)$ is bounded on compact sets, the argument extends verbatim to the constrained case.

## 9. Adversarial Objectives

A practical consequence is that the iteration count needed to reach a fixed tolerance grows only logarithmically in the inverse tolerance. We write $\alpha \le \beta$ for the parameter vector and note that the update costs $p(y \mid x)$ per step.

Note that the constant hidden in the bound depends on the dimension only through the effective rank, not the ambient dimension. We write $p(y \mid x)$ for the parameter vector and note that the update costs $\nabla_\theta \mathcal{L}$ per step.

$$
\mathbb{E}_{x\sim p_{\mathrm{data}}}\bigl[\log D(x)\bigr] + \mathbb{E}_{z\sim p_z}\bigl[\log\bigl(1 - D(G(z))\bigr)\bigr]
$$

### 9.1 Discussion

Because $\nabla_\theta \mathcal{L}$ is bounded on compact sets, the argument extends verbatim to the constrained case.

```python
import numpy as np

def ridge(X, y, lam=1e-3):
    p = X.shape[1]
    A = X.T @ X + lam * np.eye(p)
    return np.linalg.solve(A, X.T @ y)
```

| Method | Cost | Stability | Notes |
| --- | --- | --- | --- |
| Direct solve | $O(p^3)$ | high | exact for small $p$ |
| Conjugate gradient | $O(kp^2)$ | medium | needs preconditioner |
| Stochastic gradient | $O(kp)$ | low | tune $\eta$ carefully |

## 10. Analytic Continuation

Note that the constant hidden in the bound depends on the dimension only through the effective rank, not the ambient dimension. We write $\nabla_\theta \mathcal{L}$ for the parameter vector and note that the update costs $\mathbb{E}[X^2]$ per step.

In practice the dominant cost is not the linear solve but the repeated evaluation of the forward map, which we cache aggressively. We write $\sum_{k=0}^{K} w_k$ for the parameter vector and note that the update costs $\Gamma(n) = (n-1)!$ per step.

$$
\zeta(s) = \sum_{n=1}^{\infty} \frac{1}{n^{s}} = \prod_{p \text{ prime}} \frac{1}{1 - p^{-s}}, \qquad \Re(s) > 1
$$

### 10.1 Discussion

Because $\det(X^\top X)$ is bounded on compact sets, the argument extends verbatim to the constrained case.

$$
\frac{\partial}{\partial t}\rho(x,t) = -\nabla\cdot\bigl(\mu(x)\rho(x,t)\bigr) + \tfrac{1}{2}\nabla^2\bigl(\sigma^2(x)\rho(x,t)\bigr)
$$

## 11. Adaptive Step Sizes

In practice the dominant cost is not the linear solve but the repeated evaluation of the forward map, which we cache aggressively. We write $\mathbb{E}[X^2]$ for the parameter vector and note that the update costs $\det(X^\top X)$ per step.

The derivation mirrors the classical argument, with the difference that we track the second moment explicitly rather than bounding it away. We write $\Gamma(n) = (n-1)!$ for the parameter vector and note that the update costs $x \in \mathbb{R}^{d}$ per step.

$$
\theta_{t+1} = \theta_t - \eta \frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}, \qquad \hat{m}_t = \frac{m_t}{1-\beta_1^t}
$$

### 11.1 Discussion

Because $\alpha \le \beta$ is bounded on compact sets, the argument extends verbatim to the constrained case.

```javascript
export function softmax(xs) {
  const m = Math.max(...xs);
  const e = xs.map(x => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map(v => v / s);
}
```

![Convergence profile for section 11](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)

- The residual decreases monotonically after the first few iterations.
- Restarting resets the Krylov subspace and costs one extra matvec.
- Preconditioning changes the constant, not the asymptotic rate.

## 12. Asymptotic Normality

The derivation mirrors the classical argument, with the difference that we track the second moment explicitly rather than bounding it away. We write $H_0^1(\Omega)$ for the parameter vector and note that the update costs $\sigma(z) = (1+e^{-z})^{-1}$ per step.

The estimator below is stated in its regularized form so that the conditioning of the normal equations stays bounded even when the design matrix is rank deficient. We write $\det(X^\top X)$ for the parameter vector and note that the update costs $\lVert A \rVert_F$ per step.

$$
\lim_{n\to\infty} \sqrt{n}\,\bigl(\bar{X}_n - \mu\bigr) \xrightarrow{\;d\;} \mathcal{N}\bigl(0, \sigma^2\bigr)
$$

### 12.1 Discussion

Because $\Gamma(n) = (n-1)!$ is bounded on compact sets, the argument extends verbatim to the constrained case.

## 13. Numerical Conditioning

The estimator below is stated in its regularized form so that the conditioning of the normal equations stays bounded even when the design matrix is rank deficient. We write $x \in \mathbb{R}^{d}$ for the parameter vector and note that the update costs $p(y \mid x)$ per step.

Throughout this section we assume the loss is twice differentiable and that its Hessian is positive semidefinite on the relevant domain. We write $\mathcal{O}(n \log n)$ for the parameter vector and note that the update costs $\nabla_\theta \mathcal{L}$ per step.

$$
\mathcal{L}(\theta) = \frac{1}{N}\sum_{i=1}^{N} \ell\bigl(f_\theta(x_i),\, y_i\bigr) + \frac{\lambda}{2}\lVert\theta\rVert_2^2
$$

### 13.1 Discussion

Because $\sigma(z) = (1+e^{-z})^{-1}$ is bounded on compact sets, the argument extends verbatim to the constrained case.

$$
\operatorname{Attention}(Q,K,V) = \operatorname{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}}\right)V
$$

```rust
pub fn gauss_seidel(a: &Matrix, b: &[f64], x: &mut [f64]) {
    for i in 0..b.len() {
        let mut acc = b[i];
        for j in 0..b.len() {
            if i != j { acc -= a[(i, j)] * x[j]; }
        }
        x[i] = acc / a[(i, i)];
    }
}
```

| Method | Cost | Stability | Notes |
| --- | --- | --- | --- |
| Direct solve | $O(p^3)$ | high | exact for small $p$ |
| Conjugate gradient | $O(kp^2)$ | medium | needs preconditioner |
| Stochastic gradient | $O(kp)$ | low | tune $\eta$ carefully |

## 14. Discretization Error

Throughout this section we assume the loss is twice differentiable and that its Hessian is positive semidefinite on the relevant domain. We write $\sigma(z) = (1+e^{-z})^{-1}$ for the parameter vector and note that the update costs $\mathbb{E}[X^2]$ per step.

A practical consequence is that the iteration count needed to reach a fixed tolerance grows only logarithmically in the inverse tolerance. We write $\lVert A \rVert_F$ for the parameter vector and note that the update costs $\Gamma(n) = (n-1)!$ per step.

$$
\frac{\partial}{\partial t}\rho(x,t) = -\nabla\cdot\bigl(\mu(x)\rho(x,t)\bigr) + \tfrac{1}{2}\nabla^2\bigl(\sigma^2(x)\rho(x,t)\bigr)
$$

### 14.1 Discussion

Because $\sum_{k=0}^{K} w_k$ is bounded on compact sets, the argument extends verbatim to the constrained case.

## 15. Implementation Notes

A practical consequence is that the iteration count needed to reach a fixed tolerance grows only logarithmically in the inverse tolerance. We write $\alpha \le \beta$ for the parameter vector and note that the update costs $\det(X^\top X)$ per step.

Note that the constant hidden in the bound depends on the dimension only through the effective rank, not the ambient dimension. We write $p(y \mid x)$ for the parameter vector and note that the update costs $x \in \mathbb{R}^{d}$ per step.

$$
\hat{\beta} = \bigl(X^{\top}X + \lambda I_p\bigr)^{-1} X^{\top} y
$$

### 15.1 Discussion

Because $x \in \mathbb{R}^{d}$ is bounded on compact sets, the argument extends verbatim to the constrained case.

```bash
latexmk -xelatex -interaction=nonstopmode \
  -output-directory=build main.tex
```

## 16. Benchmark Methodology

Note that the constant hidden in the bound depends on the dimension only through the effective rank, not the ambient dimension. We write $\nabla_\theta \mathcal{L}$ for the parameter vector and note that the update costs $\sigma(z) = (1+e^{-z})^{-1}$ per step.

In practice the dominant cost is not the linear solve but the repeated evaluation of the forward map, which we cache aggressively. We write $\sum_{k=0}^{K} w_k$ for the parameter vector and note that the update costs $\lVert A \rVert_F$ per step.

$$
\begin{aligned} q_\phi(z\mid x) &= \mathcal{N}\bigl(z;\, \mu_\phi(x),\, \operatorname{diag}\sigma^2_\phi(x)\bigr) \\ \mathrm{KL}\bigl(q_\phi \,\|\, p\bigr) &= \tfrac{1}{2}\sum_{j=1}^{d}\bigl(\mu_j^2 + \sigma_j^2 - \log\sigma_j^2 - 1\bigr) \end{aligned}
$$

### 16.1 Discussion

Because $p(y \mid x)$ is bounded on compact sets, the argument extends verbatim to the constrained case.

$$
\begin{pmatrix} a_{11} & a_{12} & a_{13} \\ a_{21} & a_{22} & a_{23} \\ a_{31} & a_{32} & a_{33} \end{pmatrix} \begin{pmatrix} v_1 \\ v_2 \\ v_3 \end{pmatrix} = \lambda \begin{pmatrix} v_1 \\ v_2 \\ v_3 \end{pmatrix}
$$

![Convergence profile for section 16](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)

- The residual decreases monotonically after the first few iterations.
- Restarting resets the Krylov subspace and costs one extra matvec.
- Preconditioning changes the constant, not the asymptotic rate.

## 17. Failure Modes

In practice the dominant cost is not the linear solve but the repeated evaluation of the forward map, which we cache aggressively. We write $\mathbb{E}[X^2]$ for the parameter vector and note that the update costs $p(y \mid x)$ per step.

The derivation mirrors the classical argument, with the difference that we track the second moment explicitly rather than bounding it away. We write $\Gamma(n) = (n-1)!$ for the parameter vector and note that the update costs $\nabla_\theta \mathcal{L}$ per step.

$$
\operatorname{Attention}(Q,K,V) = \operatorname{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}}\right)V
$$

### 17.1 Discussion

Because $H_0^1(\Omega)$ is bounded on compact sets, the argument extends verbatim to the constrained case.

```python
import numpy as np

def ridge(X, y, lam=1e-3):
    p = X.shape[1]
    A = X.T @ X + lam * np.eye(p)
    return np.linalg.solve(A, X.T @ y)
```

| Method | Cost | Stability | Notes |
| --- | --- | --- | --- |
| Direct solve | $O(p^3)$ | high | exact for small $p$ |
| Conjugate gradient | $O(kp^2)$ | medium | needs preconditioner |
| Stochastic gradient | $O(kp)$ | low | tune $\eta$ carefully |

## 18. Related Work

The derivation mirrors the classical argument, with the difference that we track the second moment explicitly rather than bounding it away. We write $H_0^1(\Omega)$ for the parameter vector and note that the update costs $\mathbb{E}[X^2]$ per step.

The estimator below is stated in its regularized form so that the conditioning of the normal equations stays bounded even when the design matrix is rank deficient. We write $\det(X^\top X)$ for the parameter vector and note that the update costs $\Gamma(n) = (n-1)!$ per step.

$$
\int_{\Omega} \nabla u \cdot \nabla v \, \mathrm{d}x = \int_{\Omega} f v \, \mathrm{d}x \qquad \forall v \in H_0^1(\Omega)
$$

### 18.1 Discussion

Because $\lVert A \rVert_F$ is bounded on compact sets, the argument extends verbatim to the constrained case.

## Appendix A. Summary of Notation

| Symbol | Meaning |
| --- | --- |
| $\theta$ | model parameters |
| $\lambda$ | regularization strength |
| $\eta$ | learning rate |
| $\Omega$ | problem domain |

