# 从贝叶斯推断到变分推断：一个统一的视角

## 引言

在现代统计学习和机器学习中，**贝叶斯推断**（Bayesian Inference）提供了一种系统性地处理不确定性的框架。给定观测数据 $\mathcal{D} = \{x_1, x_2, \ldots, x_n\}$，我们希望推断模型参数 $\theta$ 的后验分布。

根据贝叶斯定理，后验分布为：

$$
p(\theta \mid \mathcal{D}) = \frac{p(\mathcal{D} \mid \theta) \, p(\theta)}{p(\mathcal{D})}
$$

其中 $p(\mathcal{D} \mid \theta)$ 是似然函数，$p(\theta)$ 是先验分布，$p(\mathcal{D}) = \int p(\mathcal{D} \mid \theta) \, p(\theta) \, d\theta$ 是边际似然（evidence）。

然而，在许多实际问题中，这个积分是**不可解**的（intractable），这就引出了各种近似推断方法。

## 变分推断的基本思想

### 问题设定

变分推断的核心想法是：用一个参数化的分布族 $\mathcal{Q} = \{q_\phi(\theta) : \phi \in \Phi\}$ 来近似后验分布 $p(\theta \mid \mathcal{D})$。

我们通过最小化 KL 散度来找到最优近似：

$$
q^*(\theta) = \arg\min_{q \in \mathcal{Q}} \operatorname{KL}\bigl(q(\theta) \,\|\, p(\theta \mid \mathcal{D})\bigr)
$$

### ELBO 推导

KL 散度可以展开为：

$$
\begin{aligned}
\operatorname{KL}\bigl(q(\theta) \,\|\, p(\theta \mid \mathcal{D})\bigr)
&= \mathbb{E}_{q}\left[\log \frac{q(\theta)}{p(\theta \mid \mathcal{D})}\right] \\
&= \mathbb{E}_{q}[\log q(\theta)] - \mathbb{E}_{q}[\log p(\theta \mid \mathcal{D})] \\
&= \mathbb{E}_{q}[\log q(\theta)] - \mathbb{E}_{q}[\log p(\mathcal{D}, \theta)] + \log p(\mathcal{D})
\end{aligned}
$$

因此：

$$
\log p(\mathcal{D}) = \operatorname{KL}\bigl(q(\theta) \,\|\, p(\theta \mid \mathcal{D})\bigr) + \underbrace{\mathbb{E}_{q}[\log p(\mathcal{D}, \theta)] - \mathbb{E}_{q}[\log q(\theta)]}_{\text{ELBO}(\phi)}
$$

由于 KL 散度非负，ELBO 是对数证据的下界：

$$
\log p(\mathcal{D}) \geq \text{ELBO}(\phi)
$$

> **定理（ELBO 等价性）.** 最大化 ELBO 等价于最小化 $q(\theta)$ 与后验 $p(\theta \mid \mathcal{D})$ 之间的 KL 散度。

### 均场近似

最常见的变分族是均场族（mean-field family），它假设变分分布完全分解：

$$
q(\theta) = \prod_{j=1}^{d} q_j(\theta_j)
$$

其中 $d$ 是参数维度。最优的 $q_j^*(\theta_j)$ 满足：

$$
\log q_j^*(\theta_j) = \mathbb{E}_{q_{-j}}[\log p(\mathcal{D}, \theta)] + \text{const}
$$

这里 $q_{-j}$ 表示除 $q_j$ 以外所有因子的分布。

## 数值示例

Consider a simple Gaussian model where $x_i \sim \mathcal{N}(\mu, \sigma^2)$ with known $\sigma^2 = 1$ and prior $\mu \sim \mathcal{N}(0, \tau^2)$.

The posterior is:

$$
\mu \mid \mathcal{D} \sim \mathcal{N}\!\left(\frac{n\bar{x}}{n + 1/\tau^2}, \frac{1}{n + 1/\tau^2}\right)
$$

where $\bar{x} = \frac{1}{n}\sum_{i=1}^n x_i$ is the sample mean.

### 参数比较表

