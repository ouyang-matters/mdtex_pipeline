#!/usr/bin/env python3
"""E0 correctness gate over every finished run of experiments/configs/E*.json.

For every run of an exact method (full-id, full-morse, gudhi, drb-id,
drb-id-rb, mmhm, mmhm-norb, euler) it checks, state by state:

  internal  the engine's own --verify-every 50 comparisons with an internal
            full-id recomputation (CSV columns `verified`, `mismatch`; an exact
            method exits 3 on a mismatch, so a finished run has none);
  (a)       the Betti file against the engine `full-id` Betti file of the same
            instance (any experiment; all T updates);
  (b)       against <instance>.expected.betti (W1, W2, W3, W5), all states;
  (c)       against the GUDHI oracle Betti file of the same instance (timed
            `gudhi` run or untimed `gudhi-oracle` run). Required coverage: the
            first 200 updates of every instance, and all updates when
            |K_0| <= 3e5 (`gudhi_coverage_ok`).

For `lcr` (v1's rule, run with --verify-every 1) it reports the fraction of
wrong states and the first wrong update.

Outputs results/E0_correctness.csv (one row per exact run, including how
many of its Betti vectors were checked against >= 1, >= 2 and all three
references) and results/E0_lcr.csv (one row per lcr run). Exits 3 if any
exact method disagrees with anything or the GUDHI coverage requirement is not
met — that is a STOP condition, not something to aggregate away. Exits 4 if
the workload data (workloads/data/, git-ignored) or a closed-form
.expected.betti file of a W1/W2/W3/W5 instance is missing, instead of
silently checking fewer states.

  python3 verify.py
"""

from __future__ import annotations

import csv
import glob
import gzip
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run as runner  # noqa: E402

ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "workloads", "data")
RES = os.path.join(HERE, "results")
EXACT = {"full-id", "full-morse", "full-sorted", "gudhi", "drb-id", "drb-id-rb", "drb-rand",
         "mmhm", "mmhm-norb", "euler"}
GUDHI_FULL_LIMIT = 3e5
GUDHI_PREFIX = 200
CLOSED_FORM = {"w1", "w2", "w3", "w5a", "w5b"}  # workloads with analytic Betti numbers


def read_betti(path):
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt", encoding="utf-8") as fh:
        return [tuple(int(x) for x in ln.split()) for ln in fh if ln.strip()]


