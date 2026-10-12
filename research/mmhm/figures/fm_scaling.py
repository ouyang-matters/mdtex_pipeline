#!/usr/bin/env python3
"""Main-text figure: dynamic-update performance and scaling on W2, W3, W4.
(a) W2 against |K_0| at s = 8 (E1); (b) W2 against the edit size s at N = 22
(E2); (c) W3 against |K_0| (E3); (d) W4, 2D, D = 2, against |K_0| (E4).
Median per-update latency, three runs pooled; bands: interquartile range of
mmhm and of full-id. full-morse (a slower static baseline) and the W1 panel are
in the supplement (F2_latency_vs_size, F3_latency_vs_edit_size).

Reads experiments/results/summary.csv (written by experiments/aggregate.py).
"""

import os

import pandas as pd
from matplotlib.lines import Line2D
from matplotlib.ticker import NullLocator

import style as S

S.setup()
import matplotlib.pyplot as plt  # noqa: E402

METHODS = ["mmhm", "mmhm-norb", "drb-id-rb", "drb-id", "full-id", "full-sorted", "gudhi"]
BANDS = {"mmhm", "full-id"}
PANELS = [
    ("E1", lambda w: w.startswith("w2_"), "K0", "(a) W2, size, $s=8$"),
    ("E2", lambda w: w.startswith("w2_N22"), "s", "(b) W2, edit size, $N=22$"),
    ("E3", lambda w: w.startswith("w3_"), "K0", "(c) W3 cavities"),
    ("E4", lambda w: w.startswith("w4_2d") and w.endswith("_D2"), "K0",
     "(d) W4 flag complexes, 2D, $D=2$"),
]


def main():
    df = pd.read_csv(os.path.join(S.RES, "summary.csv"))
    fig, axes = plt.subplots(2, 2, figsize=(S.TEXTWIDTH, 4.5))
    used = set()
    for ax, (exp, sel, xcol, title) in zip(axes.flat, PANELS):
        sub = df[(df.exp == exp) & df.workload.map(sel)].copy()
        if xcol == "s":
            sub["s"] = [int(w.split("_s")[1]) for w in sub.workload]
        for m in METHODS:
            g = sub[sub.label == m].sort_values(xcol)
            if len(g) < 3:  # e.g. full-sorted and gudhi have only the shared s = 8 point in (b)
                continue
            used.add(m)
            x = g[xcol].to_numpy()
            if m in BANDS:
                S.band(ax, x, g.lat_q1_us, g.lat_q3_us, m)
            S.method_line(ax, x, g.lat_med_us, m)
            pre = g[g["T"] < 2000]
            if len(pre):
                ax.plot(pre[xcol], pre.lat_med_us, ls="none", marker=S.MARKER[m], ms=6.5,
                        mfc="white", mec=S.COLOR[m], mew=1.0, zorder=5)
        ax.set_yscale("log")
        S.log_axis(ax, "y")
        if xcol == "s":
            ax.set_xscale("log", base=2)
            ax.set_xticks([1, 2, 4, 8, 16, 32, 64])
            ax.set_xticklabels(["1", "2", "4", "8", "16", "32", "64"])
            ax.xaxis.set_minor_locator(NullLocator())
            ax.set_xlabel(r"stellar moves per update $s$ ($16s$ atomic edits)")
        else:
            ax.set_xscale("log")
            S.log_axis(ax, "x")
            ax.set_xlabel(r"complex size $|K_0|$ (simplices)")
        ax.set_title(title, loc="left")
        if ax in axes[:, 0]:
            ax.set_ylabel(r"median latency per update ($\mu$s)")
    handles = [S.legend_handle(m) for m in METHODS if m in used]
    handles.append(Line2D([], [], ls="none", marker="o", ms=6, mfc="white", mec=S.MUTED,
                          label="prefix $T'=200$"))
    fig.legend(handles=handles, loc="upper center", ncol=4, bbox_to_anchor=(0.5, 1.035),
               handlelength=2.2, columnspacing=1.4)
    fig.tight_layout(rect=(0, 0, 1, 0.94))
    S.missing_note(fig, ["E1", "E2", "E3", "E4"], None, METHODS)
    S.save(fig, "FM1_scaling")


if __name__ == "__main__":
    main()
