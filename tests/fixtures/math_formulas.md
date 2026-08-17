# Formula Rendering Test Fixture

## Simple Inline Variables

The variable $x$ takes values in $\mathbb{R}$. We have $a$, $b$, and $c$.

## Fractions

The fraction $\frac{a}{b}$ appears inline. Also $\frac{x+1}{x-1}$ and $\frac{\partial f}{\partial x}$.

## Superscripts and Subscripts

Consider $x^2$, $x_i$, $x_i^2$, $a_{ij}^{(k)}$, and $e^{i\pi}$.

## Integrals

The integral $\int_a^b f(x)\,\mathrm{d}x$ computes area. Also $\oint_C \mathbf{F}\cdot\mathrm{d}\mathbf{r}$ and $\iint_D g\,\mathrm{d}A$.

## Upright Differential

We write $\mathrm{d}x$ with an upright d: $\int_0^1 x^2\,\mathrm{d}x = \frac{1}{3}$.

$$
\int_{-\infty}^{\infty} e^{-x^2}\,\mathrm{d}x = \sqrt{\pi}
$$

## Matrices

$$
A = \begin{pmatrix} a & b \\ c & d \end{pmatrix}, \quad
\det(A) = ad - bc
$$

$$
\begin{bmatrix} 1 & 0 & 0 \\ 0 & 1 & 0 \\ 0 & 0 & 1 \end{bmatrix}
$$

## Sums and Products

$$
\sum_{k=0}^{n} \binom{n}{k} x^k = (1+x)^n
$$

$$
\prod_{i=1}^{n} x_i = x_1 \cdot x_2 \cdots x_n
$$

## Limits

$$
\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n = e
$$

## Long Display Equations

$$
\mathcal{L}(\theta; \mathcal{D}) = \sum_{i=1}^{N} \left[ y_i \log \sigma(\theta^T x_i) + (1 - y_i) \log(1 - \sigma(\theta^T x_i)) \right]
$$

## Aligned / Multiline Equations

$$
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\epsilon_0} \\
\nabla \cdot \mathbf{B} &= 0 \\
\nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t} \\
\nabla \times \mathbf{B} &= \mu_0 \mathbf{J} + \mu_0 \epsilon_0 \frac{\partial \mathbf{E}}{\partial t}
\end{aligned}
$$

## Greek Letters

We use $\alpha$, $\beta$, $\gamma$, $\delta$, $\epsilon$, $\zeta$, $\eta$, $\theta$ throughout. Capital: $\Gamma$, $\Delta$, $\Theta$, $\Lambda$, $\Sigma$, $\Omega$.

## Blackboard Bold

The number fields: $\mathbb{N}$, $\mathbb{Z}$, $\mathbb{Q}$, $\mathbb{R}$, $\mathbb{C}$.

The expectation $\mathbb{E}[X]$ and probability $\mathbb{P}(A)$.

## Mixed Chinese + Inline Math

根据贝叶斯定理，后验概率为 $p(\theta | \mathcal{D}) = \frac{p(\mathcal{D} | \theta) p(\theta)}{p(\mathcal{D})}$。

设随机变量 $X \sim \mathcal{N}(\mu, \sigma^2)$，则其期望 $\mathbb{E}[X] = \mu$，方差 $\mathrm{Var}(X) = \sigma^2$。

## Multiple Inline Equations in One Paragraph

In statistics, we estimate the mean $\bar{x} = \frac{1}{n}\sum_{i=1}^n x_i$, the variance $s^2 = \frac{1}{n-1}\sum_{i=1}^n (x_i - \bar{x})^2$, and the standard error $\text{SE} = \frac{s}{\sqrt{n}}$. The $t$-statistic is $t = \frac{\bar{x} - \mu_0}{\text{SE}}$ with $n-1$ degrees of freedom.
