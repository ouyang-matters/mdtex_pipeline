#!/usr/bin/env python3
"""FM3 (E1, E3, E4): the logged cost proxies of Proposition 3 and how they
relate to measured latency, for the four DRB variants. Columns: W2 N = 22,
s = 8 (E1); W3 N = 20 (E3); W4 2D n = 16k, D = 2 (E4). Rows:
  (top)    complementary CDF of the footprint per update, the sum of |occ(sigma)|
           over the deletions of the update;
  (middle) complementary CDF of the column additions per update;
  (bottom) latency per update against its column additions: median (line)
           and interquartile range (band) of the latency in logarithmic bins
           of the additions, with the range of Spearman's rank correlation
           over the four variants.
All rows use the non-rebuild updates (t > 0) of seeds 0-2, pooled; the bottom
row uses those with at least one addition. The proxies count terms of the cost
sums of Proposition 3, not the sizes of the chains in them.

Reads experiments/results/E{1,3,4}/<workload>__<method>__seed{0,1,2}.csv.gz.
Supersedes F5_footprint_ccdf (its two rows are the top two rows here).
"""

import os

import numpy as np
import pandas as pd
from matplotlib.lines import Line2D
from scipy.stats import spearmanr

import style as S

S.setup()
import matplotlib.pyplot as plt  # noqa: E402

COLS = [("E1", "w2_N22_s8", "W2 $N=22$, $s=8$"), ("E3", "w3_N20_k2", "W3 $N=20$"),
        ("E4", "w4_2d_n16000_D2", "W4 2D $n=16$k, $D=2$")]
METHODS = ["mmhm", "mmhm-norb", "drb-id-rb", "drb-id"]
MIN_BIN = 20  # updates per bin of the bottom row


def updates(exp, w, m):
    """Non-rebuild updates (t > 0) of the three seeds, pooled."""
    frames = []
    for seed in (0, 1, 2):
        p = os.path.join(S.RES, exp, f"{w}__{m}__seed{seed}.csv.gz")
        if os.path.exists(p):
            df = pd.read_csv(p)
            frames.append(df[(df.t > 0) & (df.rebuild == 0)])
    return pd.concat(frames) if frames else pd.DataFrame()


def ccdf(v):
    v = np.sort(np.asarray(v))
    n = len(v)
    xs = np.unique(v[v >= 1])
    ys = 1.0 - np.searchsorted(v, xs, side="left") / n  # P(X >= x)
    return xs, ys


def ccdf_panel(ax, data, col):
    for m in METHODS:
        u = data[m]
        if u.empty:
            continue
        xs, ys = ccdf(u[col])
        if not len(xs):
            continue
        ax.step(xs, ys, where="post", color=S.COLOR[m], lw=1.2)
        # markers at geometrically spaced x (offset per method), on the curve
        gx = np.geomspace(xs[0], xs[-1], 6) * (1.15 ** METHODS.index(m))
        gx = gx[gx <= xs[-1]]
        k = np.clip(np.searchsorted(xs, gx, side="right") - 1, 0, len(xs) - 1)
        ax.plot(gx, ys[k], ls="none", marker=S.MARKER[m], ms=4, color=S.COLOR[m], mec="white",
                mew=0.5)
    ax.set_xscale("log")
    ax.set_yscale("log")
    S.log_axis(ax, "x")
    S.log_axis(ax, "y")


def binned_panel(ax, data):
    rhos = []
    for m in METHODS:
        u = data[m]
        u = u[u.chain_adds >= 1]
        if u.empty:
            continue
        x = u.chain_adds.to_numpy(float)
        y = u.time_ns.to_numpy(float) / 1e3
        rhos.append(spearmanr(x, y).correlation)
        edges = np.geomspace(x.min(), x.max() * 1.0001, 15)
        idx = np.digitize(x, edges) - 1
        xm, med, q1, q3 = [], [], [], []
        for b in range(len(edges) - 1):
            sel = idx == b
            if sel.sum() < MIN_BIN:
                continue
            xm.append(np.median(x[sel]))
            q1v, mv, q3v = np.percentile(y[sel], [25, 50, 75])
            med.append(mv)
            q1.append(q1v)
            q3.append(q3v)
        ax.fill_between(xm, q1, q3, color=S.COLOR[m], alpha=0.12, lw=0)
        S.method_line(ax, xm, med, m, lw=1.2, ms=3.8)
    ax.set_xscale("log")
    ax.set_yscale("log")
    S.log_axis(ax, "x")
    S.log_axis(ax, "y")
    ax.text(0.03, 0.97, rf"Spearman $\rho$ = {min(rhos):.2f}–{max(rhos):.2f}",
            transform=ax.transAxes, fontsize=6.5, color=S.INK2, va="top", ha="left")
    return rhos


def main():
    fig, axes = plt.subplots(3, 3, figsize=(S.TEXTWIDTH, 5.0))
    for j, (exp, w, title) in enumerate(COLS):
        data = {m: updates(exp, w, m) for m in METHODS}
        ccdf_panel(axes[0, j], data, "footprint_sum")
        ccdf_panel(axes[1, j], data, "chain_adds")
        rhos = binned_panel(axes[2, j], data)
        print(f"{w}: Spearman rho(additions, latency) per method",
              dict(zip(METHODS, np.round(rhos, 3))))
        # where a rebuilding variant never rebuilt, its proxies equal its twin's
        same = []
        for a, b in (("mmhm", "mmhm-norb"), ("drb-id-rb", "drb-id")):
            va, vb = data[a], data[b]
            if len(va) == len(vb) and np.array_equal(va.chain_adds.to_numpy(),
                                                     vb.chain_adds.to_numpy()) \
                    and np.array_equal(va.footprint_sum.to_numpy(), vb.footprint_sum.to_numpy()):
                same.append(f"{a} = {b}")
        if same:
            axes[0, j].text(0.03, 0.03, "no rebuild fired:\n" + "\n".join(same),
                            transform=axes[0, j].transAxes, fontsize=6.3, color=S.INK2,
                            va="bottom")
        axes[0, j].set_title(f"({'abc'[j]}) {title}", loc="left")
        axes[0, j].set_xlabel("footprint per update")
        axes[1, j].set_xlabel("column additions per update")
        axes[2, j].set_xlabel("column additions per update")
    axes[0, 0].set_ylabel(r"fraction of updates $\geq x$")
    axes[1, 0].set_ylabel(r"fraction of updates $\geq x$")
    axes[2, 0].set_ylabel(r"latency per update ($\mu$s)")
    handles = [S.legend_handle(m) for m in METHODS]
    fig.legend(handles=handles, loc="upper center", ncol=len(handles), bbox_to_anchor=(0.5, 1.025),
               handlelength=1.8, columnspacing=1.4)
    fig.tight_layout(rect=(0, 0, 1, 0.97), h_pad=0.9)
    S.missing_note(fig, [e for e, _, _ in COLS], lambda w: w in [x for _, x, _ in COLS], METHODS)
    S.save(fig, "FM3_cost_proxies")


if __name__ == "__main__":
    main()
