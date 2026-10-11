#!/usr/bin/env python3
"""Regenerate the committed samples in workloads/samples/.

For each sample: <name>.seq, <name>.meta.json, <name>.expected.betti (when
analytic), and <name>.betti = the GUDHI oracle's Betti file. The meta of a
sample omits `gen_time_s`, so regenerating reproduces every file byte for
byte. Each sample is also validated, checked against its analytic expectation and against the
brute-force Z2 computation on every state; any disagreement aborts.

  python3 make_samples.py            # all samples
  python3 make_samples.py w2 w4_2d   # selected ones
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "oracle"))

import bruteforce_z2  # noqa: E402
import gudhi_oracle  # noqa: E402
import validate_seq  # noqa: E402
import w1_surfaces  # noqa: E402
import w2_refine  # noqa: E402
import w3_cavities  # noqa: E402
import w4_pointcloud  # noqa: E402
import w5_witness  # noqa: E402

OUT = os.path.join(HERE, "samples")

SAMPLES = {
    "w1_sphere_L3": (w1_surfaces.generate,
                     dict(surface="sphere", level=3, k=2, target_holes=3, updates=120, seed=1)),
    "w1_torus_16x16": (w1_surfaces.generate,
                       dict(surface="torus", n=16, m=16, k=2, target_holes=3, updates=120, seed=1)),
    "w2_N4_s4": (w2_refine.generate, dict(N=4, s=4, updates=120, seed=1)),
    "w3_N7_k1": (w3_cavities.generate, dict(N=7, k=1, target_cavities=3, updates=60, seed=9)),
    "w4_2d_n200": (w4_pointcloud.generate,
                   dict(n=200, ambient=2, degree=8, D=2, updates=150, seed=1)),
    "w4_3d_n120_D3": (w4_pointcloud.generate,
                      dict(n=120, ambient=3, degree=8, D=3, updates=60, seed=1)),
    "w5a_cycle_L200": (w5_witness.generate_cycle, dict(L=200, updates=100, seed=1)),
    "w5b_sphere_L2": (w5_witness.generate_sphere, dict(level=2, updates=100, seed=1)),
}


def make(name):
    fn, kw = SAMPLES[name]
    stem = os.path.join(OUT, name)
    meta = fn(stem, check=True, **kw)
    # samples must regenerate byte-identically: drop the only volatile field
    meta.pop("gen_time_s", None)
    with open(stem + ".meta.json", "w", encoding="utf-8", newline="\n") as fh:
        json.dump(meta, fh, indent=1)
        fh.write("\n")
    rep = validate_seq.validate(stem + ".seq")
    g, _ = gudhi_oracle.run(stem + ".seq", betti_out=stem + ".betti")
    exp_file = stem + ".expected.betti"
    if meta["expected_betti"]:
        exp = gudhi_oracle.read_betti(exp_file)
        bad = [t for t, (a, b) in enumerate(zip(g, exp)) if a != b]
        if bad or len(exp) != len(g):
            raise SystemExit(f"{name}: GUDHI disagrees with analytic Betti at states {bad[:5]}")
    brute = bruteforce_z2.replay(stem + ".seq")
    if brute != g:
        bad = [t for t, (a, b) in enumerate(zip(g, brute)) if a != b]
        raise SystemExit(f"{name}: GUDHI disagrees with brute force at states {bad[:5]}")
    sizes = {ext: os.path.getsize(stem + ext) for ext in
             (".seq", ".meta.json", ".betti", ".expected.betti") if os.path.exists(stem + ext)}
    print(json.dumps({"sample": name, "updates": rep["updates"],
                      "K0": meta["sizes"]["start"]["total"],
                      "ops_mean": round(meta["ops"]["per_update_mean"], 1),
                      "distinct_betti": len({tuple(b) for b in g}),
                      "bytes": sizes}), flush=True)


def main(argv):
    os.makedirs(OUT, exist_ok=True)
    names = argv or list(SAMPLES)
    for n in names:
        make(n)


if __name__ == "__main__":
    main(sys.argv[1:])