| 方法 | 均值估计 | 方差估计 | 计算复杂度 |
|------|---------|---------|-----------|
| 精确后验 | $\frac{n\bar{x}}{n+1/\tau^2}$ | $\frac{1}{n+1/\tau^2}$ | $O(n)$ |
| 变分近似 | $\frac{n\bar{x}}{n+1/\tau^2}$ | $\frac{1}{n+1/\tau^2}$ | $O(nK)$ |
| MCMC | $\approx \frac{n\bar{x}}{n+1/\tau^2}$ | $\approx \frac{1}{n+1/\tau^2}$ | $O(nT)$ |

其中 $K$ 是变分迭代次数，$T$ 是 MCMC 采样数。

## 实现

下面是一个简单的变分推断实现：

```python
import numpy as np
from scipy.stats import norm

def variational_inference(data, prior_mean=0, prior_var=10, n_iter=100):
    """
    Mean-field variational inference for Gaussian model.

    Parameters
    ----------
    data : array-like
        Observed data points.
    prior_mean : float
        Prior mean for mu.
    prior_var : float
        Prior variance for mu.
    n_iter : int
        Number of optimization iterations.

    Returns
    -------
    dict
        Variational parameters (mean, variance) and ELBO trace.
    """
    n = len(data)
    x_bar = np.mean(data)

    # Initialize variational parameters
    mu_q = 0.0
    sigma2_q = 1.0
    elbo_trace = []

    for i in range(n_iter):
        # Update variational parameters (closed form for Gaussian)
        sigma2_q = 1.0 / (n + 1.0 / prior_var)
        mu_q = sigma2_q * (n * x_bar + prior_mean / prior_var)

        # Compute ELBO
        elbo = (
            -0.5 * n * np.log(2 * np.pi)
            - 0.5 * n * (sigma2_q + (mu_q - x_bar) ** 2)
            - 0.5 * (mu_q**2 + sigma2_q - np.log(sigma2_q) - 1) / prior_var
            + 0.5 * np.log(sigma2_q)
            + 0.5
        )
        elbo_trace.append(elbo)

    return {
        "mean": mu_q,
        "variance": sigma2_q,
        "elbo_trace": elbo_trace,
    }

# Example usage
np.random.seed(42)
data = np.random.normal(loc=3.0, scale=1.0, size=50)
result = variational_inference(data)
print(f"Posterior mean: {result['mean']:.4f}")
print(f"Posterior variance: {result['variance']:.6f}")
```

这个实现虽然简单，但展示了变分推断的基本结构。

## 与 MCMC 的关系

变分推断和马尔可夫链蒙特卡罗（MCMC）方法各有优缺点[^1]：

1. **速度**：变分推断通常比 MCMC 快得多
2. **精度**：MCMC 在渐近意义下精确，变分推断则有近似误差
3. **可扩展性**：变分推断更容易扩展到大规模数据
4. **诊断**：MCMC 有成熟的收敛诊断工具

> 在实际应用中，如果需要快速得到一个合理的后验近似（例如在深度生成模型中），变分推断是首选。如果需要精确的后验采样（例如在小样本贝叶斯模型中），则应使用 MCMC。

### 常见变分推断方法

- **坐标上升变分推断**（CAVI）：逐个更新各因子
- **随机变分推断**（SVI）：使用小批量梯度
- **黑箱变分推断**（BBVI）：通过蒙特卡罗估计梯度
  - REINFORCE 估计器
  - 重参数化技巧（reparameterization trick）

---

## 总结

变分推断将后验推断转化为优化问题，通过最大化 ELBO 来近似后验分布。其核心公式为：

$$
\text{ELBO}(\phi) = \mathbb{E}_{q_\phi}\left[\log p(\mathcal{D}, \theta) - \log q_\phi(\theta)\right]
$$

这一框架不仅在传统统计中有广泛应用，更是现代深度生成模型（如 VAE[^2]）的理论基石。

[^1]: Blei, D. M., Kucukelbir, A., & McAuliffe, J. D. (2017). Variational Inference: A Review for Statisticians. *Journal of the American Statistical Association*, 112(518), 859-877.

[^2]: Kingma, D. P., & Welling, M. (2014). Auto-Encoding Variational Bayes. *ICLR 2014*.

![Variational Inference Illustration](images/vi_diagram.png)

The relationship between the true posterior and the variational approximation is illustrated above.
