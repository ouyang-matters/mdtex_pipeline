#!/usr/bin/env python3
"""Reproducibility records for the sweep (review M14).

Writes
  results/WORKLOADS_MANIFEST.csv  one row per workload instance used by
      configs/E*.json and noise.py: the exact generator command, seed,
      generator version, SHA-256 of the .seq (recomputed from the file and
      checked against the generator's .meta.json), size, |K_0|, updates.
  results/ENGINE.txt  the engine build the sweep ran: git commit and tree of
      engine/, binary SHA-256, compiler flags.

The workload files themselves (workloads/data/, ~1.4 GB) are git-ignored; the
commands below regenerate them byte for byte (the generators are
deterministic), and the hashes let anyone check that they did.

  python3 workloads_manifest.py [--no-hash]
"""

from __future__ import annotations

import argparse
import csv
import glob
import hashlib
import json
import os
import shlex
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run as runner  # noqa: E402

ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "workloads", "data")
RES = os.path.join(HERE, "results")

# The sweep's engine binary was built at 2026-10-11 03:54:47 UTC from sources
# that are unchanged since and first committed in a584eec (engine/ tree
# 27c02a6...). Recorded here because the run manifests predate this record.
SWEEP_ENGINE_COMMIT = "a584eec"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git(*args):
    try:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True,
                              check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-hash", action="store_true", help="skip recomputing the SHA-256")
    a = ap.parse_args(argv)
    inst = {}
    for cfg in sorted(glob.glob(os.path.join(HERE, "configs", "E*.json"))):
        _, rs = runner.load_runs(cfg)
        for r in rs:
            inst.setdefault(r.instance, r)
    # noise.py's extra instances use the same generator commands as the sweep
    rows, bad = [], []
    for name, r in sorted(inst.items()):
        meta_p = os.path.join(DATA, name + ".meta.json")
        seq_p = os.path.join(DATA, name + ".seq")
        cmd = ["python3", "workloads/gen.py"] + r.gen + ["-T", str(r.gen_T), "--seed",
                                                          str(r.seed), "--out",
                                                          f"workloads/data/{name}"]
        row = {"instance": name, "workload": r.workload, "seed": r.seed,
               "generator_command": shlex.join(cmd)}
        if os.path.exists(meta_p):
            with open(meta_p, encoding="utf-8") as fh:
                meta = json.load(fh)
            row.update(generator_version=meta.get("generator_version", ""),
                       seq_sha256=meta.get("seq_sha256", ""), seq_bytes=meta.get("seq_bytes", ""),
                       K0=meta["sizes"]["start"]["total"], updates=meta.get("n_updates", ""),
                       expected_betti=int(bool(meta.get("expected_betti"))))
            if not a.no_hash and os.path.exists(seq_p):
                h = sha256(seq_p)
                row["sha256_checked"] = int(h == row["seq_sha256"])
                if h != row["seq_sha256"]:
                    bad.append(name)
        else:
            row["generator_version"] = "MISSING (regenerate)"
        rows.append(row)
    fields = ["instance", "workload", "seed", "generator_version", "seq_sha256",
              "sha256_checked", "seq_bytes", "K0", "updates", "expected_betti",
              "generator_command"]
    out = os.path.join(RES, "WORKLOADS_MANIFEST.csv")
    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    eng = os.path.join(ROOT, "engine", "build-release", "mmhm")
    tree = git("rev-parse", f"{SWEEP_ENGINE_COMMIT}:research/mmhm/engine")
    head_tree = git("rev-parse", "HEAD:research/mmhm/engine")
    dirty = git("status", "--short", "--", "engine")
    with open(os.path.join(RES, "ENGINE.txt"), "w", encoding="utf-8") as fh:
        fh.write(
            "Engine used for every run in results/E0..E7, noise/ and rerun/\n"
            f"commit containing the sources: {SWEEP_ENGINE_COMMIT} "
            f"({git('log', '-1', '--format=%H %cI %s', SWEEP_ENGINE_COMMIT)})\n"
            f"engine/ git tree at that commit: {tree}\n"
            f"engine/ git tree at HEAD now:    {head_tree} "
            f"({'identical' if tree == head_tree else 'DIFFERENT'})\n"
            f"working-tree changes under engine/ now: {dirty or 'none'}\n"
            f"binary build-release/mmhm sha256: {sha256(eng) if os.path.exists(eng) else 'n/a'}\n"
            "build: cmake -S engine -B engine/build-release -DCMAKE_BUILD_TYPE=Release "
            "(-O2 -DNDEBUG, g++ 13.3.0); built 2026-10-11 03:54:47 UTC, before the sweep "
            "started (04:04 UTC); sources unchanged since.\n")
    print(f"wrote {out} ({len(rows)} instances) and results/ENGINE.txt")
    if bad:
        print(f"ERROR: SHA-256 mismatch for {bad}", file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    main()
