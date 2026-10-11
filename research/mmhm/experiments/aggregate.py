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
  results/summary_drift.csv    per-block (200 updates) medians/means, speedups
  results/summary_build.csv    INIT build: nnz(R)+nnz(V) and additions per order
  results/summary_noise.csv    run-to-run noise (results/noise/*), W5a repetitions
  results/summary_coverage.csv E0 coverage by number of references
  ../paper/generated/numbers.tex and tab_*.tex (booktabs tabulars)

Statistics: latency is the engine's per-update `time_ns` (t >= 1; rebuilds
included in the update that triggers them). Per (exp, workload, method) the
updates of all seeds are pooled: median, quartiles, p95, p99 of the pooled
per-update latencies; amortized = total time / number of updates (incl.
rebuilds). Speedups are ratios of amortized latencies over the SAME updates:
vs full-id both cover all T updates; vs gudhi, which ran only the prefix
T' = 200 above 3e5 simplices, the other method's amortized latency is taken
over the same first T' updates (`speedup_gudhi`; the earlier, unmatched ratio
"gudhi prefix mean / full-run mean" is kept as `speedup_gudhi_unmatched`).
Per-update cost does drift during a run for some methods (e.g. full-id on W3,
whose insertion order degrades as refilled cells get late keys; the DRB
methods warm up during their first updates): results/summary_drift.csv gives
medians and means per block of 200 updates.

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
def configured_runs():
    runs = []
    for cfg in sorted(glob.glob(os.path.join(HERE, "configs", "E*.json"))):
        _, rs = runner.load_runs(cfg)
        runs += rs
    return runs


def load_all_runs():
    return [r for r in configured_runs() if r.done()]


def write_not_run():
    """results/NOT_RUN.csv: every configured run without results, with the reason
    recorded by run.py (timeout, not launched before the deadline, exit code)."""
    status = {}
    for path in glob.glob(os.path.join(RES, "*", "manifest.csv")):
        with open(path, encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                k = f"{row['exp']}/{row['workload']}__{row['label']}__seed{row['seed']}"
                status[k] = row
    rows = []
    for r in configured_runs():
        if r.done():
            continue
        st = status.get(r.key)
        if st is None:
            reason = "not run"
        elif st["exit"] == "timeout":
            reason = f"timeout: {st['stderr_tail']}"
        elif st["exit"] == "not-launched":
            reason = f"not launched: {st['stderr_tail']}"
        else:
            reason = f"exit {st['exit']}: {st['stderr_tail']}"
        rows.append({"exp": r.exp, "instance": r.instance, "workload": r.workload,
                     "method": r.label, "seed": r.seed, "reason": reason})
    with open(os.path.join(RES, "NOT_RUN.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["exp", "instance", "workload", "method", "seed",
                                           "reason"])
        w.writeheader()
        w.writerows(rows)
    return pd.DataFrame(rows, columns=["exp", "instance", "workload", "method", "seed", "reason"])


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
         "init_ms": float(np.median([x["init_ms"] for x in rows])),
         "p99_seed_min_us": min(x["lat_p99_us"] for x in rows),
         "p99_seed_max_us": max(x["lat_p99_us"] for x in rows),
         "amort_first200_us": float(np.concatenate([l[:200] for l in lats]).mean())}
    # blocks of 200 updates (drift): pooled median and mean per block
    nb = min(len(l) for l in lats) // 200
    for b in range(nb):
        blk = np.concatenate([l[200 * b:200 * (b + 1)] for l in lats])
        p[f"blk{b + 1}_med_us"] = float(np.median(blk))
        p[f"blk{b + 1}_mean_us"] = float(blk.mean())
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
    NR = write_not_run()
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
    # speedups vs full-id and gudhi of the same (exp, workload); the gudhi
    # ratio here is the unmatched one (gudhi prefix mean / full-run mean)
    for col, ref in (("speedup_fullid", "full-id"), ("speedup_gudhi_unmatched", "gudhi")):
        refs = S[S.label == ref].set_index(["exp", "workload"]).amort_us
        S[col] = [refs.get((e, w), np.nan) / a for e, w, a in zip(S.exp, S.workload, S.amort_us)]
        refm = S[S.label == ref].set_index(["exp", "workload"]).lat_med_us
        S[col + "_med"] = [refm.get((e, w), np.nan) / a
                           for e, w, a in zip(S.exp, S.workload, S.lat_med_us)]
    # matched-prefix gudhi speedup: both methods over the same first T_gudhi updates
    gT = S[S.label == "gudhi"].set_index(["exp", "workload"])
    sg = []
    for e, w, a, a200 in zip(S.exp, S.workload, S.amort_us, S.amort_first200_us):
        if (e, w) not in gT.index:
            sg.append(np.nan)
            continue
        g = gT.loc[(e, w)]
        sg.append(g.amort_us / (a if int(g["T"]) >= 2000 else a200))
    S["speedup_gudhi"] = sg
    # speedups vs full-id on matched windows: first and last block of 200 updates
    for b, name in ((1, "first"), (10, "last")):
        col = f"blk{b}_mean_us"
        if col in S:
            ref = S[S.label == "full-id"].set_index(["exp", "workload"])[col]
            S[f"speedup_fullid_{name}200"] = [ref.get((e, w), np.nan) / v
                                             for e, w, v in zip(S.exp, S.workload, S[col])]
    S["drift_med"] = S.get("blk10_med_us", np.nan) / S["blk1_med_us"]
    S["drift_mean"] = S.get("blk10_mean_us", np.nan) / S["blk1_mean_us"]
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
                  f"{what}: amortized latency of gudhi / this method, both over the same "
                  f"updates (the first {intc(min(row['T'], 2000))} or gudhi's prefix T')", src)
            M.add(pre + "SpeedupGudhiUnmatched", sig(row.speedup_gudhi_unmatched),
                  f"{what}: OLD definition, gudhi amortized on its prefix / this method over "
                  f"all T updates (biased where T' < T; do not use for claims)", src)
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

    # ------------------------------------------- effect of a rebuild (E7) ----
    # Same update sequence with and without rebuilds: additions performed by the
    # rebuilding method in the 100 non-rebuild updates after each of its
    # rebuilds, divided by the additions of its never-rebuilding twin on the
    # same updates (> 1: the rebuild made the following updates more expensive).
    twins = [("mmhm", "mmhm-norb"), ("drb-id-rb", "drb-id")]
    eff = []
    for r in runs:
        if r.exp not in ("E1", "E3", "E4", "E5") or r.label not in ("mmhm", "drb-id-rb"):
            continue
        twin = dict(twins)[r.label]
        tw = [o for o in runs if o.exp == r.exp and o.workload == r.workload and
              o.label == twin and o.seed == r.seed]
        if not tw:
            continue
        a, b = read_run(r), read_run(tw[0])
        ts = a[a.rebuild == 1].t.to_numpy()
        if not len(ts):
            continue
        win_a = win_b = 0
        tw_a = tw_b = 0
        nwin = 0
        bt = b.time_ns.to_numpy()
        for t0 in ts:
            m = ((a.t > t0) & (a.t <= t0 + 100) & (a.rebuild == 0)).to_numpy()
            win_a += int(a.chain_adds[m].sum())
            win_b += int(b.chain_adds.to_numpy()[m].sum())
            tw_a += int(a.time_ns[m].sum())
            tw_b += int(bt[m].sum())
            nwin += int(m.sum())
        m = ((a.t > ts[0]) & (a.rebuild == 0)).to_numpy()
        m_all = (a.t > ts[0]).to_numpy()  # incl. the rebuild updates themselves
        eff.append({"exp": r.exp, "workload": r.workload, "method": r.label, "twin": twin,
                    "seed": r.seed, "rebuilds": len(ts), "window_updates": nwin,
                    "adds_window": win_a, "adds_window_twin": win_b,
                    "time_window_ns": tw_a, "time_window_twin_ns": tw_b,
                    "adds_after_first": int(a.chain_adds[m].sum()),
                    "adds_after_first_twin": int(b.chain_adds.to_numpy()[m].sum()),
                    "time_after_first_ns": int(a.time_ns[m].sum()),
                    "time_after_first_twin_ns": int(bt[m].sum()),
                    "time_after_first_incl_rebuilds_ns": int(a.time_ns[m_all].sum()),
                    "time_after_first_incl_twin_ns": int(bt[m_all].sum())})
    EF = pd.DataFrame(eff)
    if len(EF):
        EG = EF.groupby(["exp", "workload", "method", "twin"]).sum(numeric_only=True).reset_index()
        EG["ratio_window"] = EG.adds_window / EG.adds_window_twin
        EG["ratio_after_first"] = EG.adds_after_first / EG.adds_after_first_twin
        EG["time_ratio_window"] = EG.time_window_ns / EG.time_window_twin_ns
        EG["time_ratio_after_first"] = EG.time_after_first_ns / EG.time_after_first_twin_ns
        EG["time_ratio_after_first_incl_rebuilds"] = (EG.time_after_first_incl_rebuilds_ns /
                                                      EG.time_after_first_incl_twin_ns)
        EG = EG.drop(columns=["seed"])
        EG.to_csv(os.path.join(RES, "summary_rebuild_effect.csv"), index=False,
                  float_format="%.6g")
        # table: amortized latency of the four DRB methods, rebuilds, and the effect ratio
        lines = [r"\begin{tabular}{@{}lrrrrrrrrrrrr@{}}", r"\toprule",
                 r" & \multicolumn{4}{c}{amortized latency (\textmu s)} & "
                 r"\multicolumn{2}{c}{rebuilds / run} & "
                 r"\multicolumn{2}{c}{100 updates after each} & "
                 r"\multicolumn{4}{c}{all updates after the first rebuild} \\",
                 r"\cmidrule(lr){2-5}\cmidrule(lr){6-7}\cmidrule(lr){8-9}\cmidrule(lr){10-13}",
                 r" & & & & & & & adds & adds & adds & time & adds & time \\",
                 r"instance & \method{drb-id} & \method{drb-id-rb} & \method{mmhm-norb} & "
                 r"\method{mmhm} & \method{drb-id-rb} & \method{mmhm} & "
                 r"\multicolumn{1}{c}{rb/id} & \multicolumn{1}{c}{m/norb} & "
                 r"\multicolumn{2}{c}{\method{drb-id-rb}/\method{drb-id}} & "
                 r"\multicolumn{2}{c}{\method{mmhm}/\method{mmhm-norb}} \\", r"\midrule"]
        kk = {w: S[S.workload == w].K0.dropna().mean() for w in EG.workload.unique()}
        order = sorted(EG.groupby(["exp", "workload"]).groups,
                       key=lambda ew: (ew[0], ew[1].split("_")[1], kk[ew[1]]))
        for (e, w) in order:
            g = EG[(EG.exp == e) & (EG.workload == w)]
            amo = S[(S.exp == e) & (S.workload == w)].set_index("label")
            K0 = amo.K0.dropna().mean()
            def gv(m, col):
                x = g[g.method == m]
                return x[col].iloc[0] if len(x) else float("nan")
            cells = [pretty_inst(w)] + [sig(amo.amort_us.get(m, float("nan")))
                                        for m in ("drb-id", "drb-id-rb", "mmhm-norb", "mmhm")]
            cells += [sig(amo.rebuilds.get(m, float("nan")), 2) for m in ("drb-id-rb", "mmhm")]
            cells += [f"{gv(m, 'ratio_window'):.2f}" for m in ("drb-id-rb", "mmhm")]
            for m in ("drb-id-rb", "mmhm"):
                cells += [f"{gv(m, 'ratio_after_first'):.2f}",
                          f"{gv(m, 'time_ratio_after_first'):.2f}"]
            lines.append(" & ".join(cells) + r" \\")
        lines += [r"\bottomrule", r"\end{tabular}"]
        _write("tab_rebuild_effect.tex", lines)
        for _, x in EG.iterrows():
            pre = f"NumRebuildEffect{inst_tag(x.workload)}{METHOD_TAG[x.method]}"
            M.add(pre + "Window", f"{x.ratio_window:.2f}",
                  f"{x.workload}: additions of {x.method} in the 100 non-rebuild updates after "
                  f"each of its rebuilds / additions of {x.twin} on the same updates (3 seeds "
                  f"pooled; >1 = the rebuild made later updates costlier)", "aggregate.py")
            M.add(pre + "WindowTime", f"{x.time_ratio_window:.2f}",
                  f"{x.workload}: time of {x.method} in the 100 non-rebuild updates after each "
                  f"of its rebuilds / time of {x.twin} on the same updates", "aggregate.py")
            M.add(pre + "AfterFirstTime", f"{x.time_ratio_after_first:.2f}",
                  f"{x.workload}: time of {x.method} in all non-rebuild updates after its first "
                  f"rebuild / {x.twin} on the same updates", "aggregate.py")
            M.add(pre + "AfterFirstTimeInclRebuilds", f"{x.time_ratio_after_first_incl_rebuilds:.2f}",
                  f"{x.workload}: time of {x.method} in all updates after its first rebuild, "
                  f"rebuild updates included / {x.twin} on the same updates", "aggregate.py")
            M.add(pre + "AfterFirst", f"{x.ratio_after_first:.2f}",
                  f"{x.workload}: additions of {x.method} in all non-rebuild updates after its "
                  f"first rebuild / {x.twin} on the same updates", "aggregate.py")

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
        row["K0"] = float(np.mean([K_by_instance[r.instance][0] for r in runs
                                   if r.workload == w and r.label == "full-id"
                                   and r.instance in K_by_instance]))  # mean of seeds
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
    T_, nseeds, Tp, glim = protocol_from_configs()
    M.add("NumUpdates", intc(T_), "T: updates per timed run", "configs/E*.json")
    M.add("NumPrefix", intc(Tp), "T': prefix of the gudhi baseline above the limit below",
          "configs/E*.json")
    M.add("NumSeeds", intc(nseeds), "seeds per configuration", "configs/E*.json")
    M.add("NumGudhiFullLimit", intc(glim), "gudhi runs all T updates iff |K_0| <= this",
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

    M.add("NumNotRun", intc(len(NR)), "configured runs without results (results/NOT_RUN.csv)",
          "aggregate.py")
    M.add("NumConfiguredRuns", intc(len(configured_runs())), "configured runs (configs/E*.json)",
          "aggregate.py")
    review_extras(M, runs, S, runs_df, C, L, e7)
    M.write(os.path.join(GEN, "numbers.tex"))
    write_tables(S, C, L, E8, W4, e7, runs_df, NR)
    print(f"{len(runs)} runs, {len(S)} pooled rows, {len(M.items)} macros -> {GEN}")


# ---------------------------------------------------------------- tables ----
def mname(m):
    return f"\\method{{{m}}}"


def write_tables(S, C, L, E8, W4, e7, runs_df, NR):
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
        fid = "(ref.)" if m == "full-id" and c.fullid_states.sum() == 0 else \
            intc(c.fullid_states.sum())
        gud = "(ref.)" if m == "gudhi" else intc(c.gudhi_states.sum())
        lines.append(f"{mname(m)} & {intc(len(c))} & {intc(c.betti_states.sum())} & "
                     f"{fid} & {intc(c.expected_states.sum())} & "
                     f"{gud} & {mis} \\\\")
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
    order = sorted(lw.index)
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
        }
    _write("tab_summary.tex", summary_table(S, fam_pick, NR=NR))
    full_pick = {}
    for e in ["E1", "E2", "E3", "E4", "E5", "E6"]:
        sub = S[S.exp == e].groupby("workload").K0.mean().sort_values()
        ws = sorted(sub.index, key=lambda w: (w.split("_")[0], w.split("_")[1] if e in
                                              ("E4", "E5") else "", sub[w]))
        if e == "E2":
            ws = sorted(sub.index, key=lambda w: int(w.split("_s")[1]))
        full_pick[e] = ws
    _write("tab_summary_full.tex", wide_table(S, full_pick, "amort_us", NR=NR))
    _write("tab_summary_full_med.tex", wide_table(S, full_pick, "lat_med_us", NR=NR))
    _write("tab_summary_full_p99.tex", wide_table(S, full_pick, "lat_p99_us", NR=NR))

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


def summary_table(S, pick, small=False, NR=None):
    """Long format, one row per (instance, method); the instance and |K_0| are
    printed on the first row of their group."""
    lines = [r"\begin{tabular}{@{}llrlrrrrr@{}}", r"\toprule",
             r"instance & & $|K_0|$ & method & $T$ & median & p95 & amortized & "
             r"$\times$ \method{full-id} \\", r"\midrule"]
    first = True
    for e, ws in pick.items():
        for w in ws:
            sub = S[(S.exp == e) & (S.workload == w)]
            if not len(sub):
                continue
            if not first:
                lines.append(r"\addlinespace")
            first = False
            K0 = sub.K0.dropna().mean()
            missing = set() if NR is None else set(NR[(NR.exp == e) & (NR.workload == w)].method)
            head = True
            for m in METHOD_ORDER:
                x = sub[sub.label == m]
                lead = (f"{pretty_inst(w)} & ({e}) & {intc(K0)}" if head else " & & ")
                if not len(x):
                    if m in missing:  # configured but no seed finished: say so
                        lines.append(f"{lead} & {mname(m)} & \\multicolumn{{5}}{{l}}{{not run "
                                     f"(see NOT\\_RUN.csv)}} \\\\")
                        head = False
                    continue
                head = False
                x = x.iloc[0]
                spd = "--" if m == "full-id" else sig(x.speedup_fullid)
                mark = "" if int(x.seeds) >= 3 else f"$^{{{int(x.seeds)}\\,\\mathrm{{seed}}}}$"
                lines.append(f"{lead} & {mname(m)}{mark} & {intc(x['T'])} & {sig(x.lat_med_us)} & "
                             f"{sig(x.lat_p95_us)} & {sig(x.amort_us)} & {spd} \\\\")
    lines += [r"\bottomrule", r"\end{tabular}"]
    return lines


def wide_table(S, pick, col, NR=None):
    """One row per instance, one column per method; cell = S[col] (us). A
    configured but missing entry prints 'n/r'; T' prefixes are marked."""
    meths = METHOD_ORDER
    lines = [r"\begin{tabular}{@{}llr" + "r" * len(meths) + r"@{}}", r"\toprule",
             r"exp. & instance & $|K_0|$ & " + " & ".join(mname(m) for m in meths) + r" \\",
             r"\midrule"]
    first = True
    for e, ws in pick.items():
        if not first:
            lines.append(r"\midrule")
        first = False
        for w in ws:
            sub = S[(S.exp == e) & (S.workload == w)].set_index("label")
            if not len(sub):
                continue
            missing = set() if NR is None else set(NR[(NR.exp == e) & (NR.workload == w)].method)
            cells = [e, pretty_inst(w), intc(sub.K0.dropna().mean())]
            for m in meths:
                if m in sub.index:
                    v = sig(sub.loc[m, col])
                    if int(sub.loc[m, "T"]) < 2000:
                        v += r"$^{\prime}$"
                    if int(sub.loc[m, "seeds"]) < 3:
                        v += f"$^{{{int(sub.loc[m, 'seeds'])}}}$"
                    cells.append(v)
                else:
                    cells.append("n/r" if m in missing else "")
            lines.append(" & ".join(cells) + r" \\")
    lines += [r"\bottomrule", r"\end{tabular}"]
    return lines


def _write(name, lines):
    with open(os.path.join(GEN, name), "w", encoding="utf-8") as fh:
        fh.write("% Generated by experiments/aggregate.py -- do not edit.\n")
        fh.write("\n".join(lines) + "\n")




# ------------------------------------------------------- review round ----
FAMILY = {"w1": "WOne", "w2": "WTwo", "w3": "WThree", "w4": "WFour", "w5a": "WFive",
          "w5b": "WFive"}
FAMILY_NAME = {"WOne": "W1 surfaces", "WTwo": "W2 refine/coarsen", "WThree": "W3 cavities",
               "WFour": "W4 flag complexes", "WFive": "W5 witnesses"}


def _rate(a, b):
    return float(a) / float(b) if b else float("nan")


def raw_csv(path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return pd.read_csv(fh)


def review_extras(M, runs, S, runs_df, C, L, e7):
    """Numbers requested by the referee report (paper/REVIEW.md); see
    paper/response/data.md for the mapping item -> macro/table."""
    base = S[S.exp.isin(["E1", "E2", "E3", "E4", "E5", "E6"])]
    # E2 reuses E1's N = 22, s = 8 rows: keep one row per (instance, method)
    base = base.drop_duplicates(["workload", "label"], keep="first")
    # ---- per (instance, method): seed ranges, drift, p99 ratio, memory proxy
    seen = set()
    for _, row in base.iterrows():
        key = (row.workload, row.label)
        if key in seen:
            continue
        seen.add(key)
        tag, mt = inst_tag(row.workload), METHOD_TAG[row.method]
        pre, what, src = f"Num{tag}{mt}", f"{row.workload} / {row.label}", "aggregate.py"
        M.add(pre + "AmortSeedMin", sig(row.amort_seed_min_us), f"{what}: smallest per-seed "
              f"amortized latency (us)", src)
        M.add(pre + "AmortSeedMax", sig(row.amort_seed_max_us), f"{what}: largest per-seed "
              f"amortized latency (us)", src)
        M.add(pre + "MedSeedMin", sig(row.med_seed_min_us), f"{what}: smallest per-seed median "
              f"latency (us)", src)
        M.add(pre + "MedSeedMax", sig(row.med_seed_max_us), f"{what}: largest per-seed median "
              f"latency (us)", src)
        M.add(pre + "PNinetyNineSeedMin", sig(row.p99_seed_min_us), f"{what}: smallest per-seed "
              f"p99 latency (us)", src)
        M.add(pre + "PNinetyNineSeedMax", sig(row.p99_seed_max_us), f"{what}: largest per-seed "
              f"p99 latency (us)", src)
        fid = base[(base.workload == row.workload) & (base.label == "full-id")]
        if row.label != "full-id" and len(fid):
            f = fid.iloc[0]
            M.add(pre + "PNinetyNineOverFullId", sig(row.lat_p99_us / f.lat_p99_us),
                  f"{what}: pooled p99 latency / pooled p99 of full-id (>1: worse tail)", src)
        if "blk1_med_us" in row and not math.isnan(row.blk1_med_us):
            M.add(pre + "FirstBlockMed", sig(row.blk1_med_us), f"{what}: median latency over "
                  f"updates 1-200 (3 seeds pooled, us)", src)
            if not math.isnan(row.get("blk10_med_us", float("nan"))):
                M.add(pre + "LastBlockMed", sig(row.blk10_med_us), f"{what}: median latency "
                      f"over updates 1801-2000 (us)", src)
                M.add(pre + "DriftMed", f"{row.drift_med:.2f}", f"{what}: median of the last "
                      f"200 updates / median of the first 200 (drift; 1 = none)", src)
                M.add(pre + "DriftMean", f"{row.drift_mean:.2f}", f"{what}: mean of the last "
                      f"200 updates / mean of the first 200", src)
            if row.label != "full-id" and not math.isnan(row.get("speedup_fullid_first200",
                                                                 float("nan"))):
                M.add(pre + "SpeedupFullIdFirstBlock", sig(row.speedup_fullid_first200),
                      f"{what}: full-id / this method, amortized over updates 1-200 only", src)
                if not math.isnan(row.get("speedup_fullid_last200", float("nan"))):
                    M.add(pre + "SpeedupFullIdLastBlock", sig(row.speedup_fullid_last200),
                          f"{what}: full-id / this method, amortized over updates 1801-2000", src)
        if row.method in ("full-id", "full-morse"):
            M.add(pre + "Adds", sig(row.adds_mean), f"{what}: mean column additions per "
                  f"recomputation (per update)", src)
        if row.method in DYN and row.K0:
            M.add(pre + "NnzPerSimplex", f"{row.nnz_max / row.K0:.2f}", f"{what}: max "
                  f"nnz(R)+nnz(V) over the run / |K_0| (memory proxy, entries per simplex)", src)
    # ---- DRB variants side by side (review M2) and pairwise noise overlap (M8)
    pairs = []
    done_w = set()
    for (e, w), g in base.groupby(["exp", "workload"], sort=False):
        if w in done_w:
            continue
        done_w.add(w)
        tag = inst_tag(w)
        d = g[g.label.isin(DYN)].set_index("label")
        if len(d) == 4:
            M.add(f"Num{tag}DrbSpeedupFullIdMin", sig(d.speedup_fullid.min()),
                  f"{w}: smallest amortized speedup over full-id among the 4 DRB variants",
                  "aggregate.py")
            M.add(f"Num{tag}DrbSpeedupFullIdMax", sig(d.speedup_fullid.max()),
                  f"{w}: largest amortized speedup over full-id among the 4 DRB variants",
                  "aggregate.py")
            best = d.amort_us.idxmin()
            M.add(f"Num{tag}BestDrb", f"\\method{{{best}}}", f"{w}: DRB variant with the "
                  f"lowest pooled amortized latency", "aggregate.py")
            o = d.drop(index=best)
            second = o.amort_us.idxmin()
            within = d.loc[best, "amort_seed_max_us"] >= d.loc[second, "amort_seed_min_us"]
            M.add(f"Num{tag}BestDrbWithinNoise", "yes" if within else "no",
                  f"{w}: do the per-seed amortized ranges of the best and second-best DRB "
                  f"variants overlap? (yes = ordering within seed noise)", "aggregate.py")
        gi = g.set_index("label")
        labs = [m for m in METHOD_ORDER if m in gi.index]
        for i, a in enumerate(labs):
            for b in labs[i + 1:]:
                A, B = gi.loc[a], gi.loc[b]
                pairs.append({
                    "exp": e, "workload": w, "a": a, "b": b,
                    "amort_ratio_a_over_b": A.amort_us / B.amort_us,
                    "amort_a_seed_min": A.amort_seed_min_us, "amort_a_seed_max": A.amort_seed_max_us,
                    "amort_b_seed_min": B.amort_seed_min_us, "amort_b_seed_max": B.amort_seed_max_us,
                    "amort_overlap": bool(max(A.amort_seed_min_us, B.amort_seed_min_us) <=
                                          min(A.amort_seed_max_us, B.amort_seed_max_us)),
                    "p99_ratio_a_over_b": A.lat_p99_us / B.lat_p99_us,
                    "p99_a_seed_min": A.p99_seed_min_us, "p99_a_seed_max": A.p99_seed_max_us,
                    "p99_b_seed_min": B.p99_seed_min_us, "p99_b_seed_max": B.p99_seed_max_us,
                    "p99_overlap": bool(max(A.p99_seed_min_us, B.p99_seed_min_us) <=
                                        min(A.p99_seed_max_us, B.p99_seed_max_us)),
                    "med_ratio_a_over_b": A.lat_med_us / B.lat_med_us,
                    "med_overlap": bool(max(A.med_seed_min_us, B.med_seed_min_us) <=
                                        min(A.med_seed_max_us, B.med_seed_max_us))})
    P = pd.DataFrame(pairs)
    P.to_csv(os.path.join(RES, "summary_pairs.csv"), index=False, float_format="%.6g")
    order_w = []
    for e in ["E1", "E2", "E3", "E4", "E5", "E6"]:
        for w in base[base.exp == e].sort_values("K0").workload.unique():
            if w not in [x[1] for x in order_w]:
                order_w.append((e, w))
    for col, name, unit in (("amort", "tab_seed_ranges.tex", "amortized"),
                            ("p99", "tab_seed_ranges_p99.tex", "p99")):
        meths = ["full-id", "drb-id", "drb-id-rb", "mmhm-norb", "mmhm"]
        lines = [r"\begin{tabular}{@{}llrrrrr@{}}", r"\toprule",
                 f"exp. & instance & " + " & ".join(mname(m) for m in meths) + r" \\",
                 r"\midrule"]
        last_e = None
        for e, w in order_w:
            g = base[base.workload == w].set_index("label")
            if last_e is not None and e != last_e:
                lines.append(r"\midrule")
            last_e = e
            cells = [e, pretty_inst(w)]
            for m in meths:
                if m in g.index:
                    lo = g.loc[m, "amort_seed_min_us" if col == "amort" else "p99_seed_min_us"]
                    hi = g.loc[m, "amort_seed_max_us" if col == "amort" else "p99_seed_max_us"]
                    cells.append(f"{sig(lo)}--{sig(hi)}")
                else:
                    cells.append("")
            lines.append(" & ".join(cells) + r" \\")
        lines += [r"\bottomrule", r"\end{tabular}"]
        _write(name, lines)
    # ---- drift table (review M4)
    lines = [r"\begin{tabular}{@{}llrrrrrrrr@{}}", r"\toprule",
             r" & & \multicolumn{3}{c}{\method{full-id} median (\textmu s)} & "
             r"\multicolumn{3}{c}{last/first block median} & "
             r"\multicolumn{2}{c}{\method{mmhm} $\times$ \method{full-id}} \\",
             r"\cmidrule(lr){3-5}\cmidrule(lr){6-8}\cmidrule(lr){9-10}",
             r"exp. & instance & first 200 & last 200 & ratio & \method{full-morse} & "
             r"\method{drb-id} & \method{mmhm} & first 200 & last 200 \\", r"\midrule"]
    last_e = None
    for e, w in order_w:
        g = base[base.workload == w].set_index("label")
        if "full-id" not in g.index or "blk10_med_us" not in g.columns:
            continue
        if last_e is not None and e != last_e:
            lines.append(r"\midrule")
        last_e = e
        f = g.loc["full-id"]

        def dr(m):
            return f"{g.loc[m, 'drift_med']:.2f}" if m in g.index else ""

        def sp(m, k):
            return sig(g.loc[m, f"speedup_fullid_{k}200"]) if m in g.index else ""
        lines.append(f"{e} & {pretty_inst(w)} & {sig(f.blk1_med_us)} & {sig(f.blk10_med_us)} & "
                     f"{f.drift_med:.2f} & {dr('full-morse')} & {dr('drb-id')} & {dr('mmhm')} & "
                     f"{sp('mmhm', 'first')} & {sp('mmhm', 'last')} \\\\")
    lines += [r"\bottomrule", r"\end{tabular}"]
    _write("tab_drift.tex", lines)
    dcols = ["exp", "workload", "label", "seeds"] + [c for c in base.columns if
                                                     c.startswith("blk") or c.startswith("drift")
                                                     or c.startswith("speedup_fullid_")]
    base[dcols].to_csv(os.path.join(RES, "summary_drift.csv"), index=False, float_format="%.6g")
    big = base[(base.label == "full-id") & (base.drift_med > 1.25)]
    M.add("NumDriftFullIdInstances", intc(len(big)), "instances (E1-E6) on which the full-id "
          "median of the last 200 updates exceeds that of the first 200 by > 25%", "aggregate.py")
    M.add("NumDriftFullIdList", ", ".join(pretty_inst(w) for w in big.workload) or "none",
          "those instances", "aggregate.py")
    # ---- INIT build: Morse vs insertion order (review M3)
    rb = runs_df[runs_df.exp.isin(["E1", "E2", "E3", "E4", "E5", "E6"]) &
                 runs_df.label.isin(["drb-id", "mmhm-norb", "full-id", "full-morse"])]
    rb = rb.drop_duplicates(["workload", "label", "seed"])
    B = rb.groupby(["workload", "label"]).agg(nnz0=("nnz0", "mean"),
                                              build_adds=("build_adds", "mean"),
                                              K0=("K0", "mean")).reset_index()
    B.to_csv(os.path.join(RES, "summary_build.csv"), index=False, float_format="%.6g")
    lines = [r"\begin{tabular}{@{}llrrrrrrr@{}}", r"\toprule",
             r" & & & \multicolumn{3}{c}{$\nnz(R)+\nnz(V)$ after INIT} & "
             r"\multicolumn{3}{c}{additions of the INIT build} \\",
             r"\cmidrule(lr){4-6}\cmidrule(lr){7-9}",
             r"exp. & instance & $|K_0|$ & insertion & Morse & ratio & insertion & Morse & "
             r"ratio \\", r"\midrule"]
    last_e = None
    for e, w in order_w:
        g = B[B.workload == w].set_index("label")
        if "drb-id" not in g.index or "mmhm-norb" not in g.index:
            continue
        if last_e is not None and e != last_e:
            lines.append(r"\midrule")
        last_e = e
        a, m = g.loc["drb-id"], g.loc["mmhm-norb"]
        tag = inst_tag(w)
        ra = _rate(m.build_adds, a.build_adds)
        M.add(f"Num{tag}DrbIdBuildAdds", intc(a.build_adds), f"{w}: additions of the INIT build "
              f"in insertion order (drb-id, mean of seeds)", "aggregate.py")
        M.add(f"Num{tag}MmhmNorbBuildAdds", intc(m.build_adds), f"{w}: additions of the INIT "
              f"build in Morse order (mmhm-norb, mean of seeds)", "aggregate.py")
        M.add(f"Num{tag}BuildAddsMorseOverId", "--" if math.isnan(ra) else f"{ra:.2f}",
              f"{w}: INIT build additions Morse / insertion order", "aggregate.py")
        M.add(f"Num{tag}NnzInitMorseOverId", f"{m.nnz0 / a.nnz0:.3f}",
              f"{w}: nnz(R)+nnz(V) after INIT, Morse / insertion order", "aggregate.py")
        lines.append(f"{e} & {pretty_inst(w)} & {intc(a.K0)} & {intc(a.nnz0)} & {intc(m.nnz0)} & "
                     f"{m.nnz0 / a.nnz0:.3f} & {intc(a.build_adds)} & {intc(m.build_adds)} & "
                     f"{'--' if math.isnan(ra) else f'{ra:.2f}'} \\\\")
    lines += [r"\bottomrule", r"\end{tabular}"]
    _write("tab_build.tex", lines)
    # ---- verification coverage (review B2)
    C = C.copy()
    C["family"] = [FAMILY[w.split("_")[0]] for w in C.workload]
    cov_rows = []
    for fam, g in list(C.groupby("family")) + [("all", C)]:
        n = g.betti_states.sum()
        r = {"family": fam, "runs": len(g), "vectors": int(n), "ge1": int(g.cov_ge1.sum()),
             "ge2": int(g.cov_ge2.sum()), "all3": int(g.cov_all3.sum()),
             "external": int(g.cov_external.sum()),
             "engine_only": int((g.cov_ge1 - g.cov_external).sum())}
        cov_rows.append(r)
        p = "NumCoverage" + ("" if fam == "all" else fam)
        what = "all exact runs" if fam == "all" else FAMILY_NAME[fam]
        for k, lab in (("ge1", "GeOne"), ("ge2", "GeTwo"), ("all3", "AllThree"),
                       ("external", "External"), ("engine_only", "EngineOnly")):
            M.add(p + lab, intc(r[k]), f"{what}: reported Betti vectors checked against "
                  f"{ {'ge1': '>= 1 reference', 'ge2': '>= 2 references', 'all3': 'all three references (engine full-id file, closed form, GUDHI)', 'external': '>= 1 external reference (closed form or GUDHI)', 'engine_only': 'only the engine-internal full-id file'}[k] }",
                  "verify.py, aggregate.py")
            M.add(p + lab + "Pct", f"{100 * r[k] / n:.1f}", f"{what}: same, % of the reported "
                  f"vectors", "verify.py, aggregate.py")
        M.add(p + "Vectors", intc(n), f"{what}: reported Betti vectors", "verify.py")
    CV = pd.DataFrame(cov_rows)
    CV.to_csv(os.path.join(RES, "summary_coverage.csv"), index=False)
    lines = [r"\begin{tabular}{@{}lrrrrrr@{}}", r"\toprule",
             r"workloads & runs & vectors & $\geq1$ ref. & $\geq2$ ref. & all 3 & "
             r"$\geq1$ external \\", r"\midrule"]
    for _, r in CV.iterrows():
        if r.family == "all":
            lines.append(r"\midrule")
        name = "all exact runs" if r.family == "all" else FAMILY_NAME[r.family]
        lines.append(f"{name} & {intc(r.runs)} & {intc(r.vectors)} & "
                     + " & ".join(f"{intc(r[k])} ({100 * r[k] / r.vectors:.1f}\\%)"
                                  for k in ("ge1", "ge2", "all3", "external")) + r" \\")
    smp = os.path.join(RES, "E0", "samples_crosscheck.csv")
    if os.path.exists(smp):
        X = pd.read_csv(smp)
        ref = X[X.method.str.startswith("ref:")]
        lines.append(r"\midrule")
        lines.append(f"\\multicolumn{{7}}{{@{{}}l}}{{Python reference (\\texttt{{reference/}}): "
                     f"{len(ref["sample"].unique())} committed samples only, "
                     f"{len(ref.method.unique())} methods, {intc(ref.states.sum())} vectors, "
                     f"{int(ref.mismatch_vs_gudhi.sum() + ref.mismatch_vs_expected.sum())} "
                     f"mismatches}} \\\\")
        M.add("NumReferenceChecks", intc(ref.states.sum()), "Python reference: Betti vectors "
              "compared with GUDHI (and closed form) on the committed samples (its only runs)",
              "crosscheck_samples.py")
        M.add("NumReferenceSamples", intc(len(ref["sample"].unique())), "Python reference: samples "
              "it ran on", "crosscheck_samples.py")
        M.add("NumReferenceMethods", intc(len(ref.method.unique())), "Python reference: methods "
              "run (drb-id, mmhm-norb, mmhm)", "crosscheck_samples.py")
        M.add("NumReferenceMismatches", intc(ref.mismatch_vs_gudhi.sum() +
                                             ref.mismatch_vs_expected.sum()),
              "Python reference: mismatching states", "crosscheck_samples.py")
    lines += [r"\bottomrule", r"\end{tabular}"]
    _write("tab_coverage.tex", lines)
    # ---- lcr: time to first error (review M1, minor 12)
    for w, g in L.groupby("workload"):
        tag = inst_tag(w)
        fw = g.first_wrong_t.dropna()
        M.add(f"NumLcr{tag}Wrong", intc(g.wrong_updates.sum()), f"lcr on {w}: wrong updates "
              f"(3 seeds)", "verify.py")
        M.add(f"NumLcr{tag}Updates", intc(g.verified_updates.sum()), f"lcr on {w}: verified "
              f"updates (3 seeds)", "verify.py")
        if len(fw):
            M.add(f"NumLcr{tag}FirstWrongMax", intc(fw.max()), f"lcr on {w}: first wrong update, "
                  f"max over seeds", "verify.py")
            M.add(f"NumLcr{tag}FirstWrongList", ", ".join(str(int(x)) for x in
                                                          g.sort_values("seed").first_wrong_t),
                  f"lcr on {w}: first wrong update of seeds 0, 1, 2", "verify.py")
    fw = L.first_wrong_t.dropna()
    M.add("NumLcrFirstWrongMaxAll", intc(fw.max()), "lcr: latest first wrong update over all "
          "E0 runs that go wrong", "verify.py")
    M.add("NumLcrRunsWrong", intc(len(fw)), "lcr: E0 runs that are ever wrong", "verify.py")
    M.add("NumLcrRuns", intc(len(L)), "lcr: E0 runs", "verify.py")
    # ---- E7: where mmhm beats drb-id-rb (review minor 11)
    for w, g in e7.groupby("workload"):
        pv = g.pivot_table(index=["alpha", "period"], columns="method", values="amort_us")
        n = int((pv["mmhm"] < pv["drb-id-rb"]).sum())
        M.add(f"NumESeven{inst_tag(w)}MmhmBelowDrbIdRb", intc(n), f"E7 {w}: (alpha, period) "
              f"settings (of {len(pv)}) at which mmhm has lower amortized latency than "
              f"drb-id-rb", "aggregate.py")
        M.add(f"NumESeven{inst_tag(w)}Settings", intc(len(pv)), f"E7 {w}: grid settings",
              "aggregate.py")
    # ---- noise beyond W2 N = 22 (review M8, minor 17)
    noise_rows = []
    for f in sorted(glob.glob(os.path.join(RES, "noise", "*__rep*.csv.gz"))):
        inst, meth, cond, rep = os.path.basename(f)[:-7].split("__")
        d = raw_csv(f)
        t = d[d.t > 0].time_ns.to_numpy(dtype=float) / 1e3
        noise_rows.append({"instance": inst, "method": meth, "condition": cond,
                           "rep": int(rep[3:]), "median_us": np.median(t),
                           "p99_us": np.percentile(t, 99), "mean_us": t.mean()})
    NZ = pd.DataFrame(noise_rows)
    nsum = []
    for (inst, meth, cond), g in NZ.groupby(["instance", "method", "condition"]):
        r = {"instance": inst, "method": meth, "condition": cond, "reps": len(g)}
        for c in ("median_us", "p99_us", "mean_us"):
            r[c] = g[c].median()
            r["cv_" + c] = g[c].std(ddof=1) / g[c].mean() if len(g) > 1 else np.nan
        nsum.append(r)
    # W5a: the 3 seeds are identical instances, i.e. repetitions
    w5a = runs_df[(runs_df.exp == "E6") & runs_df.workload.str.startswith("w5a")]
    for (w, lab), g in w5a.groupby(["workload", "label"]):
        r = {"instance": w + " (3 seeds = repetitions)", "method": lab, "condition": "sweep",
             "reps": len(g)}
        for c, src_c in (("median_us", "lat_med_us"), ("p99_us", "lat_p99_us"),
                         ("mean_us", "amort_us")):
            r[c] = g[src_c].median()
            r["cv_" + c] = g[src_c].std(ddof=1) / g[src_c].mean()
        nsum.append(r)
        tag = inst_tag(w)
        M.add(f"NumNoiseCVSeeds{tag}{METHOD_TAG[lab]}Amort", pct(r["cv_mean_us"]),
              f"noise: CV (%) of the amortized latency over the 3 identical W5a runs ({w}, {lab})",
              "aggregate.py")
        M.add(f"NumNoiseCVSeeds{tag}{METHOD_TAG[lab]}PNinetyNine", pct(r["cv_p99_us"]),
              f"noise: CV (%) of p99 over the 3 identical W5a runs ({w}, {lab})", "aggregate.py")
    NS = pd.DataFrame(nsum)
    NS.to_csv(os.path.join(RES, "summary_noise.csv"), index=False, float_format="%.6g")
    short = {"w2_N22_s8_T2000_seed0": "WTwoNTwentyTwoSEight",
             "w2_N33_s8_T2000_seed0": "WTwoNThirtyThreeSEight",
             "w5a_cycle_L100000_T2000_seed0": "WFiveCycleLOneHundredThousand",
             "w3_N20_k2_c4_T2000_seed0": "WThreeNTwenty",
             "w1_torus_256x256_k2_h3_T2000_seed0": "WOneTorusTwoHundredFiftySix"}
    for _, r in NS[NS.condition == "alone"].iterrows():
        if r.instance not in short:
            continue
        p = f"NumNoiseCV{short[r.instance]}{METHOD_TAG[r.method]}"
        for c, lab in (("median_us", "Med"), ("mean_us", "Amort"), ("p99_us", "PNinetyNine")):
            M.add(p + lab, pct(r["cv_" + c]), f"noise: CV (%) of the {lab} latency over "
                  f"{r.reps} identical runs alone of {r.method} on {r.instance}", "noise.py")
    big = NS[NS.instance == "w2_N33_s8_T2000_seed0"]
    for meth in big.method.unique():
        a = big[(big.method == meth) & (big.condition == "alone")]
        b = big[(big.method == meth) & (big.condition == "loaded4")]
        if len(a) and len(b):
            M.add(f"NumNoise{METHOD_TAG[meth]}LargeFourBusyPct",
                  f"{100 * (b.median_us.iloc[0] / a.median_us.iloc[0] - 1):+.1f}",
                  f"noise: change (%) of the median latency of {meth} on W2 N=33 (955k "
                  f"simplices) with one timed + two GUDHI runs concurrently, vs alone "
                  f"({int(a.reps.iloc[0])} + {int(b.reps.iloc[0])} runs)", "noise.py")
    cv = NS[(NS.condition.isin(["alone", "sweep"]))]
    M.add("NumNoiseCVAmortMax", pct(cv.cv_mean_us.max()), "noise: largest CV (%) of the "
          "amortized latency over all repetition sets (noise.py sets and W5a)", "aggregate.py")
    M.add("NumNoiseCVPNinetyNineMax", pct(cv.cv_p99_us.max()), "noise: largest CV (%) of p99 "
          "over all repetition sets", "aggregate.py")
    lines = [r"\begin{tabular}{@{}llrrrr@{}}", r"\toprule",
             r"instance & method & runs & CV median & CV amortized & CV p99 \\", r"\midrule"]
    for _, r in NS[NS.condition.isin(["alone", "sweep"])].iterrows():
        nm = r.instance.replace("_T2000_seed0", "").replace("_", r"\_")
        lines.append(f"\\texttt{{{nm}}} & {mname(r.method)} & {int(r.reps)} & "
                     f"{pct(r.cv_median_us)}\\% & {pct(r.cv_mean_us)}\\% & {pct(r.cv_p99_us)}\\% \\\\")
    lines += [r"\bottomrule", r"\end{tabular}"]
    _write("tab_noise.tex", lines)
    # ---- which timed runs shared the machine with untimed jobs (review minor 17)
    man = pd.concat([pd.read_csv(p) for p in glob.glob(os.path.join(RES, "E*", "manifest.csv"))])
    man = man[man.exit.astype(str) == "0"].copy()
    man["t0"] = pd.to_datetime(man.started)
    man["t1"] = man.t0 + pd.to_timedelta(man.wall_s.astype(float), unit="s")
    unt = man[man.timed == 0]
    tim = man[man.timed == 1].drop_duplicates(["exp", "workload", "label", "seed"], keep="last")
    ov = []
    for _, r in tim.iterrows():
        o = unt[(unt.t0 < r.t1) & (unt.t1 > r.t0)]
        ov.append(len(o) > 0)
    tim = tim.assign(overlaps_untimed=ov)
    tim[["exp", "workload", "label", "seed", "started", "wall_s", "overlaps_untimed"]].to_csv(
        os.path.join(RES, "summary_overlap.csv"), index=False)
    tov = tim[tim.overlaps_untimed]
    M.add("NumTimedRunsWithUntimed", intc(len(tov)), "timed runs that overlapped in time with "
          "an untimed job (lcr error-rate runs, E2 GUDHI oracle) during the sweep "
          "(results/summary_overlap.csv)", "run.py manifests")
    M.add("NumTimedRunsWithUntimedEngine", intc(int((tov.label != "gudhi").sum())),
          "of those, engine runs (the rest are timed gudhi runs)", "run.py manifests")
    M.add("NumUntimedEnd", str(unt.t1.max().strftime("%H:%M")), "time (UTC) at which the last "
          "untimed job of the sweep ended", "run.py manifests")

    # ---- the E1 outlier run and its single rerun (review M11)
    for seed in (0, 1, 2):
        p = os.path.join(RES, "E1", f"w2_N22_s8__mmhm-norb__seed{seed}.csv.gz")
        d = raw_csv(p)
        t = d[d.t > 0].time_ns.to_numpy(dtype=float) / 1e3
        for b in range(5):
            M.add(f"NumOutlierSeed{words(seed)}Block{words(b + 1)}Med",
                  sig(np.median(t[400 * b:400 * (b + 1)])),
                  f"E1 w2_N22_s8 mmhm-norb seed {seed}: median latency of updates "
                  f"{400 * b + 1}-{400 * (b + 1)} (us)", "aggregate.py")
    rr = os.path.join(RES, "rerun", "w2_N22_s8__mmhm-norb__seed1.csv.gz")
    if os.path.exists(rr):
        d = raw_csv(rr)
        o = raw_csv(os.path.join(RES, "E1", "w2_N22_s8__mmhm-norb__seed1.csv.gz"))
        t = d[d.t > 0].time_ns.to_numpy(dtype=float) / 1e3
        M.add("NumOutlierRerunAmort", sig(t.mean()), "rerun of E1 w2_N22_s8 mmhm-norb seed 1: "
              "amortized latency (us)", "results/rerun/")
        M.add("NumOutlierRerunMed", sig(np.median(t)), "rerun: median latency (us)",
              "results/rerun/")
        M.add("NumOutlierRerunPNinetyNine", sig(np.percentile(t, 99)), "rerun: p99 (us)",
              "results/rerun/")
        to = o[o.t > 0].time_ns.to_numpy(dtype=float) / 1e3
        M.add("NumOutlierOrigAmort", sig(to.mean()), "original E1 w2_N22_s8 mmhm-norb seed 1: "
              "amortized latency (us)", "results/E1/")
        M.add("NumOutlierOrigPNinetyNine", sig(np.percentile(to, 99)), "original: p99 (us)",
              "results/E1/")
        for b in range(5):
            M.add(f"NumOutlierRerunBlock{words(b + 1)}Med",
                  sig(np.median(t[400 * b:400 * (b + 1)])),
                  f"rerun: median latency of updates {400 * b + 1}-{400 * (b + 1)} (us)",
                  "results/rerun/")
        same = all((d[c].to_numpy() == o[c].to_numpy()).all()
                   for c in ("b0", "b1", "b2", "b3", "chain_adds", "nnz_R", "nnz_V",
                             "footprint_sum"))
        M.add("NumOutlierRerunIdentical", "yes" if same else "no", "rerun: Betti numbers, "
              "additions, nnz and footprints identical to the original run row by row",
              "results/rerun/")
        sib = [raw_csv(os.path.join(RES, "E1", f"w2_N22_s8__mmhm-norb__seed{k}.csv.gz"))
               for k in (0, 2)]
        pool = np.concatenate([x[x.t > 0].time_ns.to_numpy(dtype=float) / 1e3 for x in sib] + [t])
        M.add("NumWTwoNTwentyTwoSEightMmhmNorbAmortWithRerun", sig(pool.mean()),
              "w2_N22_s8 mmhm-norb amortized latency (us) with seed 1 replaced by its rerun",
              "aggregate.py")
        M.add("NumWTwoNTwentyTwoSEightMmhmNorbPNinetyNineWithRerun",
              sig(np.percentile(pool, 99)), "same, p99 (us)", "aggregate.py")


def protocol_from_configs():
    """T, seeds and the gudhi prefix rule, read from the configs (review minor 23)."""
    sys.path.insert(0, os.path.join(HERE, "configs"))
    import make_configs as mc  # noqa: E402
    with open(os.path.join(HERE, "configs", "E1.json"), encoding="utf-8") as fh:
        cfg = json.load(fh)
    prefixes = set()
    for p in glob.glob(os.path.join(HERE, "configs", "E*.json")):
        with open(p, encoding="utf-8") as fh:
            for inst in json.load(fh)["instances"]:
                if "gudhi" in inst.get("T_by_method", {}):
                    prefixes.add(inst["T_by_method"]["gudhi"])
    return int(cfg["T"]), len(cfg["seeds"]), min(prefixes), int(mc.GUDHI_FULL_LIMIT)

if __name__ == "__main__":
    main()