def read_csv(path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def compare(a, b):
    """(states compared, mismatching states, first mismatching state or '')."""
    n = min(len(a), len(b))
    bad = [t for t in range(n) if a[t] != b[t]]
    return n, len(bad), (bad[0] if bad else "")


def all_runs():
    runs = []
    for cfg in sorted(glob.glob(os.path.join(HERE, "configs", "E*.json"))):
        _, rs = runner.load_runs(cfg)
        runs += rs
    return runs


def main():
    runs = [r for r in all_runs() if r.done()]
    betti_cache = {}

    def betti(r):
        if r.betti not in betti_cache:
            betti_cache[r.betti] = read_betti(r.betti)
        return betti_cache[r.betti]

    by_inst = {}
    for r in runs:
        by_inst.setdefault(r.instance, []).append(r)

    rows, lcr_rows, problems = [], [], []
    missing_expected = set()
    if not os.path.isdir(DATA) or not any(f.endswith(".seq") for f in os.listdir(DATA)):
        print(f"ERROR: workload data missing: {DATA} has no .seq files. Regenerate them "
              f"first (experiments/README.md: python3 run.py configs/E*.json --only-gen); "
              f"without them the closed-form checks cannot run.", file=sys.stderr)
        sys.exit(4)
    for r in runs:
        rows_csv = read_csv(r.csv)
        b = betti(r)
        T_done = len(rows_csv) - 1
        K0 = None
        if "n0" in rows_csv[0]:
            K0 = sum(int(rows_csv[0][f"n{k}"]) for k in range(4))
        else:  # gudhi CSV has no sizes; take them from a sibling engine run
            for o in by_inst[r.instance]:
                if o.method != "gudhi":
                    c0 = read_csv(o.csv)[0]
                    K0 = sum(int(c0[f"n{k}"]) for k in range(4))
                    break
        if r.method in ("lcr", "lcr-rc"):
            wrong = [int(x["t"]) for x in rows_csv if int(x["mismatch"]) and int(x["t"]) > 0]
            ver = sum(int(x["verified"]) for x in rows_csv if int(x["t"]) > 0)
            lcr_rows.append({"method": r.method, "workload": r.workload, "instance": r.instance,
                             "seed": r.seed,
                             "K0": K0, "T": T_done, "verified_updates": ver,
                             "wrong_updates": len(wrong),
                             "frac_wrong": round(len(wrong) / ver, 6) if ver else "",
                             "first_wrong_t": wrong[0] if wrong else ""})
            continue
        if r.method not in EXACT:
            continue
        internal_ver = sum(int(x.get("verified", 0)) for x in rows_csv)
        internal_mis = sum(int(x.get("mismatch", 0)) for x in rows_csv)
        row = {"exp": r.exp, "workload": r.workload, "label": r.label, "method": r.method,
               "seed": r.seed, "instance": r.instance, "K0": K0, "T": T_done,
               "betti_states": len(b), "internal_verified": internal_ver,
               "internal_mismatch": internal_mis}
        # (a) engine full-id of the same instance (longest available, not itself)
        fid = [o for o in by_inst[r.instance] if o.method == "full-id" and o.key != r.key]
        fid.sort(key=lambda o: -o.T)
        if fid:
            n, m, f = compare(b, betti(fid[0]))
            row.update(fullid_states=n, fullid_mismatch=m, fullid_first_bad=f,
                       fullid_ref=fid[0].key)
        else:
            row.update(fullid_states=0, fullid_mismatch=0, fullid_first_bad="", fullid_ref="")
        # (b) analytic expectation (closed form). W1, W2, W3, W5 always have one:
        # a missing file means the workload data are absent, which must not
        # silently drop checks (review M14).
        exp_path = os.path.join(DATA, r.instance + ".expected.betti")
        if r.workload.split("_")[0] in CLOSED_FORM and not os.path.exists(exp_path):
            missing_expected.add(exp_path)
        if os.path.exists(exp_path):
            if exp_path not in betti_cache:
                betti_cache[exp_path] = read_betti(exp_path)
            n, m, f = compare(b, betti_cache[exp_path])
            row.update(expected_states=n, expected_mismatch=m, expected_first_bad=f)
        else:
            row.update(expected_states=0, expected_mismatch=0, expected_first_bad="")
        # (c) GUDHI oracle
        gud = [o for o in by_inst[r.instance] if o.method == "gudhi" and o.key != r.key]
        gud.sort(key=lambda o: -o.T)
        need = (T_done + 1) if (K0 is not None and K0 <= GUDHI_FULL_LIMIT) else \
            min(T_done + 1, GUDHI_PREFIX + 1)
        if gud:
            g = betti(gud[0])
            n, m, f = compare(b, g)
            row.update(gudhi_states=n, gudhi_mismatch=m, gudhi_first_bad=f, gudhi_ref=gud[0].key)
        else:
            n = 0
            row.update(gudhi_states=0, gudhi_mismatch=0, gudhi_first_bad="", gudhi_ref="")
        if r.method == "gudhi":
            need = 0  # the oracle itself; checked against full-id and expected instead
        row["gudhi_required"] = need
        row["gudhi_coverage_ok"] = int(n >= need)
        # Coverage per reported vector (review B2). Every comparison is a prefix
        # starting at state 0, so with prefix lengths l1 >= l2 >= l3 (capped at
        # the run's states), l1 vectors were checked against >= 1 reference, l2
        # against >= 2, l3 against all three (full-id file, closed form, GUDHI).
        # A run is never its own reference (full-id / gudhi runs have <= 2).
        ns = len(b)
        ls = sorted([min(row["fullid_states"], ns), min(row["expected_states"], ns),
                     min(row["gudhi_states"], ns)], reverse=True)
        row["cov_ge1"], row["cov_ge2"], row["cov_all3"] = ls
        row["cov_external"] = max(min(row["expected_states"], ns), min(row["gudhi_states"], ns))
        ok = (internal_mis == 0 and row["fullid_mismatch"] == 0 and
              row["expected_mismatch"] == 0 and row["gudhi_mismatch"] == 0 and
              row["gudhi_coverage_ok"] == 1 and len(b) == T_done + 1 and
              (row["fullid_states"] > 0 or r.method == "full-id"))
        if r.method == "full-id" and not fid:
            # the only full-id run of its instance: still covered by expected/GUDHI
            ok = ok and (row["expected_states"] > 0 or row["gudhi_states"] > 0)
        row["status"] = "ok" if ok else "FAIL"
        if not ok:
            problems.append(row)
        rows.append(row)

    rows.sort(key=lambda x: (x["exp"], x["workload"], x["label"], x["seed"]))
    lcr_rows.sort(key=lambda x: (x["method"], x["workload"], x["seed"]))
    out = os.path.join(RES, "E0_correctness.csv")
    fields = ["exp", "workload", "label", "method", "seed", "instance", "K0", "T",
              "betti_states", "internal_verified", "internal_mismatch",
              "fullid_states", "fullid_mismatch", "fullid_first_bad", "fullid_ref",
              "expected_states", "expected_mismatch", "expected_first_bad",
              "gudhi_states", "gudhi_mismatch", "gudhi_first_bad", "gudhi_ref",
              "gudhi_required", "gudhi_coverage_ok", "cov_ge1", "cov_ge2", "cov_all3",
              "cov_external", "status"]
    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    out2 = os.path.join(RES, "E0_lcr.csv")
    if lcr_rows:
        with open(out2, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(lcr_rows[0]))
            w.writeheader()
            w.writerows(lcr_rows)
    n_states = sum(r["betti_states"] for r in rows)
    print(f"{len(rows)} exact runs, {n_states} reported states; "
          f"vs full-id {sum(r['fullid_states'] for r in rows)} states, "
          f"vs expected {sum(r['expected_states'] for r in rows)}, "
          f"vs GUDHI {sum(r['gudhi_states'] for r in rows)}; "
          f"internal checks {sum(r['internal_verified'] for r in rows)}; "
          f"problems {len(problems)}")
    if lcr_rows:
        tot_w = sum(r["wrong_updates"] for r in lcr_rows)
        tot_v = sum(r["verified_updates"] for r in lcr_rows)
        print(f"lcr: {len(lcr_rows)} runs, {tot_w}/{tot_v} wrong updates")
    print(f"wrote {out}" + (f" and {out2}" if lcr_rows else ""))
    n_all = sum(r["betti_states"] for r in rows)
    print(f"coverage: >=1 reference {sum(r['cov_ge1'] for r in rows)}, >=2 "
          f"{sum(r['cov_ge2'] for r in rows)}, all three {sum(r['cov_all3'] for r in rows)}, "
          f">=1 external (closed form or GUDHI) {sum(r['cov_external'] for r in rows)} "
          f"of {n_all}")
    if missing_expected:
        print(f"ERROR: {len(missing_expected)} closed-form Betti files (.expected.betti) are "
              f"missing for W1/W2/W3/W5 instances, e.g. {sorted(missing_expected)[0]}. "
              f"Regenerate the workloads (experiments/README.md); refusing to report fewer "
              f"closed-form checks silently.", file=sys.stderr)
        sys.exit(4)
    if problems:
        for p in problems[:20]:
            print("PROBLEM:", {k: p[k] for k in ("exp", "workload", "label", "seed", "instance",
                                                 "internal_mismatch", "fullid_mismatch",
                                                 "fullid_first_bad", "expected_mismatch",
                                                 "gudhi_mismatch", "gudhi_states",
                                                 "gudhi_required", "status")},
                  file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    main()
