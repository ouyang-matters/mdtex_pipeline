#!/usr/bin/env python3
"""F4: behaviour over time (seed 0) for the four DRB methods.
Top row: per-update latency, mean over a sliding window of the last 50 updates
(plotted from t = 50; the cost of a rebuild is spread over its window). Bottom
row: nnz(R) + nnz(V) after each update. Thin vertical lines through both rows:
the rebuilds of mmhm and drb-id-rb (default policy alpha = 1, period off). Columns: W2 N = 22 (E1), W3 N = 20 (E3),
W1 torus 256x256 (E5); on W1 a grey rug marks the updates after which every
hole is closed (beta_2 = 1, the fundamental 2-cycle is present).

Reads experiments/results/E{1,3,5}/<workload>__<method>__seed0.csv.gz and the
full-id Betti file of the W1 instance.
"""

import gzip
import os

import numpy as np
import pandas as pd
from matplotlib.lines import Line2D

import style as S

S.setup()
import matplotlib.pyplot as plt  # noqa: E402

COLS = [("E1", "w2_N22_s8", "(a) W2 $N=22$, $s=8$"), ("E3", "w3_N20_k2", "(b) W3 $N=20$"),
        ("E5", "w1_torus_256", r"(c) W1 torus $256\times256$")]
METHODS = ["mmhm", "mmhm-norb", "drb-id-rb", "drb-id"]
WIN = 50


def load(exp, w, m, seed=0):
    p = os.path.join(S.RES, exp, f"{w}__{m}__seed{seed}.csv.gz")
    with gzip.open(p, "rt") as fh:
        return pd.read_csv(fh)


def main(cols=COLS, name="F4_time_series", width=S.TEXTWIDTH, height=3.9):
    fig, axes = plt.subplots(2, len(cols), figsize=(width, height), sharex=True,
                             squeeze=False)
    for j, (exp, w, title) in enumerate(cols):
        at, ab = axes[0, j], axes[1, j]
        ymax = 0
        for m in METHODS:
            try:
                df = load(exp, w, m)
            except FileNotFoundError:
                continue
            u = df[df.t > 0]
            roll = (u.time_ns / 1e3).rolling(WIN, min_periods=WIN).mean()  # from t = WIN
            at.plot(u.t, roll, color=S.COLOR[m], lw=1.1, label=m)
            # sparse markers as secondary encoding
            idx = np.arange(150, len(u), 400) + 40 * METHODS.index(m)
            idx = idx[idx < len(u)]
            at.plot(u.t.iloc[idx], roll.iloc[idx], ls="none", marker=S.MARKER[m], ms=4,
                    color=S.COLOR[m], mec="white", mew=0.5)
            nnz = (df.nnz_R + df.nnz_V) / 1e6
            ab.plot(df.t, nnz, color=S.COLOR[m], lw=1.1)
            ab.plot(df.t.iloc[idx], nnz.iloc[idx], ls="none", marker=S.MARKER[m], ms=4,
                    color=S.COLOR[m], mec="white", mew=0.5)
            ymax = max(ymax, roll.max())
        at.set_yscale("log")
        # every rebuild as a thin vertical line through both panels, so that it
        # lines up with the drop of nnz(R)+nnz(V) it causes
        for m in ["mmhm", "drb-id-rb"]:
            try:
                df = load(exp, w, m)
            except FileNotFoundError:
                continue
            for t in df[df.rebuild == 1].t:
                for ax in (at, ab):
                    ax.axvline(t, color=S.COLOR[m], lw=0.75, alpha=0.45, zorder=0.5)
        S.log_axis(at, "y")
        if w.startswith("w1"):
            bpath = os.path.join(S.RES, exp, f"{w}__full-id__seed0.betti.gz")
            with gzip.open(bpath, "rt") as fh:
                b2 = np.array([int(ln.split()[2]) for ln in fh if ln.strip()])
            closed = np.nonzero(b2 == 1)[0]
            closed = closed[closed > 0]
            ylo, yhi = ab.get_ylim()
            ab.plot(closed, np.full(len(closed), ylo + 0.03 * (yhi - ylo)), ls="none",
                    marker="|", ms=5, mew=0.9, color=S.MUTED)
            ab.text(0.02, 0.10, "| all holes closed", color=S.INK2, fontsize=6.5,
                    transform=ab.transAxes)
        at.set_title(title, loc="left")
        ab.set_xlabel("update $t$")
        ab.set_ylim(bottom=0)
    axes[0, 0].set_ylabel("latency ($\\mu$s), 50-update mean")
    axes[1, 0].set_ylabel(r"$\mathrm{nnz}(R)+\mathrm{nnz}(V)$ ($10^6$)")
    handles = [Line2D([], [], color=S.COLOR[m], marker=S.MARKER[m], mec="white", mew=0.5,
                      label=m) for m in METHODS]
    for m in ["mmhm", "drb-id-rb"]:
        handles.append(Line2D([], [], ls="none", marker="|", ms=9, mew=1.0, color=S.COLOR[m],
                              alpha=0.8, label=f"rebuild of {m}"))
    fig.legend(handles=handles, loc="upper center", ncol=len(handles) if len(cols) > 2 else 3,
               bbox_to_anchor=(0.5, 1.04 if len(cols) > 2 else 1.08),
               handlelength=1.6, columnspacing=1.2)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    S.missing_note(fig, [e for e, _, _ in cols], lambda w: w in [x for _, x, _ in cols],
                   METHODS + ["full-id"])
    S.save(fig, name)


if __name__ == "__main__":
    main()
