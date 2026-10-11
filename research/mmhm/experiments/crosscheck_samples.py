#!/usr/bin/env python3
"""Sample cross-check (SPEC 8: three independent oracles on every committed
workload sample), extended to every exact engine configuration.

For each sample in workloads/samples/ this runs

  * every exact engine method with --verify-every 1 (internal full-id after
    every update): full-id, full-morse, drb-id, drb-id-rb, mmhm, mmhm-norb,
    plus mmhm and drb-id-rb with aggressive rebuilds (alpha 0.05, period 4);
  * the pure-Python reference (reference/drb_ref.py) for drb-id, mmhm-norb
    and mmhm;
  * full-sorted and drb-rand (review round), exact;
  * lcr (v1's rule) and lcr-rc (lcr + v1's periodic recompression, m = 32)
    with --verify-every 1, to count their wrong states;

and compares every Betti file, state by state, with the committed GUDHI
Betti file (<sample>.betti) and, where it exists, the analytic
<sample>.expected.betti. Any disagreement of an exact method exits 3.

Output: results/E0/samples_crosscheck.csv (one row per sample x method).
"""

from __future__ import annotations

import csv
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ENGINE = os.path.join(ROOT, "engine", "build-release", "mmhm")
REF = os.path.join(ROOT, "reference", "drb_ref.py")
SAMPLES = os.path.join(ROOT, "workloads", "samples")
OUT = os.path.join(HERE, "results", "E0", "samples_crosscheck.csv")

ENGINE_CONFIGS = [
    ("full-id", "full-id", []),
    ("full-morse", "full-morse", []),
    ("drb-id", "drb-id", []),
    ("drb-id-rb", "drb-id-rb", []),
    ("mmhm", "mmhm", []),
    ("mmhm-norb", "mmhm-norb", []),
    ("mmhm(a0.05,p4)", "mmhm", ["--alpha", "0.05", "--period", "4"]),
    ("drb-id-rb(a0.05,p4)", "drb-id-rb", ["--alpha", "0.05", "--period", "4"]),
    ("full-sorted", "full-sorted", []),
    ("drb-rand", "drb-rand", []),
]
INEXACT = [("lcr", "lcr", []), ("lcr-rc", "lcr-rc", ["--period", "32"])]
REF_CONFIGS = [("ref:drb-id", "drb-id", []), ("ref:mmhm-norb", "mmhm-norb", []),
               ("ref:mmhm", "mmhm", [])]


def read_betti(path):
    with open(path, encoding="utf-8") as fh:
        return [tuple(int(x) for x in ln.split()) for ln in fh if ln.strip()]


def diff(a, b):
    n = min(len(a), len(b))
    bad = [t for t in range(n) if a[t] != b[t]]
    return n, bad


def main():
    names = sorted({f[:-4] for f in os.listdir(SAMPLES) if f.endswith(".seq")})
    rows = []
    failed = []
    with tempfile.TemporaryDirectory() as tmp:
        for name in names:
            seq = os.path.join(SAMPLES, name + ".seq")
            gudhi = read_betti(os.path.join(SAMPLES, name + ".betti"))
            exp_path = os.path.join(SAMPLES, name + ".expected.betti")
            expected = read_betti(exp_path) if os.path.exists(exp_path) else None
            jobs = []
            for label, meth, extra in ENGINE_CONFIGS + INEXACT:
                out = os.path.join(tmp, f"{name}_{len(jobs)}.betti")
                csvp = os.path.join(tmp, f"{name}_{len(jobs)}.csv")
                cmd = [ENGINE, "run", "--method", meth, "--seq", seq, "--verify-every", "1",
                       "--out", csvp, "--betti-out", out] + extra
                jobs.append((label, meth, cmd, out, csvp))
            for label, meth, extra in REF_CONFIGS:
                out = os.path.join(tmp, f"{name}_{len(jobs)}.betti")
                cmd = [sys.executable, REF, "--seq", seq, "--method", meth, "--betti-out", out]
                jobs.append((label, meth, cmd, out, None))
            for label, meth, cmd, out, csvp in jobs:
                p = subprocess.run(cmd, capture_output=True, text=True)
                got = read_betti(out) if os.path.exists(out) else []
                n_g, bad_g = diff(got, gudhi)
                n_e, bad_e = diff(got, expected) if expected else (0, [])
                internal = ""
                if csvp and os.path.exists(csvp):
                    with open(csvp, encoding="utf-8") as fh:
                        r = list(csv.DictReader(fh))
                    internal = sum(int(x["mismatch"]) for x in r)
                row = {"sample": name, "method": label, "exit": p.returncode,
                       "states": len(got), "states_gudhi": len(gudhi),
                       "mismatch_vs_gudhi": len(bad_g), "states_vs_expected": n_e,
                       "mismatch_vs_expected": len(bad_e),
                       "internal_mismatches": internal,
                       "first_wrong_state": (bad_g[0] if bad_g else "")}
                rows.append(row)
                exact = meth not in ("lcr", "lcr-rc")
                ok = p.returncode == 0 and len(got) == len(gudhi) and not bad_g and not bad_e
                if exact and not ok:
                    failed.append((name, label, " ".join(cmd), p.stderr[-500:]))
                print(f"{name:16s} {label:20s} states {len(got):4d}  vs GUDHI {len(bad_g):3d} "
                      f"wrong  vs expected {len(bad_e) if expected else '-'}", flush=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {OUT}")
    if failed:
        for f in failed:
            print("EXACT METHOD DISAGREES:", f, file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    main()
