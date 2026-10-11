#!/usr/bin/env python3
"""F5 (E8): what the Morse order buys. Complementary CDFs, over the
non-rebuild updates of 3 seeds pooled, of the per-update footprint
(footprint_sum = sum of |occ(sigma)| over the deletions of the update) and of
the per-update number of column additions (chain_adds), for the four DRB
methods. Log-log; the value at x = 1 is the fraction of updates with a
non-zero count. Columns: W2 N = 22 (E1), W3 N = 20 (E3), W4 2D n = 16k D = 2 (E4).

Reads experiments/results/E{1,3,4}/<workload>__<method>__seed{0,1,2}.csv.gz.
"""

import gzip
import os

import numpy as np
import pandas as pd
from matplotlib.lines import Line2D

import style as S

S.setup()
import matplotlib.pyplot as plt  # noqa: E402

COLS = [("E1", "w2_N22_s8", "W2 $N=22$, $s=8$"), ("E3", "w3_N20_k2", "W3 $N=20$"),
        ("E4", "w4_2d_n16000_D2", "W4 2D $n=16$k, $D=2$")]
METHODS = ["mmhm", "mmhm-norb", "drb-id-rb", "drb-id"]
ROWS = [("footprint_sum", "footprint per update"), ("chain_adds", "column additions per update")]


def pooled(exp, w, m, col):
    vals = []
    for seed in (0, 1, 2):
        p = os.path.join(S.RES, exp, f"{w}__{m}__seed{seed}.csv.gz")
        if not os.path.exists(p):
            continue
        with gzip.open(p, "rt") as fh:
            df = pd.read_csv(fh)
        u = df[(df.t > 0) & (df.rebuild == 0)]
        vals.append(u[col].to_numpy())
    return np.concatenate(vals) if vals else np.array([])


def ccdf(v):
    v = np.sort(v)
    n = len(v)
    xs = np.unique(v[v >= 1])
    ys = 1.0 - np.searchsorted(v, xs, side="left") / n  # P(X >= x)
    return xs, ys


def main():
    fig, axes = plt.subplots(2, 3, figsize=(S.TEXTWIDTH, 3.9))
    for j, (exp, w, title) in enumerate(COLS):
        for i, (col, ylab) in enumerate(ROWS):
            ax = axes[i, j]
            for m in METHODS:
                v = pooled(exp, w, m, col)
                if not len(v):
                    continue
                xs, ys = ccdf(v)
                if not len(xs):
                    continue
                ax.step(xs, ys, where="post", color=S.COLOR[m], lw=1.2)
                # markers at geometrically spaced x (offset per method), on the curve
                gx = np.geomspace(xs[0], xs[-1], 6) * (1.15 ** METHODS.index(m))
                gx = gx[gx <= xs[-1]]
                k = np.clip(np.searchsorted(xs, gx, side="right") - 1, 0, len(xs) - 1)
                ax.plot(gx, ys[k], ls="none", marker=S.MARKER[m], ms=4, color=S.COLOR[m],
                        mec="white", mew=0.5)
            ax.set_xscale("log")
            ax.set_yscale("log")
            S.log_axis(ax, "x")
            S.log_axis(ax, "y")
            ax.set_xlabel(ylab)
            if j == 0:
                ax.set_ylabel(r"fraction of updates $\geq x$")
            if i == 0:
                ax.set_title(f"({'abc'[j]}) {title}", loc="left")
    handles = [Line2D([], [], color=S.COLOR[m], marker=S.MARKER[m], mec="white", mew=0.5,
                      label=m) for m in METHODS]
    fig.legend(handles=handles, loc="upper center", ncol=len(handles), bbox_to_anchor=(0.5, 1.04),
               handlelength=1.8, columnspacing=1.4)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    S.save(fig, "F5_footprint_ccdf")


if __name__ == "__main__":
    main()
