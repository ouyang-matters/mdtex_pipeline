#!/usr/bin/env python3
"""F6 (E6): where locality fails. Amortised latency per toggle (1 atomic
edit per update) vs (a) the cycle length L (W5a: toggle one edge of C_L) and
(b) the number of triangles n_2 of the icosphere (W5b: toggle one triangle),
log-log, 3 seeds pooled. Legend entries carry the least-squares slope of
log(amortised latency) vs log(size) and the number of sizes it is fitted on;
the dotted line is a guide of slope 1 (work linear in the toggled cycle).

Reads experiments/results/summary.csv and summary_slopes.csv.
"""

import os

import numpy as np
import pandas as pd

import style as S

S.setup()
import matplotlib.pyplot as plt  # noqa: E402

METHODS = ["mmhm", "mmhm-norb", "drb-id-rb", "drb-id", "full-id", "gudhi", "euler"]


def main():
    df = pd.read_csv(os.path.join(S.RES, "summary.csv"))
    sl = pd.read_csv(os.path.join(S.RES, "summary_slopes.csv"))
    e6 = df[df.exp == "E6"].copy()
    fig, axes = plt.subplots(1, 2, figsize=(S.TEXTWIDTH, 3.0))
    panels = [("w5a", "WFiveCycle", lambda w: int(w.split("_L")[1]), "cycle length $L$ (edges)",
               "(a) W5a: toggle one edge of the cycle $C_L$"),
              ("w5b", "WFiveSphere", lambda w: 20 * 4 ** int(w.split("_L")[1]),
               "triangles $n_2$ of the sphere", "(b) W5b: toggle one triangle of a sphere")]
    for ax, (pre, fam, xf, xlab, title) in zip(axes, panels):
        sub = e6[e6.workload.str.startswith(pre)].copy()
        sub["x"] = sub.workload.map(xf)
        for m in METHODS:
            g = sub[sub.label == m].sort_values("x")
            if g.empty:
                continue
            s = sl[(sl.exp == "E6") & (sl.family == fam) & (sl.label == m) & (sl.stat == "Amort")]
            lab = m
            if len(s):
                lab = f"{m}  slope {s.slope.iloc[0]:.2f} ({int(s.n_points.iloc[0])} pts)"
            S.method_line(ax, g.x, g.amort_us, m, label=lab)
            pre_t = g[g["T"] < 2000]
            if len(pre_t):
                ax.plot(pre_t.x, pre_t.amort_us, ls="none", marker=S.MARKER[m], ms=6.5,
                        mfc="white", mec=S.COLOR[m], mew=1.0, zorder=5)
        # guide of slope 1 (work linear in the size of the toggled cycle),
        # a factor 3 below the fastest DRB variant at the smallest size
        dyn = sub[sub.label.isin(["mmhm", "mmhm-norb", "drb-id-rb", "drb-id"])]
        x0, x1 = sub.x.min(), sub.x.max()
        y0 = dyn[dyn.x == x0].amort_us.min() / 3
        ax.plot([x0, x1], [y0, y0 * x1 / x0], color=S.INK2, ls=(0, (1, 1.6)), lw=1.0, zorder=1)
        ax.set_xscale("log")
        ax.set_yscale("log")
        S.log_axis(ax, "x")
        S.log_axis(ax, "y")
        ax.set_xlabel(xlab)
        ax.set_ylabel(r"amortised latency per toggle ($\mu$s)")
        ax.set_title(title, loc="left")
        h, l = ax.get_legend_handles_labels()
        from matplotlib.lines import Line2D
        h.append(Line2D([], [], ls="none", marker="o", ms=6, mfc="white", mec=S.MUTED))
        l.append("hollow: prefix $T'=200$")
        h.append(Line2D([], [], color=S.INK2, ls=(0, (1, 1.6)), lw=1.0))
        l.append("guide of slope 1")
        ax.legend(h, l, loc="upper center", bbox_to_anchor=(0.5, -0.25), ncol=2, fontsize=6.6,
                  handlelength=1.5, columnspacing=1.0)
    fig.tight_layout()
    S.missing_note(fig, ["E6"], None, METHODS, y=-0.12)
    S.save(fig, "F6_nonlocality")


if __name__ == "__main__":
    main()
