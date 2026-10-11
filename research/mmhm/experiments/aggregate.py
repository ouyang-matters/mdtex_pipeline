#!/usr/bin/env python3
"""Aggregates committed results into summary CSVs, LaTeX tables and macros.

Reads only committed files: experiments/configs/E*.json,
experiments/results/<exp>/*.csv.gz|*.betti.gz, results/E0_*.csv,
results/E0/samples_crosscheck.csv and results/noise/noise_runs.csv.
Writes

  results/summary_runs.csv     one row per run (per-update latency statistics,
                               rebuilds, chain additions, footprints, nnz)
  results/summary.csv          one row per (exp, workload, label), seeds pooled
  results/summary_slopes.csv   log-log least-squares slopes (E1-E6)
  results/summary_e8.csv       E8 distributions (Morse vs insertion order)
  results/summary_w4_betti.csv W4 Betti ranges
  ../paper/generated/numbers.tex and tab_*.tex (booktabs tabulars)

Statistics: latency is the engine's per-update `time_ns` (t >= 1; rebuilds
included in the update that triggers them). Per (exp, workload, method) the
updates of all seeds are pooled: median, quartiles, p95, p99 of the pooled
per-update latencies; amortized = total time / number of updates (incl.
rebuilds). Speedups are ratios of amortized latencies; static baselines that
ran a prefix T' (gudhi above 3e5 simplices) are compared on their own prefix
(their per-update cost does not drift: see summary_runs.csv).

  python3 aggregate.py
"""

from __future__ import annotations

import csv
import glob
import gzip
import json
import math
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run as runner  # noqa: E402

ROOT = os.path.dirname(HERE)
RES = os.path.join(HERE, "results")
GEN = os.path.join(ROOT, "paper", "generated")

METHOD_ORDER = ["full-id", "full-morse", "gudhi", "drb-id", "drb-id-rb", "mmhm-norb", "mmhm",
                "euler"]
DYN = ["drb-id", "drb-id-rb", "mmhm-norb", "mmhm"]
METHOD_TAG = {"full-id": "FullId", "full-morse": "FullMorse", "gudhi": "Gudhi",
              "drb-id": "DrbId", "drb-id-rb": "DrbIdRb", "mmhm": "Mmhm",
              "mmhm-norb": "MmhmNorb", "euler": "Euler", "lcr": "Lcr"}

