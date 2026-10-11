#!/usr/bin/env python3
"""Timing noise and interference check (experiments/PLAN.md, timing protocol).

For a target run X (engine method on one W2 instance, the production flags
`--verify-every 50`, T = 2000) this measures

  alone   : X repeated 5 times, nothing else running            -> run-to-run CV
  timed2  : X while one other timed engine run executes          (2 busy cores)
  loaded4 : X while one other timed run and two GUDHI oracle
            replays (the untimed verification load) execute      (4 busy cores)

and writes results/noise/noise_runs.csv (one row per repetition) plus the raw
CSVs. aggregate.py turns it into the noise numbers of the paper. Targets:
`mmhm` (microsecond updates, cache sensitive) and `full-id` (millisecond
updates, memory streaming).

  python3 noise.py [--reps 5] [--loaded-reps 3]
  python3 noise.py --extra     # review round: 3 more instances x {mmhm, drb-id,
                               # full-id}, 5 runs alone; alone vs loaded4 at ~1e6
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import os
import shutil
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ENGINE = os.path.join(ROOT, "engine", "build-release", "mmhm")
ORACLE = os.path.join(ROOT, "oracle", "gudhi_oracle.py")
DATA = os.path.join(ROOT, "workloads", "data")
OUT = os.path.join(HERE, "results", "noise")

INSTANCE = "w2_N22_s8_T2000_seed0"       # target instance (E1 / E7 size)
LOAD_INSTANCE = "w2_N22_s8_T2000_seed1"  # instance used by the background jobs
TARGETS = ["mmhm", "full-id"]


def engine_cmd(method, inst, out_csv, T=2000):
    return [ENGINE, "run", "--method", method, "--seq", os.path.join(DATA, inst + ".seq"),
            "--out", out_csv, "--max-updates", str(T), "--verify-every", "50"]


def stats(csv_path):
    with open(csv_path, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    t = np.array([int(r["time_ns"]) for r in rows[1:]], dtype=float)
    return {"median_us": np.median(t) / 1e3, "p95_us": np.percentile(t, 95) / 1e3,
            "mean_us": t.mean() / 1e3, "init_ms": int(rows[0]["time_ns"]) / 1e6,
            "updates": len(t)}


def start_background(kind):
    """Background load that runs until killed: a loop of engine (timed-like)
    or GUDHI oracle (untimed-like) replays on LOAD_INSTANCE."""
    seq = os.path.join(DATA, LOAD_INSTANCE + ".seq")
    if kind == "engine":
        inner = f"while true; do {ENGINE} run --method full-id --seq {seq} --out /dev/null " \
                f"--verify-every 50 >/dev/null 2>&1; done"
    else:
        inner = f"while true; do {sys.executable} {ORACLE} {seq} -o /dev/null " \
                f"--max-updates 300 >/dev/null 2>&1; done"
    return subprocess.Popen(["bash", "-c", inner], start_new_session=True)


def stop_background(procs):
    for p in procs:
        try:
            os.killpg(p.pid, 15)
        except ProcessLookupError:
            pass
    for p in procs:
        p.wait()


EXTRA = [  # (instance, methods): run-to-run noise beyond W2 N = 22 (review M8)
    ("w5a_cycle_L100000_T2000_seed0", ["mmhm", "drb-id", "full-id"]),
    ("w3_N20_k2_c4_T2000_seed0", ["mmhm", "drb-id", "full-id"]),
    ("w1_torus_256x256_k2_h3_T2000_seed0", ["mmhm", "drb-id", "full-id"]),
]
LARGE = "w2_N33_s8_T2000_seed0"        # interference at ~1e6 simplices (review minor 17)
LARGE_LOAD = "w2_N33_s8_T2000_seed1"


def extra(reps, loaded_reps):
    """results/noise/noise_extra.csv: 5 identical runs alone per (instance,
    method) of EXTRA, and alone vs loaded4 on the ~1e6-simplex W2 instance."""
    global LOAD_INSTANCE
    rows = []

    def one(cond, inst, method, rep, bg):
        tmp = os.path.join(OUT, f".tmp_{method}.csv")
        t0 = time.time()
        subprocess.run(engine_cmd(method, inst, tmp), check=True, capture_output=True)
        wall = time.time() - t0
        st = stats(tmp)
        dst = os.path.join(OUT, f"{inst}__{method}__{cond}__rep{rep}.csv.gz")
        with open(tmp, "rb") as fi, gzip.open(dst, "wb", 9) as fo:
            shutil.copyfileobj(fi, fo)
        os.remove(tmp)
        row = {"condition": cond, "method": method, "rep": rep, "instance": inst,
               "background": bg, "wall_s": round(wall, 2)}
        row.update({k: (round(v, 3) if isinstance(v, float) else v) for k, v in st.items()})
        rows.append(row)
        print(row, flush=True)

    for inst, methods in EXTRA:
        for method in methods:
            for rep in range(1, reps + 1):
                one("alone", inst, method, rep, "none")
    for method in ("mmhm", "full-id"):
        for rep in range(1, loaded_reps + 1):
            one("alone", LARGE, method, rep, "none")
    LOAD_INSTANCE = LARGE_LOAD
    procs = [start_background(k) for k in ("engine", "gudhi", "gudhi")]
    time.sleep(8)
    try:
        for method in ("mmhm", "full-id"):
            for rep in range(1, loaded_reps + 1):
                one("loaded4", LARGE, method, rep, "engine+gudhi+gudhi")
    finally:
        stop_background(procs)
    path = os.path.join(OUT, "noise_extra.csv")
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {path}")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=5)
    ap.add_argument("--loaded-reps", type=int, default=3)
    ap.add_argument("--extra", action="store_true",
                    help="the additional instances of EXTRA and the ~1e6 interference check")
    a = ap.parse_args(argv)
    if a.extra:
        os.makedirs(OUT, exist_ok=True)
        return extra(a.reps, a.loaded_reps)
    os.makedirs(OUT, exist_ok=True)
    rows = []
    plan = [("alone", [], a.reps), ("timed2", ["engine"], a.loaded_reps),
            ("loaded4", ["engine", "gudhi", "gudhi"], a.loaded_reps)]
    for cond, bg, reps in plan:
        procs = [start_background(k) for k in bg]
        if procs:
            time.sleep(5)  # let the background jobs get past parsing
        try:
            for method in TARGETS:
                for rep in range(1, reps + 1):
                    tmp = os.path.join(OUT, f".tmp_{method}.csv")
                    t0 = time.time()
                    subprocess.run(engine_cmd(method, INSTANCE, tmp), check=True,
                                   capture_output=True)
                    wall = time.time() - t0
                    st = stats(tmp)
                    dst = os.path.join(OUT, f"{INSTANCE}__{method}__{cond}__rep{rep}.csv.gz")
                    with open(tmp, "rb") as fi, gzip.open(dst, "wb", 9) as fo:
                        shutil.copyfileobj(fi, fo)
                    os.remove(tmp)
                    row = {"condition": cond, "method": method, "rep": rep, "instance": INSTANCE,
                           "background": "+".join(bg) or "none", "wall_s": round(wall, 2)}
                    row.update({k: (round(v, 3) if isinstance(v, float) else v)
                                for k, v in st.items()})
                    rows.append(row)
                    print(row, flush=True)
        finally:
            stop_background(procs)
    path = os.path.join(OUT, "noise_runs.csv")
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    # short report
    for method in TARGETS:
        al = [r for r in rows if r["method"] == method and r["condition"] == "alone"]
        med = np.array([r["median_us"] for r in al])
        mean = np.array([r["mean_us"] for r in al])
        print(f"{method}: alone median {np.median(med):.2f} us, CV(median) "
              f"{med.std(ddof=1) / med.mean():.3%}, CV(mean) {mean.std(ddof=1) / mean.mean():.3%}")
        for cond in ("timed2", "loaded4"):
            cr = [r["median_us"] for r in rows if r["method"] == method and r["condition"] == cond]
            print(f"   {cond}: median of medians {np.median(cr):.2f} us "
                  f"({np.median(cr) / np.median(med) - 1:+.2%} vs alone)")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
