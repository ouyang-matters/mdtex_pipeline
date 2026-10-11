#!/usr/bin/env python3
"""Config-driven, resumable experiment runner (experiments/PLAN.md).

  python3 run.py configs/E1.json [configs/E3.json ...] [--dry-run]
         [--timed-slots 2] [--untimed-slots 2] [--mixed] [--only-gen]
         [--filter SUBSTR] [--force]

A config (configs/*.json) names an experiment, its seeds, its instances
(generator arguments for workloads/gen.py) and its methods. Each
(instance, method, seed) is one run:

  results/<exp>/<workload>__<label>__seed<k>.csv.gz     engine / gudhi CSV
  results/<exp>/<workload>__<label>__seed<k>.betti.gz   Betti file (SPEC 6.2)
  results/<exp>/manifest.csv                            one row per finished run

A run whose CSV already exists is skipped (resumable); outputs are written to
temporary names and renamed only after the process exited 0. Instances are
generated first (workloads/gen.py, deterministic in the seed) into
workloads/data/ (gitignored) when missing.

Scheduling: runs marked timed (the default) execute at most `--timed-slots`
at a time (2 on the 4-core host, PLAN.md). Untimed runs (lcr error-rate runs,
oracle-only verification) use `--untimed-slots`; unless `--mixed` is given
they start only after every timed run has finished, so they never share the
machine with a timing run (see results/noise/ for the interference check).

An exact method that fails (exit 3 = verification mismatch, or any other
non-zero exit) stops the whole pipeline: nothing further is scheduled, the
command is printed, and the runner exits 3. Nothing is papered over.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
import shlex
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # research/mmhm
ENGINE = os.path.join(ROOT, "engine", "build-release", "mmhm")
GEN = os.path.join(ROOT, "workloads", "gen.py")
DATA = os.path.join(ROOT, "workloads", "data")
ORACLE = os.path.join(ROOT, "oracle", "gudhi_oracle.py")
RESULTS = os.path.join(HERE, "results")

EXACT = {"full-id", "full-morse", "gudhi", "drb-id", "drb-id-rb", "mmhm", "mmhm-norb"}
MANIFEST_FIELDS = ["exp", "workload", "label", "method", "seed", "instance", "T", "args",
                   "verify_every", "timed", "exit", "wall_s", "started", "cmd", "stderr_tail"]


class Run:
    def __init__(self, exp, inst, meth, seed, T, verify_default=50):
        self.exp = exp
        self.workload = inst["workload"]
        self.label = meth["label"]
        self.method = meth["method"]
        self.seed = seed
        self.instance = inst["stem"].format(seed=seed)
        self.T = T
        self.args = list(meth.get("args", []))
        self.verify_every = int(meth.get("verify_every", inst.get("verify_every", verify_default)))
        self.timed = bool(meth.get("timed", True))
        self.gen = inst["gen"]
        self.gen_T = int(inst.get("gen_T", 2000))
        base = f"{self.workload}__{self.label}__seed{seed}"
        self.outdir = os.path.join(RESULTS, exp)
        self.csv = os.path.join(self.outdir, base + ".csv.gz")
        self.betti = os.path.join(self.outdir, base + ".betti.gz")
        self.key = f"{exp}/{base}"

    @property
    def seq(self):
        return os.path.join(DATA, self.instance + ".seq")

    def done(self):
        return os.path.exists(self.csv) and os.path.exists(self.betti)

    def command(self, tmp_csv, tmp_betti):
        if self.method == "gudhi":
            cmd = [sys.executable, ORACLE, self.seq, "-o", tmp_betti, "--csv", tmp_csv,
                   "--max-updates", str(self.T)]
        else:
            cmd = [ENGINE, "run", "--method", self.method, "--seq", self.seq, "--out", tmp_csv,
                   "--betti-out", tmp_betti, "--max-updates", str(self.T)]
            if self.verify_every > 0:
                cmd += ["--verify-every", str(self.verify_every)]
            cmd += self.args
        return cmd


def load_runs(path, flt=None):
    with open(path, encoding="utf-8") as fh:
        cfg = json.load(fh)
    exp = cfg["exp"]
    runs = []
    for inst in cfg["instances"]:
        for meth in cfg["methods"]:
            w = inst["workload"]
            if "only" in meth and not any(w.startswith(p) for p in meth["only"]):
                continue
            if "skip" in meth and any(w.startswith(p) for p in meth["skip"]):
                continue
            if meth["label"] in inst.get("skip_methods", []):
                continue
            T = int(meth.get("T", cfg.get("T", 2000)))
            T = int(inst.get("T_by_method", {}).get(meth["label"], T))
            seeds = meth.get("seeds", inst.get("seeds", cfg.get("seeds", [0, 1, 2])))
            for s in seeds:
                r = Run(exp, inst, meth, s, T, int(cfg.get("verify_every", 50)))
                if flt and flt not in r.key:
                    continue
                runs.append(r)
    return cfg, runs


def gzip_to(src, dst):
    with open(src, "rb") as fi, gzip.open(dst + ".part", "wb", compresslevel=9) as fo:
        shutil.copyfileobj(fi, fo)
    os.replace(dst + ".part", dst)
    os.remove(src)


class Pipeline:
    def __init__(self, timed_slots, untimed_slots, mixed, dry):
        self.timed_slots = timed_slots
        self.untimed_slots = untimed_slots
        self.mixed = mixed
        self.dry = dry
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.failure = None
        self.done_count = 0
        self.total = 0
        self.t0 = time.time()

    # ---------------------------------------------------------- generation --
    def generate(self, runs, slots):
        need = {}
        for r in runs:
            if not r.done() and not os.path.exists(r.seq):
                need[r.instance] = r
        if not need:
            return
        print(f"[gen] {len(need)} instance(s) to generate", flush=True)

        def gen(r):
            cmd = [sys.executable, GEN] + r.gen + ["-T", str(r.gen_T), "--seed", str(r.seed),
                                                   "--out", os.path.join(DATA, r.instance)]
            if self.dry:
                print("  " + shlex.join(cmd))
                return
            t = time.time()
            p = subprocess.run(cmd, capture_output=True, text=True)
            if p.returncode != 0 or not os.path.exists(r.seq):
                raise SystemExit(f"generation failed: {shlex.join(cmd)}\n{p.stderr[-2000:]}")
            print(f"[gen] {r.instance} ({time.time() - t:.1f} s)", flush=True)

        with ThreadPoolExecutor(max_workers=slots) as ex:
            list(ex.map(gen, need.values()))

    # ----------------------------------------------------------------- run --
    def execute(self, r):
        if self.stop.is_set():
            return
        os.makedirs(r.outdir, exist_ok=True)
        tag = f"{os.getpid()}_{threading.get_ident()}"
        tmp_csv = os.path.join(r.outdir, f".tmp_{tag}.csv")
        tmp_betti = os.path.join(r.outdir, f".tmp_{tag}.betti")
        cmd = r.command(tmp_csv, tmp_betti)
        if self.dry:
            print(("T " if r.timed else "U ") + shlex.join(cmd))
            return
        started = time.strftime("%Y-%m-%dT%H:%M:%S")
        t = time.time()
        p = subprocess.run(cmd, capture_output=True, text=True)
        wall = time.time() - t
        tail = (p.stderr or "").strip().splitlines()[-1:] if p.stderr else []
        row = {"exp": r.exp, "workload": r.workload, "label": r.label, "method": r.method,
               "seed": r.seed, "instance": r.instance, "T": r.T, "args": " ".join(r.args),
               "verify_every": r.verify_every if r.method != "gudhi" else 0,
               "timed": int(r.timed), "exit": p.returncode, "wall_s": f"{wall:.2f}",
               "started": started, "cmd": shlex.join(cmd),
               "stderr_tail": tail[0][:300] if tail else ""}
        if p.returncode == 0:
            gzip_to(tmp_csv, r.csv)
            gzip_to(tmp_betti, r.betti)
        else:
            # keep the failing outputs for inspection
            for f, ext in ((tmp_csv, ".FAILED.csv"), (tmp_betti, ".FAILED.betti")):
                if os.path.exists(f):
                    os.replace(f, r.csv.replace(".csv.gz", ext))
        with self.lock:
            self.append_manifest(r, row)
            self.done_count += 1
            el = time.time() - self.t0
            status = "ok" if p.returncode == 0 else f"EXIT {p.returncode}"
            print(f"[{self.done_count}/{self.total} {el / 60:.1f} min] {r.key} T={r.T} "
                  f"{wall:.1f} s {status}", flush=True)
            if p.returncode != 0 and (r.method in EXACT or p.returncode not in (0,)):
                if self.failure is None:
                    self.failure = (r, cmd, p.returncode, p.stderr[-3000:])
                self.stop.set()

    @staticmethod
    def append_manifest(r, row):
        path = os.path.join(r.outdir, "manifest.csv")
        new = not os.path.exists(path)
        with open(path, "a", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=MANIFEST_FIELDS)
            if new:
                w.writeheader()
            w.writerow(row)

    def run_all(self, runs):
        todo = [r for r in runs if not r.done()]
        skipped = len(runs) - len(todo)
        self.total = len(todo)
        print(f"{len(runs)} runs, {skipped} already done, {len(todo)} to do", flush=True)
        # longest-first within each class keeps the slots busy until the end
        timed = sorted([r for r in todo if r.timed], key=lambda r: -self.cost_hint(r))
        untimed = sorted([r for r in todo if not r.timed], key=lambda r: -self.cost_hint(r))
        if self.mixed:
            with ThreadPoolExecutor(max_workers=self.timed_slots) as et, \
                    ThreadPoolExecutor(max_workers=self.untimed_slots) as eu:
                fs = [et.submit(self.execute, r) for r in timed]
                fs += [eu.submit(self.execute, r) for r in untimed]
                for f in fs:
                    f.result()
        else:
            with ThreadPoolExecutor(max_workers=self.timed_slots) as et:
                for f in [et.submit(self.execute, r) for r in timed]:
                    f.result()
            if not self.stop.is_set():
                with ThreadPoolExecutor(max_workers=self.untimed_slots) as eu:
                    for f in [eu.submit(self.execute, r) for r in untimed]:
                        f.result()
        if self.failure:
            r, cmd, code, err = self.failure
            print("\n=== PIPELINE STOPPED: exact method failed ===", file=sys.stderr)
            print(f"run      : {r.key}", file=sys.stderr)
            print(f"instance : {r.seq}", file=sys.stderr)
            print(f"exit code: {code}", file=sys.stderr)
            print(f"command  : {shlex.join(cmd)}", file=sys.stderr)
            print(err, file=sys.stderr)
            return 3
        return 0

    @staticmethod
    def cost_hint(r):
        try:
            sz = os.path.getsize(r.seq)
        except OSError:
            sz = 1
        w = {"gudhi": 50, "full-morse": 8, "full-id": 3}.get(r.method, 1)
        if r.verify_every == 1:
            w *= 3
        return sz * w * r.T


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("configs", nargs="+")
    ap.add_argument("--timed-slots", type=int, default=2)
    ap.add_argument("--untimed-slots", type=int, default=2)
    ap.add_argument("--gen-slots", type=int, default=4)
    ap.add_argument("--mixed", action="store_true",
                    help="run untimed jobs alongside timed ones (only if no interference)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only-gen", action="store_true")
    ap.add_argument("--filter", help="only runs whose <exp>/<workload>__<label>__seed<k> "
                                     "contains this substring")
    a = ap.parse_args(argv)
    if not os.path.exists(ENGINE):
        raise SystemExit(f"engine binary missing: {ENGINE} (build engine/ in Release first)")
    runs = []
    for c in a.configs:
        _, rs = load_runs(c, a.filter)
        runs += rs
    pl = Pipeline(a.timed_slots, a.untimed_slots, a.mixed, a.dry_run)
    pl.generate(runs, a.gen_slots)
    if a.only_gen:
        return 0
    return pl.run_all(runs)


if __name__ == "__main__":
    sys.exit(main())
