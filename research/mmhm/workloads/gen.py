#!/usr/bin/env python3
"""MMHM workload generators (SPEC section 6) — command line.

Each subcommand writes <stem>.seq, <stem>.meta.json and, where the Betti
numbers are known analytically, <stem>.expected.betti. Without --out the stem
is workloads/data/<auto-name>. Output is a deterministic function of the
arguments (including --seed); only `gen_time_s` in the meta varies.

Examples
  python3 gen.py w1 --surface sphere --level 5 --updates 1000 --seed 1
  python3 gen.py w1 --surface torus --n 100 --m 100 --updates 1000
  python3 gen.py w2 --N 20 --s 8 --updates 2000
  python3 gen.py w3 --N 16 --k 2 --target 4 --updates 1000
  python3 gen.py w4 --n 4000 --ambient 2 --degree 10 --D 2 --updates 2000
  python3 gen.py w5a --L 100000 --updates 1000
  python3 gen.py w5b --level 7 --updates 1000
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import w1_surfaces  # noqa: E402
import w2_refine  # noqa: E402
import w3_cavities  # noqa: E402
import w4_pointcloud  # noqa: E402
import w5_witness  # noqa: E402

DATA = os.path.join(HERE, "data")


def _stem(args, auto):
    if args.out:
        return args.out[:-4] if args.out.endswith(".seq") else args.out
    return os.path.join(DATA, auto)


def run(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, T=1000):
        p.add_argument("--updates", "-T", type=int, default=T, help="number of UPDATE blocks")
        p.add_argument("--seed", type=int, default=0)
        p.add_argument("--out", help="output stem (or .seq path); default data/<auto-name>")
        p.add_argument("--check", action="store_true",
                       help="validate every edit while generating (slower)")

    p = sub.add_parser("w1", help="punctured surfaces")
    p.add_argument("--surface", choices=["sphere", "torus"], required=True)
    p.add_argument("--level", type=int, help="sphere: icosphere level L (freq = 2^L)")
    p.add_argument("--freq", type=int, help="sphere: geodesic frequency f (20 f^2 triangles)")
    p.add_argument("--n", type=int, help="torus: grid rows (>= 3)")
    p.add_argument("--m", type=int, help="torus: grid columns (>= 3)")
    p.add_argument("--k", type=int, default=2, help="patch radius (k-ring umbrella)")
    p.add_argument("--sep", type=int, default=1, help="min separation (rings) between holes")
    p.add_argument("--target", type=int, default=3, help="target number of holes")
    common(p)

    p = sub.add_parser("w2", help="refine/coarsen in a 3-ball")
    p.add_argument("--N", type=int, required=True, help="grid of N^3 cubes")
    p.add_argument("--s", type=int, default=8, help="subdivisions (or inverses) per update")
    p.add_argument("--warmup", type=int, help="live subdivisions in K_0 (default 8 s)")
    p.add_argument("--spread", type=int, help="mean-reversion scale (default = warmup)")
    common(p)

    p = sub.add_parser("w3", help="cavities in a 3-ball")
    p.add_argument("--N", type=int, required=True, help="grid of N^3 cubes")
    p.add_argument("--k", type=int, default=2, help="ball radius (k-ring)")
    p.add_argument("--sep", type=int, default=1, help="min separation (rings) between balls")
    p.add_argument("--target", type=int, default=4, help="target number of carved balls")
    common(p)

    p = sub.add_parser("w4", help="moving point cloud flag complex")
    p.add_argument("--n", type=int, required=True, help="number of points")
    p.add_argument("--ambient", type=int, choices=[2, 3], default=2)
    p.add_argument("--degree", type=float, default=10.0, help="target mean degree")
    p.add_argument("--D", type=int, default=2, help="max simplex dimension of the flag complex")
    p.add_argument("--step", type=float, default=0.25,
                   help="max per-coordinate displacement, in units of eps")
    common(p)

    p = sub.add_parser("w5a", help="cycle graph with one toggled edge")
    p.add_argument("--L", type=int, required=True)
    p.add_argument("--edge", type=int, default=0, help="toggle edge {e, e+1 mod L}")
    common(p)

    p = sub.add_parser("w5b", help="icosphere with one toggled triangle")
    p.add_argument("--level", type=int)
    p.add_argument("--freq", type=int)
    common(p)

    a = ap.parse_args(argv)
    T, seed = a.updates, a.seed
    if a.cmd == "w1":
        if a.surface == "sphere":
            size = f"L{a.level}" if a.freq is None else f"f{a.freq}"
        else:
            size = f"{a.n}x{a.m}"
        stem = _stem(a, f"w1_{a.surface}_{size}_k{a.k}_h{a.target}_T{T}_seed{seed}")
        meta = w1_surfaces.generate(stem, surface=a.surface, level=a.level, freq=a.freq,
                                    n=a.n, m=a.m, k=a.k, sep=a.sep, target_holes=a.target,
                                    updates=T, seed=seed, check=a.check)
    elif a.cmd == "w2":
        stem = _stem(a, f"w2_N{a.N}_s{a.s}_T{T}_seed{seed}")
        meta = w2_refine.generate(stem, N=a.N, s=a.s, warmup=a.warmup, spread=a.spread,
                                  updates=T, seed=seed, check=a.check)
    elif a.cmd == "w3":
        stem = _stem(a, f"w3_N{a.N}_k{a.k}_c{a.target}_T{T}_seed{seed}")
        meta = w3_cavities.generate(stem, N=a.N, k=a.k, sep=a.sep, target_cavities=a.target,
                                    updates=T, seed=seed, check=a.check)
    elif a.cmd == "w4":
        stem = _stem(a, f"w4_{a.ambient}d_n{a.n}_deg{a.degree:g}_D{a.D}_T{T}_seed{seed}")
        meta = w4_pointcloud.generate(stem, n=a.n, ambient=a.ambient, degree=a.degree, D=a.D,
                                      step=a.step, updates=T, seed=seed, check=a.check)
    elif a.cmd == "w5a":
        stem = _stem(a, f"w5a_cycle_L{a.L}_T{T}_seed{seed}")
        meta = w5_witness.generate_cycle(stem, L=a.L, edge=a.edge, updates=T, seed=seed,
                                         check=a.check)
    else:
        size = f"L{a.level}" if a.freq is None else f"f{a.freq}"
        stem = _stem(a, f"w5b_sphere_{size}_T{T}_seed{seed}")
        meta = w5_witness.generate_sphere(stem, level=a.level, freq=a.freq, updates=T,
                                          seed=seed, check=a.check)
    summary = {
        "seq": stem + ".seq",
        "start": meta["sizes"]["start"],
        "max_total": meta["sizes"]["max"]["total"],
        "ops": meta["ops"],
        "gen_time_s": meta["gen_time_s"],
    }
    print(json.dumps(summary))
    return meta


if __name__ == "__main__":
    run()
