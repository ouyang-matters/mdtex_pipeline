#!/usr/bin/env python3
"""F3: cost vs edit size s at fixed |K| (E2: W2, N = 22, s = 1..64; the s = 8
point is E1's N = 22 instance). (a) per-update latency (pooled median, IQR
band); (b) amortized latency per atomic edit.

Reads experiments/results/summary.csv.
"""

import os

import pandas as pd
from matplotlib.lines import Line2D
from matplotlib.ticker import NullLocator

import style as S

S.setup()
import matplotlib.pyplot as plt  # noqa: E402

METHODS = ["mmhm", "mmhm-norb", "drb-id-rb", "drb-id", "full-id", "full-morse"]


def main():
    df = pd.read_csv(os.path.join(S.RES, "summary.csv"))
    sub = df[(df.exp == "E2")].copy()
    sub["s"] = [int(w.split("_s")[1]) for w in sub.workload]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(S.TEXTWIDTH, 2.5))
    for m in METHODS:
        g = sub[sub.label == m].sort_values("s")
        if g.empty:
            continue
        S.band(a1, g.s, g.lat_q1_us, g.lat_q3_us, m)
        S.method_line(a1, g.s, g.lat_med_us, m)
        S.method_line(a2, g.s, g.amort_us / g.ops_mean, m)
    for ax in (a1, a2):
        ax.set_xscale("log", base=2)
        ax.set_yscale("log")
        S.log_axis(ax, "y")
        ax.set_xticks([1, 2, 4, 8, 16, 32, 64])
        ax.set_xticklabels(["1", "2", "4", "8", "16", "32", "64"])
        ax.xaxis.set_minor_locator(NullLocator())
        ax.set_xlabel(r"stellar moves per update $s$ ($16s$ atomic edits)")
    a1.set_ylabel(r"per-update latency ($\mu$s)")
    a2.set_ylabel(r"amortized latency per atomic edit ($\mu$s)")
    a1.set_title(r"(a) per update, median and IQR", loc="left")
    a2.set_title(r"(b) per atomic edit, amortized", loc="left")
    handles = [Line2D([], [], color=S.COLOR[m], marker=S.MARKER[m], mec="white", mew=0.6,
                      label=m) for m in S.ORDER if m in METHODS]
    fig.legend(handles=handles, loc="upper center", ncol=len(handles), bbox_to_anchor=(0.5, 1.06),
               handlelength=1.6, columnspacing=1.2)
    fig.tight_layout(rect=(0, 0, 1, 0.92))
    S.missing_note(fig, ["E2"], None, METHODS)
    S.missing_note(fig, ["E1"], lambda w: w == "w2_N22_s8", METHODS, y=-0.06)
    S.save(fig, "F3_latency_vs_edit_size")


if __name__ == "__main__":
    main()
