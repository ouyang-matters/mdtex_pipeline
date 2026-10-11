#!/usr/bin/env python3
"""Writes experiments/configs/E*.json (the sweep of experiments/PLAN.md).

The JSON files are the source of truth for run.py; this script only keeps
them consistent (same method lists, same T' rule). Rerun after editing:

  python3 configs/make_configs.py

T' rule (PLAN.md): every method runs T = 2000 updates, except `gudhi` on
instances with |K_0| > 3e5, which runs the prefix T' = 200 (the GUDHI oracle
must cover at least the first 200 updates of every instance and all updates
when |K| <= 3e5; the engine's full-id runs cover all T updates everywhere).
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
T = 2000
T_PREFIX = 200
GUDHI_FULL_LIMIT = 300_000  # gudhi runs all T updates iff |K_0| <= this
SEEDS = [0, 1, 2]

DYN = ["drb-id", "drb-id-rb", "mmhm", "mmhm-norb"]
STATIC = ["full-id", "full-morse", "gudhi"]


def m(label, method=None, **kw):
    d = {"label": label, "method": method or label}
    d.update(kw)
    return d


def inst(workload, gen, stem, K0, **kw):
    d = {"workload": workload, "gen": gen, "stem": stem + "_T2000_seed{seed}", "K0_approx": K0}
    if K0 > GUDHI_FULL_LIMIT:
        d["T_by_method"] = {"gudhi": T_PREFIX}
    d.update(kw)
    return d


def w2(N, s, K0):
    return inst(f"w2_N{N}_s{s}", ["w2", "--N", str(N), "--s", str(s)], f"w2_N{N}_s{s}", K0)


def w3(N, K0, k=2):
    return inst(f"w3_N{N}_k{k}", ["w3", "--N", str(N), "--k", str(k)], f"w3_N{N}_k{k}_c4", K0)


def w4(n, amb, D, K0):
    return inst(f"w4_{amb}d_n{n}_D{D}",
                ["w4", "--n", str(n), "--ambient", str(amb), "--D", str(D)],
                f"w4_{amb}d_n{n}_deg10_D{D}", K0)


def w1s(L, K0):
    return inst(f"w1_sphere_L{L}", ["w1", "--surface", "sphere", "--level", str(L)],
                f"w1_sphere_L{L}_k2_h3", K0)


def w1t(n, K0):
    return inst(f"w1_torus_{n}", ["w1", "--surface", "torus", "--n", str(n), "--m", str(n)],
                f"w1_torus_{n}x{n}_k2_h3", K0)


def w5a(L):
    return inst(f"w5a_L{L}", ["w5a", "--L", str(L)], f"w5a_cycle_L{L}", 2 * L)


def w5b(L):
    K0 = 60 * 4 ** L + 2
    return inst(f"w5b_L{L}", ["w5b", "--level", str(L)], f"w5b_sphere_L{L}", K0)


CONFIGS = {
    "E1": {
        "question": "Does per-update cost depend on global size at fixed edit size? (W2, s = 8)",
        "instances": [w2(7, 8, 10739), w2(10, 8, 28757), w2(15, 8, 92787), w2(22, 8, 286589),
                      w2(33, 8, 955059)],
        "methods": [m(x) for x in STATIC + DYN],
    },
    "E2": {
        "question": "How does cost scale with edit size? (W2, N = 22, s = 1..64; s = 8 is E1's "
                    "N = 22 instance)",
        "instances": [w2(22, s, K) for s, K in
                      [(1, 285805), (2, 285917), (4, 286141), (16, 287485), (32, 289277),
                       (64, 292861)]],
        "methods": [m("full-id"), m("full-morse")] + [m(x) for x in DYN] +
                   [m("gudhi-oracle", "gudhi", timed=False)],
    },
    "E3": {
        "question": "Genuine 3D topology changes (W3 cavities, k = 2)",
        "instances": [w3(14, 74957), w3(20, 215321), w3(27, 525043)],
        "methods": [m(x) for x in STATIC + DYN],
    },
    "E4": {
        "question": "Non-manifold, all Betti numbers vary (W4 truncated flag complexes)",
        "instances": [w4(1000, 2, 2, 16081), w4(4000, 2, 2, 63911), w4(16000, 2, 2, 254203),
                      w4(1000, 2, 3, 28413), w4(4000, 2, 3, 111763),
                      w4(1000, 3, 3, 22803), w4(4000, 3, 3, 85207)],
        "methods": [m(x) for x in STATIC + DYN],
    },
    "E5": {
        "question": "Surfaces: algebra vs combinatorial invariants (W1)",
        "instances": [w1s(4, 15362), w1s(5, 61442), w1s(6, 245762), w1s(7, 983042),
                      w1t(64, 24576), w1t(128, 98304), w1t(256, 393216), w1t(500, 1500000)],
        "methods": [m(x) for x in STATIC + DYN] + [m("euler")],
    },
    "E6": {
        "question": "Where locality fails (W5a cycle toggle, W5b sphere puncture toggle)",
        "instances": [w5a(L) for L in (1000, 3000, 10000, 30000, 100000, 300000, 1000000)] +
                     [w5b(L) for L in (3, 4, 5, 6, 7, 8)],
        "methods": [m("full-id"), m("gudhi")] + [m(x) for x in DYN] + [m("euler", only=["w5b"])],
    },
}

# E7: rebuild policy sensitivity, mmhm vs drb-id-rb, one size per workload.
E7_ALPHA = ["0.25", "0.5", "1", "2", "4", "off"]
E7_PERIOD = ["off", "64", "256"]
CONFIGS["E7"] = {
    "question": "Does rebuilding help or hurt, and does the Morse order at rebuild help? "
                "alpha x period grid for mmhm and drb-id-rb (alpha = off, period = off is "
                "mmhm-norb resp. drb-id)",
    "instances": [w2(22, 8, 286589), w3(20, 215321), w4(16000, 2, 2, 254203)],
    "methods": [m(f"{meth}_a{a}_p{p}", meth, args=["--alpha", a, "--period", p])
                for meth in ("mmhm", "drb-id-rb") for a in E7_ALPHA for p in E7_PERIOD],
}

# E0 (lcr part): v1's rule with verification after every update, untimed.
CONFIGS["E0"] = {
    "question": "How wrong is v1's rule? lcr with --verify-every 1 on mid-size instances",
    "instances": [w1s(5, 61442), w1t(128, 98304), w2(15, 8, 92787), w3(14, 74957),
                  w4(4000, 2, 2, 63911), w4(4000, 2, 3, 111763), w4(4000, 3, 3, 85207),
                  w5a(10000), w5b(5)],
    "methods": [m("lcr", verify_every=1, timed=False)],
}


def main():
    for exp, c in CONFIGS.items():
        cfg = {"exp": exp, "question": c["question"], "T": T, "seeds": SEEDS,
               "verify_every": 50, "instances": c["instances"], "methods": c["methods"]}
        path = os.path.join(HERE, f"{exp}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh, indent=1)
            fh.write("\n")
        n = sum(len(SEEDS) for i in c["instances"] for mm in c["methods"]
                if "only" not in mm or any(i["workload"].startswith(p) for p in mm["only"]))
        print(f"{path}: {len(c['instances'])} instances x {len(c['methods'])} methods -> {n} runs")


if __name__ == "__main__":
    main()
