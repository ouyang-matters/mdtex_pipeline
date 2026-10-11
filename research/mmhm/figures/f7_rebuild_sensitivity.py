#!/usr/bin/env python3
"""F7 (E7): rebuild policy sensitivity. For mmhm (rebuild = fresh collapse,
Morse order) and drb-id-rb (rebuild = static reduction in the current
insertion order): amortized latency (top) and p99 latency (bottom) vs the
growth trigger alpha, one line per period (off / 256 / 64); 3 seeds pooled.
alpha = off with period off never rebuilds (= mmhm-norb resp. drb-id).

Reads experiments/results/summary_e7.csv.
"""

import os

import numpy as np
import pandas as pd
from matplotlib.lines import Line2D

import style as S

S.setup()
import matplotlib.pyplot as plt  # noqa: E402

ALPHAS = ["0.25", "0.5", "1", "2", "4", "off"]
PERIODS = [("off", "-"), ("256", (0, (4, 1.5))), ("64", (0, (1, 1.2)))]
COLS = [("w2_N22_s8", "(a) W2 $N=22$, $s=8$"), ("w3_N20_k2", "(b) W3 $N=20$"),
        ("w4_2d_n16000_D2", "(c) W4 2D $n=16$k, $D=2$")]
METHODS = ["mmhm", "drb-id-rb"]


def main():
    e7 = pd.read_csv(os.path.join(S.RES, "summary_e7.csv"), dtype={"alpha": str, "period": str})
    fig, axes = plt.subplots(2, 3, figsize=(S.TEXTWIDTH, 3.9), sharex=True)
    x = np.arange(len(ALPHAS))
    for j, (w, title) in enumerate(COLS):
        sub = e7[e7.workload == w]
        for i, col in enumerate(["amort_us", "lat_p99_us"]):
            ax = axes[i, j]
            for m in METHODS:
                for p, ls in PERIODS:
                    g = sub[(sub.method == m) & (sub.period == p)].set_index("alpha")
                    y = [g[col].get(a, np.nan) for a in ALPHAS]
                    ax.plot(x, y, color=S.COLOR[m], ls=ls, lw=1.2, marker=S.MARKER[m], ms=4,
                            mec="white", mew=0.5)
            ax.set_yscale("log")
            ax.set_xticks(x)
            ax.set_xticklabels(ALPHAS)
            if i == 1:
                ax.set_xlabel(r"growth trigger $\alpha$")
            if i == 0:
                ax.set_title(title, loc="left")
        axes[0, 0].set_ylabel(r"amortized latency ($\mu$s)")
        axes[1, 0].set_ylabel(r"p99 latency ($\mu$s)")
    handles = [Line2D([], [], color=S.COLOR[m], marker=S.MARKER[m], mec="white", mew=0.5,
                      label=m) for m in METHODS]
    handles += [Line2D([], [], color=S.INK2, ls=ls, lw=1.2, label=f"period {p}")
                for p, ls in PERIODS]
    fig.legend(handles=handles, loc="upper center", ncol=len(handles), bbox_to_anchor=(0.5, 1.04),
               handlelength=2.4, columnspacing=1.3)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    S.save(fig, "F7_rebuild_sensitivity")


if __name__ == "__main__":
    main()