# ----------------------------------------------------------------- words ----
_ONES = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
         "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
         "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def words(n: int) -> str:
    """English number words, capitalised, no separators: 256 -> TwoHundredFiftySix."""
    n = int(n)
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + (_ONES[n % 10] if n % 10 else "")
    if n < 1000:
        return _ONES[n // 100] + "Hundred" + (words(n % 100) if n % 100 else "")
    if n < 1_000_000:
        return words(n // 1000) + "Thousand" + (words(n % 1000) if n % 1000 else "")
    return words(n // 1_000_000) + "Million" + (words(n % 1_000_000) if n % 1_000_000 else "")


def inst_tag(w: str) -> str:
    """Letter-only tag of a workload instance name used in results/."""
    p = w.split("_")
    if p[0] == "w1":
        if p[1] == "sphere":
            return "WOneSphereL" + words(int(p[2][1:]))
        return "WOneTorus" + words(int(p[2]))
    if p[0] == "w2":
        return "WTwoN" + words(int(p[1][1:])) + "S" + words(int(p[2][1:]))
    if p[0] == "w3":
        return "WThreeN" + words(int(p[1][1:]))
    if p[0] == "w4":
        amb = "Plane" if p[1] == "2d" else "Space"
        return "WFour" + amb + "N" + words(int(p[2][1:])) + "D" + words(int(p[3][1:]))
    if p[0] == "w5a":
        return "WFiveCycleL" + words(int(p[1][1:]))
    if p[0] == "w5b":
        return "WFiveSphereL" + words(int(p[1][1:]))
    raise ValueError(w)


def pretty_inst(w: str) -> str:
    """Human-readable instance name for tables."""
    p = w.split("_")
    if p[0] == "w1":
        return (f"W1 sphere $L={p[2][1:]}$" if p[1] == "sphere"
                else f"W1 torus ${p[2]}\\times{p[2]}$")
    if p[0] == "w2":
        return f"W2 $N={p[1][1:]}$, $s={p[2][1:]}$"
    if p[0] == "w3":
        return f"W3 $N={p[1][1:]}$"
    if p[0] == "w4":
        n = int(p[2][1:])
        nn = f"{n // 1000}\\text{{k}}" if n % 1000 == 0 else str(n)
        return f"W4 {p[1].upper()} $n={nn}$, $D={p[3][1:]}$"
    if p[0] == "w5a":
        return f"W5a $L={int(p[1][1:]):,}$".replace(",", "{,}")
    if p[0] == "w5b":
        return f"W5b level {p[1][1:]}"
    return w


# ---------------------------------------------------------------- format ----
def sig(x, n=3):
    """n significant digits, thousands separated with {,} (LaTeX-safe)."""
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return "--"
    x = float(x)
    if x == 0:
        return "0"
    d = n - 1 - int(math.floor(math.log10(abs(x))))
    v = round(x, d)
    if d <= 0:
        s = f"{int(round(v)):,}"
    else:
        s = f"{v:,.{d}f}"
    return s.replace(",", "{,}")


def intc(x):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "--"
    return f"{int(round(float(x))):,}".replace(",", "{,}")


def pct(x, nd=1):
    return f"{100 * float(x):.{nd}f}"


class Macros:
    def __init__(self):
        self.items = {}

    def add(self, name, value, desc, source):
        assert name.isalpha() and name.startswith("Num"), name
        if name in self.items and self.items[name][0] != value:
            raise ValueError(f"macro {name} defined twice with different values")
        self.items[name] = (value, desc, source)

    def write(self, path):
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("% Generated by experiments/aggregate.py -- do not edit.\n"
                     "% Each macro: \\newcommand{\\NumX}{value} preceded by a comment saying\n"
                     "% what it is and which config/script produced it. See README.md.\n")
            for name in sorted(self.items):
                v, d, s = self.items[name]
                fh.write(f"% {d} [{s}]\n\\newcommand{{\\{name}}}{{{v}}}\n")


# ---------------------------------------------------------------- loading ---
def load_all_runs():
    runs = []
    for cfg in sorted(glob.glob(os.path.join(HERE, "configs", "E*.json"))):
        _, rs = runner.load_runs(cfg)
        runs += [r for r in rs if r.done()]
    return runs


def read_run(r):
    with gzip.open(r.csv, "rt", encoding="utf-8") as fh:
        return pd.read_csv(fh)


def run_stats(r, df, K_by_instance):
    u = df[df.t > 0]
    lat = u.time_ns.to_numpy(dtype=float) / 1e3
    st = {"exp": r.exp, "workload": r.workload, "label": r.label, "method": r.method,
          "seed": r.seed, "instance": r.instance, "args": " ".join(r.args),
          "timed": int(r.timed), "T": len(u), "init_ms": df.time_ns.iloc[0] / 1e6,
          "lat_med_us": np.median(lat), "lat_q1_us": np.percentile(lat, 25),
          "lat_q3_us": np.percentile(lat, 75), "lat_p95_us": np.percentile(lat, 95),
          "lat_p99_us": np.percentile(lat, 99), "lat_max_us": lat.max(),
          "amort_us": lat.mean()}
    if "n0" in df:
        K = df.n0 + df.n1 + df.n2 + df.n3
        st["K0"] = int(K.iloc[0])
        st["K_mean"] = float(K.iloc[1:].mean()) if len(K) > 1 else float(K.iloc[0])
        st["ops_mean"] = float(u.ops.mean())
        dyn = u[u.rebuild == 0]
        st.update(rebuilds=int(u.rebuild.sum()), rebuild_ms_total=u.rebuild_ns.sum() / 1e6,
                  rebuild_ms_med=(u[u.rebuild == 1].rebuild_ns.median() / 1e6
                                  if u.rebuild.sum() else np.nan),
                  lat_dyn_med_us=np.median(dyn.time_ns) / 1e3 if len(dyn) else np.nan,
                  adds_mean=dyn.chain_adds.mean(), adds_med=dyn.chain_adds.median(),
                  adds_p95=dyn.chain_adds.quantile(.95), adds_max=dyn.chain_adds.max(),
                  fp_mean=dyn.footprint_sum.mean(), fp_med=dyn.footprint_sum.median(),
                  fp_p95=dyn.footprint_sum.quantile(.95), fp_max=dyn.footprint_sum.max(),
                  nnz0=int(df.nnz_R.iloc[0] + df.nnz_V.iloc[0]),
                  nnz_end=int(df.nnz_R.iloc[-1] + df.nnz_V.iloc[-1]),
                  nnz_max=int((df.nnz_R + df.nnz_V).max()),
                  build_adds=int(df.chain_adds.iloc[0]))
        K_by_instance[r.instance] = (st["K0"], st["K_mean"])
    return st, lat


def pooled(rows, lats):
    allv = np.concatenate(lats)
    am = [x["amort_us"] for x in rows]
    p = {"seeds": len(rows), "T": int(min(x["T"] for x in rows)),
         "T_max": int(max(x["T"] for x in rows)),
         "lat_med_us": np.median(allv), "lat_q1_us": np.percentile(allv, 25),
         "lat_q3_us": np.percentile(allv, 75), "lat_p95_us": np.percentile(allv, 95),
         "lat_p99_us": np.percentile(allv, 99), "lat_max_us": allv.max(),
         "amort_us": allv.mean(), "amort_seed_min_us": min(am), "amort_seed_max_us": max(am),
         "med_seed_min_us": min(x["lat_med_us"] for x in rows),
         "med_seed_max_us": max(x["lat_med_us"] for x in rows),
         "init_ms": float(np.median([x["init_ms"] for x in rows]))}
    for k in ("K0", "K_mean", "ops_mean", "rebuilds", "rebuild_ms_total", "rebuild_ms_med",
              "adds_mean", "adds_med", "adds_p95", "fp_mean", "fp_med", "fp_p95", "fp_max",
              "nnz0", "nnz_end", "nnz_max", "lat_dyn_med_us"):
        vals = [x[k] for x in rows if k in x and x[k] is not None and not
                (isinstance(x[k], float) and math.isnan(x[k]))]
        p[k] = float(np.mean(vals)) if vals else np.nan
    return p


def fit_slope(x, y):
    x, y = np.log10(np.asarray(x, float)), np.log10(np.asarray(y, float))
    A = np.vstack([x, np.ones_like(x)]).T
    (b, a), res, *_ = np.linalg.lstsq(A, y, rcond=None)
    yhat = A @ np.array([b, a])
    ss = ((y - y.mean()) ** 2).sum()
    r2 = 1 - ((y - yhat) ** 2).sum() / ss if ss > 0 else float("nan")
    return float(b), float(a), float(r2)


def read_betti_gz(path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return np.array([[int(v) for v in ln.split()] for ln in fh if ln.strip()])


# ------------------------------------------------------------------ main ----
def main():
    os.makedirs(GEN, exist_ok=True)
    M = Macros()
    runs = load_all_runs()
    K_by_instance = {}
    per_run, lat_by_key = [], {}
    for r in runs:
        df = read_run(r)
        st, lat = run_stats(r, df, K_by_instance)
        per_run.append(st)
        lat_by_key[(r.exp, r.workload, r.label, r.seed)] = lat
    for st in per_run:  # gudhi CSVs carry no sizes
        if "K0" not in st and st["instance"] in K_by_instance:
            st["K0"], st["K_mean"] = K_by_instance[st["instance"]]
    runs_df = pd.DataFrame(per_run).sort_values(["exp", "workload", "label", "seed"])
    runs_df.to_csv(os.path.join(RES, "summary_runs.csv"), index=False, float_format="%.6g")

    # pooled over seeds; E2 borrows E1's N = 22, s = 8 instance
    groups = {}
    for st in per_run:
        if not st["timed"]:
            continue
        groups.setdefault((st["exp"], st["workload"], st["label"]), []).append(st)
        if st["exp"] == "E1" and st["workload"] == "w2_N22_s8":
            groups.setdefault(("E2", st["workload"], st["label"]), []).append(st)
    summ = []
    for (exp, w, lab), rows in groups.items():
        lats = [lat_by_key[(x["exp"], x["workload"], x["label"], x["seed"])] for x in rows]
        p = pooled(rows, lats)
        p.update(exp=exp, workload=w, label=lab, method=rows[0]["method"],
                 args=rows[0]["args"], instance_stem=rows[0]["instance"].rsplit("_seed", 1)[0])
        summ.append(p)
    S = pd.DataFrame(summ)
    # speedups vs full-id and gudhi of the same (exp, workload)
    for col, ref in (("speedup_fullid", "full-id"), ("speedup_gudhi", "gudhi")):
        refs = S[S.label == ref].set_index(["exp", "workload"]).amort_us
        S[col] = [refs.get((e, w), np.nan) / a for e, w, a in zip(S.exp, S.workload, S.amort_us)]
        refm = S[S.label == ref].set_index(["exp", "workload"]).lat_med_us
        S[col + "_med"] = [refm.get((e, w), np.nan) / a
                           for e, w, a in zip(S.exp, S.workload, S.lat_med_us)]
    first = ["exp", "workload", "label", "method", "args", "seeds", "T", "T_max", "K0"]
    S = S[first + [c for c in S.columns if c not in first]]
    S = S.sort_values(["exp", "K0", "workload", "label"])
    S.to_csv(os.path.join(RES, "summary.csv"), index=False, float_format="%.6g")

    src_cfg = lambda e: f"configs/{e}.json, aggregate.py"  # noqa: E731

    # ------------------------------------------------ per-instance macros --
    base = S[S.exp.isin(["E1", "E2", "E3", "E4", "E5", "E6"])]
    seen = set()
    for _, row in base.iterrows():
        key = (row.workload, row.label)
        if key in seen:
            continue
        seen.add(key)
        tag = inst_tag(row.workload)
        mt = METHOD_TAG[row.method]
        pre = f"Num{tag}{mt}"
        what = f"{row.workload} / {row.label}"
        src = src_cfg(row.exp)
        M.add(pre + "Med", sig(row.lat_med_us), f"{what}: median per-update latency (us), "
              f"{int(row.seeds)} seeds pooled", src)
        M.add(pre + "QOne", sig(row.lat_q1_us), f"{what}: 25th percentile latency (us)", src)
        M.add(pre + "QThree", sig(row.lat_q3_us), f"{what}: 75th percentile latency (us)", src)
        M.add(pre + "PNinetyFive", sig(row.lat_p95_us), f"{what}: p95 latency (us)", src)
        M.add(pre + "PNinetyNine", sig(row.lat_p99_us), f"{what}: p99 latency (us)", src)
        M.add(pre + "Max", sig(row.lat_max_us), f"{what}: max latency (us)", src)
        M.add(pre + "Amort", sig(row.amort_us), f"{what}: amortized latency = total time incl. "
              f"rebuilds / updates (us)", src)
        M.add(pre + "InitMs", sig(row.init_ms), f"{what}: INIT build time (ms), median of seeds",
              src)
        M.add(pre + "T", intc(row["T"]), f"{what}: updates timed per run (T or prefix T')", src)
        if row.method != "full-id" and not math.isnan(row.speedup_fullid):
            M.add(pre + "SpeedupFullId", sig(row.speedup_fullid),
                  f"{what}: amortized latency of full-id / this method", src)
            M.add(pre + "SpeedupFullIdMed", sig(row.speedup_fullid_med),
                  f"{what}: median latency of full-id / this method", src)
        if row.method != "gudhi" and not math.isnan(row.speedup_gudhi):
            M.add(pre + "SpeedupGudhi", sig(row.speedup_gudhi),
                  f"{what}: amortized latency of gudhi (on its T or T' prefix) / this method", src)
        if row.method in DYN:
            M.add(pre + "Adds", sig(row.adds_mean), f"{what}: mean column additions per update "
                  f"(non-rebuild updates)", src)
            M.add(pre + "Footprint", sig(row.fp_mean), f"{what}: mean footprint_sum per update "
                  f"(sum of |occ| over deletions)", src)
            M.add(pre + "NnzStart", intc(row.nnz0), f"{what}: nnz(R)+nnz(V) after INIT "
                  f"(mean of seeds)", src)
            M.add(pre + "NnzEnd", intc(row.nnz_end), f"{what}: nnz(R)+nnz(V) after the last "
                  f"update (mean of seeds)", src)
            M.add(pre + "NnzMax", intc(row.nnz_max), f"{what}: max nnz(R)+nnz(V) over the run "
                  f"(mean of seeds)", src)
            M.add(pre + "NnzGrowth", sig(row.nnz_end / row.nnz0),
                  f"{what}: nnz at the end / nnz after INIT", src)
        if row.method in ("mmhm", "drb-id-rb"):
            M.add(pre + "Rebuilds", sig(row.rebuilds, 2), f"{what}: rebuilds per run (mean of "
                  f"seeds), default policy alpha=1, period off", src)
        if row.label == "full-id":
            M.add(f"Num{tag}Size", intc(row.K0), f"{row.workload}: |K_0| (mean of seeds)", src)
            M.add(f"Num{tag}Ops", sig(row.ops_mean), f"{row.workload}: mean atomic edits per "
                  f"update", src)
    # full-morse / full-id ratio per instance
    for (exp, w), g in base.groupby(["exp", "workload"]):
        a = g.set_index("label").amort_us
        if "full-morse" in a and "full-id" in a:
            M.add(f"Num{inst_tag(w)}FullMorseOverFullId", sig(a["full-morse"] / a["full-id"]),
                  f"{w}: amortized latency full-morse / full-id", src_cfg(exp))

    # --------------------------------------------------------------- slopes --
    slope_rows = []

    def add_slopes(exp, fam, sub, xcol, xname):
        for lab, g in sub.groupby("label"):
            g = g.dropna(subset=[xcol]).sort_values(xcol)
            if len(g) < 2:
                continue
            for stat, col in (("Med", "lat_med_us"), ("Amort", "amort_us")):
                b, a, r2 = fit_slope(g[xcol], g[col])
                slope_rows.append({"exp": exp, "family": fam, "label": lab, "stat": stat,
                                   "x": xname, "n_points": len(g), "slope": b, "intercept": a,
                                   "r2": r2, "x_min": g[xcol].min(), "x_max": g[xcol].max(),
                                   "workloads": " ".join(g.workload)})
    e1 = S[S.exp == "E1"]
    add_slopes("E1", "WTwoSEight", e1, "K0", "|K_0|")
    e2 = S[S.exp == "E2"].copy()
    e2["s"] = [int(w.split("_s")[1]) for w in e2.workload]
    add_slopes("E2", "WTwoNTwentyTwo", e2, "s", "s")
    add_slopes("E3", "WThree", S[S.exp == "E3"], "K0", "|K_0|")
    e4 = S[(S.exp == "E4") & S.workload.str.startswith("w4_2d") & S.workload.str.endswith("D2")]
    add_slopes("E4", "WFourPlaneDTwo", e4, "K0", "|K_0|")
    e5 = S[S.exp == "E5"]
    add_slopes("E5", "WOneSphere", e5[e5.workload.str.contains("sphere")], "K0", "|K_0|")
    add_slopes("E5", "WOneTorus", e5[e5.workload.str.contains("torus")], "K0", "|K_0|")
    e6 = S[S.exp == "E6"].copy()
    cyc = e6[e6.workload.str.startswith("w5a")].copy()
    cyc["L"] = [int(w.split("_L")[1]) for w in cyc.workload]
    add_slopes("E6", "WFiveCycle", cyc, "L", "L")
    sph = e6[e6.workload.str.startswith("w5b")].copy()
    sph["n2"] = [20 * 4 ** int(w.split("_L")[1]) for w in sph.workload]
    add_slopes("E6", "WFiveSphere", sph, "n2", "n_2")
    SL = pd.DataFrame(slope_rows)
    SL.to_csv(os.path.join(RES, "summary_slopes.csv"), index=False, float_format="%.6g")
    expname = {"E1": "EOne", "E2": "ETwo", "E3": "EThree", "E4": "EFour", "E5": "EFive",
               "E6": "ESix"}
    for _, s in SL.iterrows():
        mt = METHOD_TAG[s.label] if s.label in METHOD_TAG else None
        if mt is None:
            continue
        pre = f"NumSlope{expname[s.exp]}{s.family}{mt}{s.stat}"
        M.add(pre, f"{s.slope:.2f}", f"{s.exp} {s.family} {s.label}: least-squares slope of "
              f"log10({'median' if s.stat == 'Med' else 'amortized'} latency) vs log10({s.x}), "
              f"{s.n_points} points ({s.workloads})", "aggregate.py")
        M.add(pre + "N", str(int(s.n_points)), f"number of points of \\{pre}", "aggregate.py")
        M.add(pre + "RSq", f"{s.r2:.3f}", f"R^2 of \\{pre}", "aggregate.py")

    # ------------------------------------------------------------------- E7 --
    e7 = S[S.exp == "E7"].copy()
    atag = {"0.25": "AQuarter", "0.5": "AHalf", "1": "AOne", "2": "ATwo", "4": "AFour",
            "off": "AOff"}
    ptag = {"off": "POff", "64": "PSixtyFour", "256": "PTwoHundredFiftySix"}
    e7["alpha"] = [lab.split("_a")[1].split("_p")[0] for lab in e7.label]
    e7["period"] = [lab.split("_p")[1] for lab in e7.label]
    for _, row in e7.iterrows():
        pre = (f"NumESeven{inst_tag(row.workload)}{METHOD_TAG[row.method]}"
               f"{atag[row.alpha]}{ptag[row.period]}")
        what = f"E7 {row.workload} {row.method} alpha={row.alpha} period={row.period}"
        M.add(pre + "Amort", sig(row.amort_us), f"{what}: amortized latency (us)", src_cfg("E7"))
        M.add(pre + "Med", sig(row.lat_med_us), f"{what}: median latency (us)", src_cfg("E7"))
        M.add(pre + "PNinetyNine", sig(row.lat_p99_us), f"{what}: p99 latency (us)",
              src_cfg("E7"))
        M.add(pre + "Rebuilds", sig(row.rebuilds, 2), f"{what}: rebuilds per run (mean of seeds)",
              src_cfg("E7"))
        M.add(pre + "Adds", sig(row.adds_mean), f"{what}: mean additions per non-rebuild update",
              src_cfg("E7"))
    e7.to_csv(os.path.join(RES, "summary_e7.csv"), index=False, float_format="%.6g")

    # ------------------------------------------------------------------- E8 --
    e8_inst = {"w2_N22_s8": "E1", "w3_N20_k2": "E3", "w4_2d_n16000_D2": "E4",
               "w1_torus_256": "E5"}
    e8 = runs_df[runs_df.workload.isin(e8_inst) & runs_df.method.isin(DYN) &
                 runs_df.label.isin(DYN)]
    e8 = e8.loc[np.array([e8_inst[w] == e for w, e in zip(e8.workload, e8.exp)], dtype=bool)]
    E8 = []
    for (w, lab), g in e8.groupby(["workload", "label"]):
        # pooled distributions over seeds from the raw CSVs
        adds, fps = [], []
        for _, x in g.iterrows():
            r = [rr for rr in runs if rr.exp == x.exp and rr.workload == w and rr.label == lab and
                 rr.seed == x.seed][0]
            df = read_run(r)
            u = df[(df.t > 0) & (df.rebuild == 0)]
            adds.append(u.chain_adds.to_numpy())
            fps.append(u.footprint_sum.to_numpy())
        adds, fps = np.concatenate(adds), np.concatenate(fps)
        E8.append({"workload": w, "label": lab, "updates": len(adds),
                   "adds_mean": adds.mean(), "adds_med": np.median(adds),
                   "adds_p95": np.percentile(adds, 95), "adds_p99": np.percentile(adds, 99),
                   "adds_max": adds.max(), "frac_zero_adds": (adds == 0).mean(),
                   "fp_mean": fps.mean(), "fp_med": np.median(fps),
                   "fp_p95": np.percentile(fps, 95), "fp_p99": np.percentile(fps, 99),
                   "fp_max": fps.max(), "nnz0": g.nnz0.mean(), "nnz_end": g.nnz_end.mean(),
                   "nnz_max": g.nnz_max.mean(), "rebuilds": g.rebuilds.mean()})
    E8 = pd.DataFrame(E8, columns=["workload", "label", "updates", "adds_mean", "adds_med",
                                   "adds_p95", "adds_p99", "adds_max", "frac_zero_adds", "fp_mean",
                                   "fp_med", "fp_p95", "fp_p99", "fp_max", "nnz0", "nnz_end",
                                   "nnz_max", "rebuilds"])
    E8.to_csv(os.path.join(RES, "summary_e8.csv"), index=False, float_format="%.6g")
    for _, x in E8.iterrows():
        pre = f"NumEEight{inst_tag(x.workload)}{METHOD_TAG[x.label]}"
        what = f"E8 {x.workload} {x.label} (3 seeds pooled, non-rebuild updates)"
        M.add(pre + "AddsMed", sig(x.adds_med), f"{what}: median additions per update",
              "aggregate.py")
        M.add(pre + "AddsPNinetyNine", sig(x.adds_p99), f"{what}: p99 additions per update",
              "aggregate.py")
        M.add(pre + "FootprintMed", sig(x.fp_med), f"{what}: median footprint_sum per update",
              "aggregate.py")
        M.add(pre + "FootprintPNinetyNine", sig(x.fp_p99), f"{what}: p99 footprint_sum",
              "aggregate.py")
        M.add(pre + "ZeroAddsPct", pct(x.frac_zero_adds), f"{what}: % of updates with zero "
              f"additions", "aggregate.py")

    # ---------------------------------------------------------- W4 betti ----
    w4rows = []
    for w in sorted({r.workload for r in runs if r.workload.startswith("w4")}):
        bs, n0s = [], []
        for r in runs:
            if r.workload == w and r.label == "full-id":
                b = read_betti_gz(r.betti)
                bs.append(b)
                n0s.append(int(read_run(r).n0.iloc[0]))
        if not bs:
            continue
        allb = np.vstack(bs)
        D = int(w.split("_D")[1])
        n = int(w.split("_n")[1].split("_")[0])
        init = np.vstack([b[0] for b in bs])
        row = {"workload": w, "n": n, "D": D, "ambient": w.split("_")[1], "seeds": len(bs),
               "states": len(allb)}
        for k in range(4):
            row[f"b{k}_min"] = int(allb[:, k].min())
            row[f"b{k}_max"] = int(allb[:, k].max())
            row[f"b{k}_init_mean"] = float(init[:, k].mean())
        row["bD_over_n_init"] = float(init[:, D].mean() / n)
        row["K0"] = K_by_instance.get(bs and [r for r in runs if r.workload == w][0].instance,
                                      (np.nan,))[0]
        w4rows.append(row)
        tag = inst_tag(w)
        for k in range(4):
            M.add(f"Num{tag}Beta{words(k)}Min", intc(row[f"b{k}_min"]),
                  f"{w}: min beta_{k} over all states of the 3 seeds", "aggregate.py (full-id betti)")
            M.add(f"Num{tag}Beta{words(k)}Max", intc(row[f"b{k}_max"]),
                  f"{w}: max beta_{k} over all states of the 3 seeds", "aggregate.py (full-id betti)")
        M.add(f"Num{tag}BetaDRatio", f"{row['bD_over_n_init']:.2f}",
              f"{w}: beta_D / n at INIT (mean of seeds)", "aggregate.py (full-id betti)")
    W4 = pd.DataFrame(w4rows)
    W4.to_csv(os.path.join(RES, "summary_w4_betti.csv"), index=False, float_format="%.6g")
    if len(W4):
        M.add("NumWFourBetaDRatioMin", f"{W4.bD_over_n_init.min():.1f}",
              "min over W4 instances of beta_D / n at INIT", "aggregate.py")
        M.add("NumWFourBetaDRatioMax", f"{W4.bD_over_n_init.max():.1f}",
              "max over W4 instances of beta_D / n at INIT", "aggregate.py")

    # ------------------------------------------------------- W1 closed holes --
    for w in sorted({r.workload for r in runs if r.workload.startswith("w1")}):
        cnt = []
        for r in runs:
            if r.workload == w and r.label == "full-id":
                b = read_betti_gz(r.betti)
                cnt.append(int((b[1:, 2] == 1).sum()))
        if cnt:
            M.add(f"Num{inst_tag(w)}ClosedStates", sig(np.mean(cnt), 3),
                  f"{w}: updates after which all holes are closed (beta_2 = 1), mean of seeds",
                  "aggregate.py (full-id betti)")

    # ----------------------------------------------------- correctness (E0) --
    corr_path = os.path.join(RES, "E0_correctness.csv")
    lcr_path = os.path.join(RES, "E0_lcr.csv")
    C = pd.read_csv(corr_path)
    if (C.status != "ok").any():
        if "--partial" not in sys.argv:
            raise SystemExit("E0_correctness.csv has failures; run verify.py and stop")
        print("WARNING: --partial: E0 has failures/incomplete coverage; numbers are provisional")
    C_t = C
    M.add("NumExactRuns", intc(len(C_t)), "runs of exact methods checked (E1-E7)", "verify.py")
    M.add("NumExactMismatches", intc(C_t.internal_mismatch.sum() + C_t.fullid_mismatch.sum() +
                                     C_t.expected_mismatch.sum() + C_t.gudhi_mismatch.sum()),
          "mismatching states of exact methods, all oracles", "verify.py")
    M.add("NumVerifiedStates", intc(C_t.fullid_states.sum()),
          "(run, state) pairs of exact methods compared with the engine full-id Betti file "
          "of the same instance", "verify.py")
    M.add("NumVerifiedStatesExpected", intc(C_t.expected_states.sum()),
          "(run, state) pairs compared with the analytic .expected.betti", "verify.py")
    M.add("NumVerifiedStatesGudhi", intc(C_t.gudhi_states.sum()),
          "(run, state) pairs compared with the GUDHI oracle", "verify.py")
    M.add("NumInternalChecks", intc(C_t.internal_verified.sum()),
          "internal full-id verifications (--verify-every 50 + last update) in exact runs",
          "verify.py")
    M.add("NumReportedStates", intc(C_t.betti_states.sum()),
          "Betti vectors reported by exact runs (INIT + updates)", "verify.py")
    L = pd.read_csv(lcr_path)
    lw = L.groupby("workload").agg(wrong=("wrong_updates", "sum"),
                                   ver=("verified_updates", "sum"),
                                   first=("first_wrong_t", "min"), K0=("K0", "mean"))
    lw["frac"] = lw.wrong / lw.ver
    for w, x in lw.iterrows():
        M.add(f"NumLcr{inst_tag(w)}ErrPct", pct(x.frac), f"lcr on {w}: % of updates with a wrong "
              f"Betti vector (3 seeds, --verify-every 1)", "configs/E0.json, verify.py")
        if not math.isnan(x["first"]):
            M.add(f"NumLcr{inst_tag(w)}FirstWrong", intc(x["first"]),
                  f"lcr on {w}: first wrong update (min over seeds)", "configs/E0.json, verify.py")
    M.add("NumLcrErrMax", pct(lw.frac.max()), "lcr: largest per-workload % of wrong updates",
          "verify.py")
    M.add("NumLcrErrMin", pct(lw.frac.min()), "lcr: smallest per-workload % of wrong updates",
          "verify.py")
    M.add("NumLcrErrAll", pct(lw.wrong.sum() / lw.ver.sum()),
          "lcr: % of wrong updates over all E0 lcr runs", "verify.py")
    M.add("NumLcrWorkloadsWrong", intc((lw.wrong > 0).sum()),
          "number of E0 lcr instances with at least one wrong update", "verify.py")
    M.add("NumLcrWorkloads", intc(len(lw)), "number of E0 lcr instances", "verify.py")
    smp = os.path.join(RES, "E0", "samples_crosscheck.csv")
    if os.path.exists(smp):
        X = pd.read_csv(smp)
        ex = X[X.method != "lcr"]
        M.add("NumSampleChecks", intc(ex.states.sum()), "sample cross-check: Betti vectors of "
              "exact configurations compared with GUDHI (all samples)", "crosscheck_samples.py")
        M.add("NumSampleMismatches", intc(ex.mismatch_vs_gudhi.sum() +
                                          ex.mismatch_vs_expected.sum()),
              "sample cross-check: mismatching states of exact configurations",
              "crosscheck_samples.py")
        lx = X[X.method == "lcr"]
        M.add("NumSampleLcrWrong", intc((lx.mismatch_vs_gudhi > 0).sum()),
              "samples on which lcr is wrong at least once", "crosscheck_samples.py")
        M.add("NumSamples", intc(len(lx)), "committed workload samples", "crosscheck_samples.py")

    # --------------------------------------------------------------- noise --
    npath = os.path.join(RES, "noise", "noise_runs.csv")
    if os.path.exists(npath):
        N = pd.read_csv(npath)
        for meth in N.method.unique():
            al = N[(N.method == meth) & (N.condition == "alone")]
            mt = METHOD_TAG[meth]
            cvm = al.median_us.std(ddof=1) / al.median_us.mean()
            cva = al.mean_us.std(ddof=1) / al.mean_us.mean()
            M.add(f"NumNoiseCV{mt}Med", pct(cvm), f"noise: CV (%) of the median per-update "
                  f"latency over {len(al)} identical runs of {meth} on {al.instance.iloc[0]}",
                  "noise.py")
            M.add(f"NumNoiseCV{mt}Amort", pct(cva), f"noise: CV (%) of the amortized latency "
                  f"over {len(al)} identical runs of {meth}", "noise.py")
            base_med = al.median_us.median()
            for cond, ctag in (("timed2", "TwoTimed"), ("loaded4", "FourBusy")):
                c = N[(N.method == meth) & (N.condition == cond)]
                if len(c):
                    M.add(f"NumNoise{mt}{ctag}Pct", f"{100 * (c.median_us.median() / base_med - 1):+.1f}",
                          f"noise: change (%) of the median latency of {meth} with "
                          f"{'one other timed run' if cond == 'timed2' else 'one timed + two GUDHI runs'}"
                          f" running concurrently, vs alone", "noise.py")
        M.add("NumNoiseReps", intc(len(N[(N.condition == "alone")]) // N.method.nunique()),
              "noise: identical repetitions per method", "noise.py")

    # ------------------------------------------------------------ protocol --
    timed = runs_df[runs_df.timed == 1]
    M.add("NumUpdates", "2{,}000", "T: updates per timed run", "configs/make_configs.py")
    M.add("NumPrefix", "200", "T': prefix of the gudhi baseline above 3e5 simplices",
          "configs/make_configs.py")
    M.add("NumSeeds", "3", "seeds per configuration", "configs/make_configs.py")
    M.add("NumGudhiFullLimit", "300{,}000", "gudhi runs all T updates iff |K_0| <= this",
          "configs/make_configs.py")
    g = timed[timed.method == "gudhi"]
    M.add("NumGudhiSizeMax", intc(g.K0.max()), "largest |K_0| at which gudhi is timed "
          "(on the prefix T')", "aggregate.py")
    M.add("NumGudhiFullSizeMax", intc(g[g["T"] >= 2000].K0.max()),
          "largest |K_0| at which gudhi is timed on all T updates", "aggregate.py")
    M.add("NumSizeMax", intc(timed.K0.max()), "largest |K_0| in a timed run", "aggregate.py")
    M.add("NumSizeMin", intc(timed.K0.min()), "smallest |K_0| in a timed run", "aggregate.py")
    M.add("NumTimedRuns", intc(len(timed)), "timed runs (E1-E7)", "aggregate.py")
    man = []
    for p in glob.glob(os.path.join(RES, "E*", "manifest.csv")):
        man.append(pd.read_csv(p))
    if man:
        mf = pd.concat(man)
        mf = mf[mf.exit == 0].drop_duplicates(["exp", "workload", "label", "seed"], keep="last")
        M.add("NumComputeHours", f"{mf.wall_s.sum() / 3600:.1f}",
              "CPU-hours of all runs (wall time of each single-threaded process, summed)",
              "run.py manifests")

    M.write(os.path.join(GEN, "numbers.tex"))
    write_tables(S, C, L, E8, W4, e7, runs_df)
    print(f"{len(runs)} runs, {len(S)} pooled rows, {len(M.items)} macros -> {GEN}")


# ---------------------------------------------------------------- tables ----
def mname(m):
    return f"\\method{{{m}}}"


def write_tables(S, C, L, E8, W4, e7, runs_df):
    # T1 correctness ---------------------------------------------------------
    lines = [r"\begin{tabular}{@{}lrrrrrr@{}}", r"\toprule",
             r"method & runs & states & vs.\ \method{full-id} & vs.\ analytic & vs.\ GUDHI "
             r"& mismatches \\", r"\midrule"]
    for m in METHOD_ORDER:
        c = C[C.method == m]
        if not len(c):
            continue
        mis = int(c.internal_mismatch.sum() + c.fullid_mismatch.sum() +
                  c.expected_mismatch.sum() + c.gudhi_mismatch.sum())
        lines.append(f"{mname(m)} & {intc(len(c))} & {intc(c.betti_states.sum())} & "
                     f"{intc(c.fullid_states.sum())} & {intc(c.expected_states.sum())} & "
                     f"{intc(c.gudhi_states.sum())} & {mis} \\\\")
    mis = int(C.internal_mismatch.sum() + C.fullid_mismatch.sum() + C.expected_mismatch.sum() +
              C.gudhi_mismatch.sum())
    lines += [r"\midrule",
              f"all exact & {intc(len(C))} & {intc(C.betti_states.sum())} & "
              f"{intc(C.fullid_states.sum())} & {intc(C.expected_states.sum())} & "
              f"{intc(C.gudhi_states.sum())} & {mis} \\\\", r"\midrule",
              r"\method{lcr} instance & runs & updates & wrong & \% wrong & first wrong & \\",
              r"\midrule"]
    lw = L.groupby("workload").agg(runs=("seed", "count"), ver=("verified_updates", "sum"),
                                   wrong=("wrong_updates", "sum"),
                                   first=("first_wrong_t", "min"), K0=("K0", "mean"))
    order = sorted(lw.index, key=lambda w: (w.split("_")[0], lw.loc[w, "K0"]))
    for w in order:
        x = lw.loc[w]
        first = intc(x["first"]) if not math.isnan(x["first"]) else "--"
        lines.append(f"{pretty_inst(w)} & {int(x.runs)} & {intc(x.ver)} & {intc(x.wrong)} & "
                     f"{pct(x.wrong / x.ver)} & {first} & \\\\")
    lines += [r"\bottomrule", r"\end{tabular}"]
    _write("tab_correctness.tex", lines)

    # T2 summary: largest instance of each family ----------------------------
    fam_pick = {
        "E5": ["w1_sphere_L7", "w1_torus_500"], "E1": ["w2_N33_s8"], "E3": ["w3_N27_k2"],
        "E4": ["w4_2d_n16000_D2", "w4_2d_n4000_D3", "w4_3d_n4000_D3"],
        "E6": ["w5a_L1000000", "w5b_L8"]}
    _write("tab_summary.tex", summary_table(S, fam_pick))
    full_pick = {}
    for e in ["E1", "E2", "E3", "E4", "E5", "E6"]:
        ws = S[S.exp == e].sort_values("K0").workload.unique().tolist()
        full_pick[e] = ws
    _write("tab_summary_full.tex", summary_table(S, full_pick, small=True))

    # E7 table ----------------------------------------------------------------
    lines = [r"\begin{tabular}{@{}llrrrrrrrrr@{}}", r"\toprule",
             r" & & \multicolumn{3}{c}{period off} & \multicolumn{3}{c}{period 256} & "
             r"\multicolumn{3}{c}{period 64} \\",
             r"\cmidrule(lr){3-5}\cmidrule(lr){6-8}\cmidrule(lr){9-11}",
             r"method & $\alpha$ & rb & amort. & p99 & rb & amort. & p99 & rb & amort. & p99 \\",
             r"\midrule"]
    for w in ["w2_N22_s8", "w3_N20_k2", "w4_2d_n16000_D2"]:
        sub = e7[e7.workload == w]
        if not len(sub):
            continue
        lines.append(f"\\multicolumn{{11}}{{@{{}}l}}{{\\emph{{{pretty_inst(w)}}} "
                     f"(latency in \\textmu s)}} \\\\")
        for meth in ("mmhm", "drb-id-rb"):
            for a in ["0.25", "0.5", "1", "2", "4", "off"]:
                cells = [mname(meth) if a == "0.25" else "", "off" if a == "off" else a]
                for p in ["off", "256", "64"]:
                    x = sub[(sub.method == meth) & (sub.alpha == a) & (sub.period == p)]
                    if len(x):
                        x = x.iloc[0]
                        cells += [sig(x.rebuilds, 2), sig(x.amort_us), sig(x.lat_p99_us)]
                    else:
                        cells += ["--", "--", "--"]
                lines.append(" & ".join(cells) + r" \\")
        lines.append(r"\midrule")
    lines[-1] = r"\bottomrule"
    lines.append(r"\end{tabular}")
    _write("tab_e7.tex", lines)

    # E8 table ----------------------------------------------------------------
    lines = [r"\begin{tabular}{@{}llrrrrrr@{}}", r"\toprule",
             r"instance & method & \multicolumn{2}{c}{additions / update} & "
             r"\multicolumn{2}{c}{footprint / update} & \multicolumn{2}{c}{$\nnz(R)+\nnz(V)$} \\",
             r"\cmidrule(lr){3-4}\cmidrule(lr){5-6}\cmidrule(lr){7-8}",
             r" & & median & p99 & median & p99 & after INIT & end \\", r"\midrule"]
    for w in ["w2_N22_s8", "w3_N20_k2", "w4_2d_n16000_D2", "w1_torus_256"]:
        sub = E8[E8.workload == w]
        for i, lab in enumerate(["drb-id", "drb-id-rb", "mmhm-norb", "mmhm"]):
            x = sub[sub.label == lab]
            if not len(x):
                continue
            x = x.iloc[0]
            lines.append(f"{pretty_inst(w) if i == 0 else ''} & {mname(lab)} & {sig(x.adds_med)} & "
                         f"{sig(x.adds_p99)} & {sig(x.fp_med)} & {sig(x.fp_p99)} & "
                         f"{sig(x.nnz0)} & {sig(x.nnz_end)} \\\\")
        lines.append(r"\midrule")
    lines[-1] = r"\bottomrule"
    lines.append(r"\end{tabular}")
    _write("tab_e8.tex", lines)

    # W4 Betti ranges ---------------------------------------------------------
    lines = [r"\begin{tabular}{@{}lrrrrrrr@{}}", r"\toprule",
             r"instance & $|K_0|$ & $\beta_0$ & $\beta_1$ & $\beta_2$ & $\beta_3$ & "
             r"$\beta_D/n$ at INIT \\", r"\midrule"]
    for _, x in (W4.sort_values(["ambient", "D", "n"]) if len(W4) else W4).iterrows():
        rng = []
        for k in range(4):
            lo, hi = x[f"b{k}_min"], x[f"b{k}_max"]
            rng.append(intc(lo) if lo == hi else f"{intc(lo)}--{intc(hi)}")
        lines.append(f"{pretty_inst(x.workload)} & {intc(x.K0)} & " + " & ".join(rng) +
                     f" & {x.bD_over_n_init:.2f} \\\\")
    lines += [r"\bottomrule", r"\end{tabular}"]
    _write("tab_w4_betti.tex", lines)


def summary_table(S, pick, small=False):
    lines = [r"\begin{tabular}{@{}lrrrrrr@{}}", r"\toprule",
             r"method & $T$ & median & p95 & p99 & amortized & $\times$ vs.\ \method{full-id} \\",
             r"\midrule"]
    first = True
    for e, ws in pick.items():
        for w in ws:
            sub = S[(S.exp == e) & (S.workload == w)]
            if not len(sub):
                continue
            if not first:
                lines.append(r"\midrule")
            first = False
            K0 = sub.K0.dropna().mean()
            lines.append(f"\\multicolumn{{7}}{{@{{}}l}}{{\\emph{{{pretty_inst(w)}}}, "
                         f"$|K_0| = {intc(K0)}$, {sig(sub.ops_mean.dropna().mean())} edits/update "
                         f"({e})}} \\\\")
            for m in METHOD_ORDER:
                x = sub[sub.label == m]
                if not len(x):
                    continue
                x = x.iloc[0]
                spd = "--" if m == "full-id" else sig(x.speedup_fullid)
                lines.append(f"{mname(m)} & {intc(x['T'])} & {sig(x.lat_med_us)} & "
                             f"{sig(x.lat_p95_us)} & {sig(x.lat_p99_us)} & {sig(x.amort_us)} & "
                             f"{spd} \\\\")
    lines += [r"\bottomrule", r"\end{tabular}"]
    return lines


def _write(name, lines):
    with open(os.path.join(GEN, name), "w", encoding="utf-8") as fh:
        fh.write("% Generated by experiments/aggregate.py -- do not edit.\n")
        fh.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
