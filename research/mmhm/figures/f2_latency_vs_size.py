#!/usr/bin/env python3
"""F2: per-update latency vs |K_0| at fixed edit size (E1 W2, E3 W3, E4 W4,
E5 W1), log-log, pooled median over 3 seeds with the interquartile band.
full-sorted (static reduction in the canonical order, no drift) is the dashed
line with hollow squares, in full-id's colour (no band).

Reads experiments/results/summary.csv (written by experiments/aggregate.py).
"""

import os

import numpy as np
import pandas as pd
from matplotlib.lines import Line2D

import style as S

S.setup()
import matplotlib.pyplot as plt  # noqa: E402

PANELS = [
    ("E1", lambda w: w.startswith("w2_"), "(a) W2 refine/coarsen, $s=8$ (E1)"),
    ("E3", lambda w: w.startswith("w3_"), "(b) W3 cavities (E3)"),
    ("E4", lambda w: w.startswith("w4_2d") and w.endswith("_D2"),
     "(c) W4 flag complex, 2D, $D=2$ (E4)"),
    ("E5", lambda w: "sphere" in w, "(d) W1 punctured sphere (E5)"),
]


def main():
    df = pd.read_csv(os.path.join(S.RES, "summary.csv"))
    fig, axes = plt.subplots(2, 2, figsize=(S.TEXTWIDTH, 4.6), sharey=False)
    used = set()
    for ax, (exp, sel, title) in zip(axes.flat, PANELS):
        sub = df[(df.exp == exp) & df.workload.map(sel)]
        for m in S.ORDER:
            g = sub[sub.label == m].sort_values("K0")
            if g.empty:
                continue
            used.add(m)
            x = g.K0.to_numpy()
            if m != "full-sorted" and (exp != "E5" or
                                       m not in ("mmhm", "mmhm-norb", "drb-id", "drb-id-rb")):
                # on W1 the four DRB bands overlap into one unreadable band: omitted
                S.band(ax, x, g.lat_q1_us, g.lat_q3_us, m)
            S.method_line(ax, x, g.lat_med_us, m)
            # hollow marker where the baseline ran a prefix T' < T
            pre = g[g["T"] < 2000]
            if len(pre):
                ax.plot(pre.K0, pre.lat_med_us, ls="none", marker=S.MARKER[m], ms=6.5,
                        mfc="white", mec=S.COLOR[m], mew=1.0, zorder=5)
        ax.set_xscale("log")
        ax.set_yscale("log")
        S.log_axis(ax, "x")
        S.log_axis(ax, "y")
        ax.set_title(title, loc="left")
        if exp == "E5":
            ax.text(0.02, 0.97, "IQR bands of the DRB methods omitted\n(they overlap; "
                    "p95/p99 in the tables)", transform=ax.transAxes, ha="left", va="top",
                    fontsize=6.2, color=S.INK2)
        ax.set_xlabel(r"complex size $|K_0|$ (simplices)")
        ax.set_ylabel(r"per-update latency ($\mu$s)")
        ax.grid(True, which="major")
    handles = [S.legend_handle(m) for m in S.ORDER if m in used]
    handles.append(Line2D([], [], ls="none", marker="o", ms=6, mfc="white", mec=S.MUTED,
                          label="prefix $T'=200$"))
    fig.legend(handles=handles, loc="upper center", ncol=(len(handles) + 1) // 2,
               bbox_to_anchor=(0.5, 1.06), handlelength=2.2, columnspacing=1.2)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    S.missing_note(fig, ["E1", "E3", "E4", "E5"],
                   lambda w: any(sel(w) for _, sel, _ in PANELS), S.ORDER)
    S.save(fig, "F2_latency_vs_size")


if __name__ == "__main__":
    main()
