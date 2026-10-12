#!/usr/bin/env python3
"""FM4 (E7, W3 N = 20): the rebuild policy as a trade-off between how often
the basis is rebuilt and what an update costs. x: rebuilds per run (mean over
3 seeds, T = 2000 updates); y: (a) amortised and (b) p99 latency per update,
rebuilds included (a rebuild is charged to the update that triggers it).
Solid lines: the growth trigger alone, alpha = never, 4, 2, 1, 0.5, 0.25.
Hollow markers: periodic rebuilds alone, every 256 or 64 updates. Grey dashed
line: the static reference on the same instance (full-sorted, E3). The full
sweep on W2, W3 and W4 is F7 in the supplement.

Reads experiments/results/summary_e7.csv and summary.csv.
"""

import os

import pandas as pd
from matplotlib.lines import Line2D

import style as S

S.setup()
import matplotlib.pyplot as plt  # noqa: E402

W = "w3_N20_k2"
METHODS = ["mmhm", "drb-id-rb"]
ALPHAS = ["off", "4", "2", "1", "0.5", "0.25"]
ALPHA_LABEL = {"off": "never", "4": "4", "2": "2", "1": "1", "0.5": "0.5", "0.25": "0.25"}
T = 2000
# text colours: the method colour, darkened for the yellow (contrast on white)
TEXT_COLOR = {"mmhm": S.COLOR["mmhm"], "drb-id-rb": "#8a5f00"}
# (panel column, method, alpha) -> label offset (points) and alignment
LABEL_POS = {
    ("amort_us", "mmhm", "off"): (-6, 0, "right", "center"),
    ("amort_us", "drb-id-rb", "off"): (-6, 0, "right", "center"),
    ("amort_us", "mmhm", "1"): (2, -9, "center", "top"),
    ("amort_us", "drb-id-rb", "1"): (2, 9, "left", "bottom"),
    ("amort_us", "mmhm", "0.25"): (0, -7, "center", "top"),
    ("amort_us", "drb-id-rb", "0.25"): (0, 6, "center", "bottom"),
    ("lat_p99_us", "mmhm", "off"): (-6, 0, "right", "center"),
    ("lat_p99_us", "drb-id-rb", "off"): (-6, 0, "right", "center"),
    ("lat_p99_us", "mmhm", "1"): (2, -9, "center", "top"),
    ("lat_p99_us", "drb-id-rb", "1"): (0, 11, "center", "bottom"),
    ("lat_p99_us", "mmhm", "0.25"): (6, -1, "left", "center"),
    ("lat_p99_us", "drb-id-rb", "0.25"): (0, -7, "center", "top"),
}


def main():
    e7 = pd.read_csv(os.path.join(S.RES, "summary_e7.csv"), dtype={"alpha": str, "period": str})
    e7 = e7[e7.workload == W]
    summ = pd.read_csv(os.path.join(S.RES, "summary.csv"))
    ref = summ[(summ.exp == "E3") & (summ.workload == W) & (summ.method == "full-sorted")]
    assert len(ref) == 1, "static reference missing"
    ref = ref.iloc[0]

    fig, axes = plt.subplots(1, 2, figsize=(S.TEXTWIDTH, 2.6))
    panels = [("amort_us", ref.amort_us, "amortised latency per update (ms)", "(a) amortised"),
              ("lat_p99_us", ref.lat_p99_us, "p99 latency per update (ms)", "(b) p99")]
    for ax, (col, refv, ylab, title) in zip(axes, panels):
        for m in METHODS:
            d = e7[e7.method == m]
            trig = d[d.period == "off"].set_index("alpha").loc[ALPHAS]
            x, y = trig.rebuilds.to_numpy(), trig[col].to_numpy() / 1e3
            S.method_line(ax, x, y, m, zorder=3)
            # label three points per line: never, the default alpha = 1 (ringed)
            # and the most aggressive alpha = 0.25; the line runs through
            # alpha = never, 4, 2, 1, 0.5, 0.25 from left to right
            for a in ("off", "1", "0.25"):
                xi, yi = trig.loc[a, "rebuilds"], trig.loc[a, col] / 1e3
                lab = {"off": "never", "1": r"$\alpha$=1 (default)", "0.25": r"$\alpha$=0.25"}[a]
                if (col, m, a) == ("lat_p99_us", "drb-id-rb", "1"):
                    lab = r"$\alpha$=1"  # no room for more between the two segments
                dx, dy, ha, va = LABEL_POS[(col, m, a)]
                ax.annotate(lab, (xi, yi), xytext=(dx, dy), textcoords="offset points", ha=ha,
                            va=va, fontsize=6.4, color=TEXT_COLOR[m])
            xd, yd = trig.loc["1", "rebuilds"], trig.loc["1", col] / 1e3
            ax.plot([xd], [yd], ls="none", marker="o", ms=10, mfc="none", mec=S.INK2, mew=0.8,
                    zorder=4)
            per = d[(d.alpha == "off") & (d.period != "off")]
            ax.plot(per.rebuilds, per[col] / 1e3, ls="none", marker=S.MARKER[m], ms=5.5,
                    mfc="white", mec=S.COLOR[m], mew=1.1, zorder=3)
        ax.axhline(refv / 1e3, color=S.MUTED, ls=(0, (4, 2)), lw=1.0, zorder=1)
        ax.annotate("static reference (full-sorted)", (47.5, refv / 1e3), xytext=(0, 2.5),
                    textcoords="offset points", ha="right", va="bottom", fontsize=6.2,
                    color=S.INK2)
        if col == "lat_p99_us":
            ax.axvline(T / 100, color=S.MUTED, ls=":", lw=1.0, zorder=1)
            ax.annotate("1% of the updates\nare rebuilds", (T / 100, 47), xytext=(-3, 0),
                        textcoords="offset points", ha="right", va="top", fontsize=6.2,
                        color=S.INK2)
        ax.set_xlim(-7, 48)
        ax.set_ylim(0, None)
        ax.set_xlabel("rebuilds per run (mean of 3 seeds)")
        ax.set_ylabel(ylab)
        ax.set_title(title, loc="left")
    axes[0].set_ylim(0, 7.2)
    axes[1].set_ylim(0, 52)
    handles = [S.legend_handle(m) for m in METHODS]
    handles[0].set_label("mmhm: growth trigger, Morse-order rebuilds")
    handles[1].set_label("drb-id-rb: growth trigger, insertion-order rebuilds")
    handles.append(Line2D([], [], ls="none", marker="o", mfc="white", mec=S.INK2, mew=1.0,
                          label="periodic rebuilds only"))
    fig.legend(handles=handles, loc="upper center", ncol=3, bbox_to_anchor=(0.5, 1.07),
               handlelength=1.8, columnspacing=1.2)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    S.missing_note(fig, ["E7"], lambda w: w == W, METHODS)
    S.save(fig, "FM4_rebuild_policy")


if __name__ == "__main__":
    main()
