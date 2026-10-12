#!/usr/bin/env python3
"""F3: cost vs edit size s at fixed |K| (E2: W2, N = 22, s = 1..64; the s = 8
point is E1's N = 22 instance). (a) per-update latency (pooled median, IQR
band); (b) amortised latency per atomic edit.

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
        if m == "mmhm-norb":
            # E1's N = 22 seed-1 run of mmhm-norb is a timing outlier (slow first 400
            # updates, identical algebra): mark the point it inflates, do not drop it.
            o = g[g.s == 8]
            a2.plot(o.s, o.amort_us / o.ops_mean, ls="none", marker=S.MARKER[m], ms=7.5,
                    mfc="white", mec=S.COLOR[m], mew=1.2, zorder=6)
            rr = os.path.join(S.RES, "rerun", "w2_N22_s8__mmhm-norb__seed1.csv.gz")
            txt = "hollow: includes the seed-1\ntiming outlier (see text)"
            if os.path.exists(rr):
                import gzip
                import numpy as np
                with gzip.open(rr, "rt") as fh:
                    d = pd.read_csv(fh)
                sib = []
                for k in (0, 2):
                    with gzip.open(os.path.join(S.RES, "E1", f"w2_N22_s8__mmhm-norb__seed{k}"
                                                f".csv.gz"), "rt") as fh:
                        x = pd.read_csv(fh)
                    sib.append(x[x.t > 0].time_ns.to_numpy(float))
                pool = np.concatenate(sib + [d[d.t > 0].time_ns.to_numpy(float)]) / 1e3
                v = pool.mean() / float(o.ops_mean.iloc[0])
                a2.plot([8], [v], ls="none", marker="x", ms=5, color=S.COLOR[m], mew=1.0,
                        zorder=7)
                txt += "\n\u00d7: seed 1 replaced by its rerun"
            a2.annotate(txt, xy=(8, float((o.amort_us / o.ops_mean).iloc[0])),
                        xytext=(1.05, 4.0), fontsize=6.2, color=S.INK2,
                        arrowprops=dict(arrowstyle="-", color=S.MUTED, lw=0.6))
    for ax in (a1, a2):
        ax.set_xscale("log", base=2)
        ax.set_yscale("log")
        S.log_axis(ax, "y")
        ax.set_xticks([1, 2, 4, 8, 16, 32, 64])
        ax.set_xticklabels(["1", "2", "4", "8", "16", "32", "64"])
        ax.xaxis.set_minor_locator(NullLocator())
        ax.set_xlabel(r"stellar moves per update $s$ ($16s$ atomic edits)")
    a1.set_ylabel(r"per-update latency ($\mu$s)")
    a2.set_ylabel(r"amortised latency per atomic edit ($\mu$s)")
    a1.set_title(r"(a) per update, median and IQR", loc="left")
    a2.set_title(r"(b) per atomic edit, amortised", loc="left")
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
