#!/usr/bin/env python3
"""Tests for the workload generators, the validator and the GUDHI oracle.

Run:  python3 test_workloads.py          (plain runner, no dependencies)
      python3 -m pytest test_workloads.py (if pytest is installed)

What is checked
  * the brute-force GF(2) rank (numpy) agrees with an independent integer
    bitset elimination, and gives the textbook Z2 Betti numbers of known
    complexes (RP^2, torus, Klein bottle, spheres, isolated vertices, ...);
  * GUDHI (as configured in oracle/gudhi_oracle.py) agrees with brute force on
    those complexes and on random valid edit sequences up to dimension 3 with
    deletions (remove_maximal_simplex), and the two GUDHI settings the oracle
    depends on (persistence_dim_max=True, field 2) are really needed;
  * the validator accepts every generated file and rejects malformed ones;
  * every generator at small size: validator passes, GUDHI Betti numbers equal
    the analytic expectations after every update (W1, W2, W3, W5), brute force
    equals GUDHI (all workloads, W4 included), output is deterministic in the
    seed, and the W2 size stays bounded.
"""

from __future__ import annotations

import os
import random
import shutil
import sys
import tempfile
import time
from itertools import combinations

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "oracle"))

import gudhi  # noqa: E402

import bruteforce_z2 as bf  # noqa: E402
import gudhi_oracle  # noqa: E402
import validate_seq  # noqa: E402
import w1_surfaces  # noqa: E402
import w2_refine  # noqa: E402
import w3_cavities  # noqa: E402
import w4_pointcloud  # noqa: E402
import w5_witness  # noqa: E402
from meshes import closure, freudenthal, icosphere, torus_grid  # noqa: E402

TMP = tempfile.mkdtemp(prefix="mmhm_wl_test_")


def faces_of(tops):
    return [s for g in closure(tops) for s in g]


def gudhi_betti(simplices):
    st = gudhi.SimplexTree()
    for s in sorted(simplices, key=len):
        st.insert(list(s), 0.0)
    return gudhi_oracle.betti4(st)


RP2 = [(0, 1, 2), (0, 2, 3), (0, 3, 4), (0, 4, 5), (0, 1, 5),
       (1, 2, 4), (2, 3, 5), (1, 3, 4), (1, 3, 5), (2, 4, 5)]


def klein_bottle(n=4, m=4):
    """n x m grid with a flip in the identification of one direction."""
    def v(i, j):
        if i >= n:
            i -= n
            j = (m - j) % m
        return i * m + (j % m)
    tris = []
    for i in range(n):
        for j in range(m):
            a, b, c, d = v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)
            tris.append(tuple(sorted((a, b, c))))
            tris.append(tuple(sorted((a, c, d))))
    return tris


KNOWN = {
    # name: (simplices, Z2 betti)
    "empty": ([], [0, 0, 0, 0]),
    "3 isolated vertices": ([(0,), (1,), (2,)], [3, 0, 0, 0]),
    "triangle boundary + isolated vertex": (faces_of([(0, 1), (1, 2), (0, 2)]) + [(7,)],
                                            [2, 1, 0, 0]),
    "solid triangle + 2 isolated": (faces_of([(0, 1, 2)]) + [(5,), (6,)], [3, 0, 0, 0]),
    "solid tetrahedron": (faces_of([(0, 1, 2, 3)]), [1, 0, 0, 0]),
    "hollow tetrahedron (S2)": (faces_of(list(combinations(range(4), 3))), [1, 0, 1, 0]),
    "boundary of 4-simplex (S3)": (faces_of(list(combinations(range(5), 4))), [1, 0, 0, 1]),
    "S3 + isolated vertex": (faces_of(list(combinations(range(5), 4))) + [(9,)], [2, 0, 0, 1]),
    "RP2 (6 vertices)": (faces_of(RP2), [1, 1, 1, 0]),
    "torus 3x3": (faces_of(torus_grid(3, 3)[1]), [1, 2, 1, 0]),
    "torus 4x5": (faces_of(torus_grid(4, 5)[1]), [1, 2, 1, 0]),
    "Klein bottle": (faces_of(klein_bottle(4, 4)), [1, 2, 1, 0]),
    "icosahedron": (faces_of(icosphere(1)[1]), [1, 0, 1, 0]),
    "cube N=2 Freudenthal": (faces_of(freudenthal(2)[2]), [1, 0, 0, 0]),
    "two disjoint hollow tets": (faces_of(list(combinations(range(4), 3))
                                          + list(combinations(range(10, 14), 3))),
                                 [2, 0, 2, 0]),
}


# ------------------------------------------------------------ brute force

def _rank_bitset(M):
    rows = [int("".join("1" if x else "0" for x in r), 2) if len(r) else 0 for r in M]
    basis = {}
    r = 0
    for x in rows:
        while x:
            h = x.bit_length() - 1
            if h in basis:
                x ^= basis[h]
            else:
                basis[h] = x
                r += 1
                break
    return r


def test_gf2_rank_matches_bitset_elimination():
    rng = np.random.default_rng(1)
    for _ in range(200):
        m, n = rng.integers(0, 40, size=2)
        p = rng.uniform(0.02, 0.6)
        M = rng.random((m, n)) < p
        assert bf.gf2_rank(M) == _rank_bitset(M.tolist()), (m, n)
    assert bf.gf2_rank(np.eye(17, dtype=bool)) == 17
    assert bf.gf2_rank(np.ones((5, 9), dtype=bool)) == 1


def test_bruteforce_known_complexes():
    for name, (cx, want) in KNOWN.items():
        got = bf.betti_z2(cx)
        assert got == want, f"{name}: brute force {got} != {want}"


# ------------------------------------------------------------------ GUDHI

def test_gudhi_known_complexes():
    for name, (cx, want) in KNOWN.items():
        got = gudhi_betti(cx)
        assert got == want, f"{name}: gudhi {got} != {want}"


def test_gudhi_settings_are_necessary():
    # top dimension is dropped without persistence_dim_max=True
    st = gudhi.SimplexTree()
    for s in combinations(range(4), 3):
        st.insert(list(s), 0.0)
    st.compute_persistence(homology_coeff_field=2)
    assert st.betti_numbers() == [1, 0], st.betti_numbers()
    st = gudhi.SimplexTree()
    for v in range(3):
        st.insert([v], 0.0)
    st.compute_persistence(homology_coeff_field=2)
    assert st.betti_numbers() == [], st.betti_numbers()
    # the field matters: RP^2 over Z11 has beta = (1,0,0)
    st = gudhi.SimplexTree()
    for s in RP2:
        st.insert(list(s), 0.0)
    st.compute_persistence(homology_coeff_field=11, persistence_dim_max=True)
    assert st.betti_numbers() == [1, 0, 0]
    assert gudhi_betti(faces_of(RP2)) == [1, 1, 1, 0]


def random_edit_seq(path, rng, nverts=8, D=3, updates=40):
    """Random closure-valid edit sequence; returns list of states (sets)."""
    K = set()
    states = []
    lines = ["MMHMSEQ 1", f"dim {D}", "# random edit sequence", "INIT"]

    def cofaces_present(s):
        return any(len(t) == len(s) + 1 and set(s) < set(t) for t in K)

    def random_insertable():
        cands = [(v,) for v in range(nverts) if (v,) not in K]
        for k in range(2, D + 2):
            for s in combinations(range(nverts), k):
                if s not in K and all(s[:i] + s[i + 1:] in K for i in range(k)):
                    cands.append(s)
        return cands

    def random_deletable():
        return [s for s in K if not cofaces_present(s)]

    for _ in range(rng.randint(10, 40)):
        c = random_insertable()
        if not c:
            break
        s = rng.choice(c)
        K.add(s)
        lines.append("+ " + " ".join(map(str, s)))
    lines.append("END")
    states.append(set(K))
    for _ in range(updates):
        lines.append("UPDATE")
        for _ in range(rng.randint(1, 6)):
            if K and rng.random() < 0.5:
                s = rng.choice(sorted(random_deletable()))
                K.remove(s)
                lines.append("- " + " ".join(map(str, s)))
            else:
                c = random_insertable()
                if not c:
                    continue
                # prefer higher-dimensional insertions so topology changes
                s = rng.choice(sorted(c, key=len)[len(c) // 3:] or c)
                K.add(s)
                lines.append("+ " + " ".join(map(str, s)))
        if lines[-1] == "UPDATE":
            v = max([x for s in K for x in s], default=-1) + 1
            K.add((v,))
            lines.append(f"+ {v}")
        lines.append("END")
        states.append(set(K))
    with open(path, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    return states


def test_gudhi_vs_bruteforce_random_edit_sequences():
    rng = random.Random(7)
    nstates = 0
    for i in range(25):
        p = os.path.join(TMP, f"rand{i}.seq")
        states = random_edit_seq(p, rng, nverts=rng.randint(5, 8), D=rng.choice([1, 2, 3]))
        validate_seq.validate(p)
        g, _ = gudhi_oracle.run(p)
        want = [bf.betti_z2(K) for K in states]
        assert g == want, f"{p}: gudhi {g} != brute {want}"
        assert bf.replay(p) == want
        nstates += len(states)
    assert nstates > 500


def test_gudhi_vs_bruteforce_dimension3_toggles():
    """Top-dimensional (beta_3) changes through deletions and reinsertions on
    S^3 = boundary of the 4-simplex, plus lower-dimensional surgery."""
    tets = list(combinations(range(5), 4))
    lines = ["MMHMSEQ 1", "dim 3", "INIT"]
    lines += ["+ " + " ".join(map(str, s)) for s in faces_of(tets)]
    lines.append("END")
    t0, t1 = tets[0], tets[1]
    tri = tuple(sorted(set(t0) & set(t1)))
    edge = tri[:2]
    steps = [
        ["- " + " ".join(map(str, t0))],                       # 3-ball
        ["+ " + " ".join(map(str, t0))],                       # S^3 again
        ["- " + " ".join(map(str, t0)), "- " + " ".join(map(str, t1)),
         "- " + " ".join(map(str, tri))],                      # remove a shared triangle
        ["+ " + " ".join(map(str, tri)), "+ " + " ".join(map(str, t1))],
        ["+ 9", "+ 8", "+ 8 9"],                               # extra component
        ["- " + " ".join(map(str, t)) for t in tets[1:]],      # strip all tets
        ["- " + " ".join(map(str, f)) for f in combinations(range(5), 3)
         if set(edge) <= set(f)],                              # open the 2-skeleton
        ["- " + " ".join(map(str, edge))],
    ]
    for st in steps:
        lines += ["UPDATE"] + st + ["END"]
    p = _write("s3.seq", "\n".join(lines) + "\n")
    validate_seq.validate(p)
    g, _ = gudhi_oracle.run(p)
    assert g == bf.replay(p), (g, bf.replay(p))
    assert g == [[1, 0, 0, 1], [1, 0, 0, 0], [1, 0, 0, 1], [1, 0, 0, 0], [1, 0, 0, 0],
                 [2, 0, 0, 0], [2, 0, 4, 0], [2, 1, 2, 0], [2, 0, 2, 0]], g


# -------------------------------------------------------------- validator

def _write(name, text):
    p = os.path.join(TMP, name)
    with open(p, "w") as fh:
        fh.write(text)
    return p


def test_validator_rejects_bad_files():
    good = "MMHMSEQ 1\ndim 2\n# c\nINIT\n+ 0\n+ 1\n+ 2\n+ 0 1\n+ 1 2\n+ 0 2\nEND\n" \
           "UPDATE\n+ 2 1 0\nEND\nUPDATE\n- 0 1 2\n- 0 2\nEND\n"
    validate_seq.validate(_write("good.seq", good))
    commented = good.replace("dim 2", "dim 2   # max dimension").replace(
        "+ 0 1\n", "+ 0 1 # an edge\n\n  # indented comment\n")
    assert validate_seq.validate(_write("comm.seq", commented))["init_ops"] == 6
    assert gudhi_oracle.run(_write("comm.seq", commented))[0] == \
        gudhi_oracle.run(_write("good.seq", good))[0]
    bad = {
        "missing facet": good.replace("+ 2 1 0", "+ 0 1 3"),
        "insert present": good.replace("+ 2 1 0", "+ 0 1"),
        "delete with coface": good.replace("- 0 1 2\n- 0 2", "- 0 2"),
        "delete absent": good.replace("- 0 1 2\n- 0 2", "- 0 1 2\n- 0 1 2"),
        "repeated vertex": good.replace("+ 2 1 0", "+ 1 1 2"),
        "dim above D": good.replace("dim 2", "dim 1"),
        "D above 3": good.replace("dim 2", "dim 4"),
        "no header": good.replace("MMHMSEQ 1\n", ""),
        "unterminated": good[: good.rindex("END")],
        "edit outside block": good + "+ 9\n",
        "update before init": "MMHMSEQ 1\ndim 1\nUPDATE\n+ 0\nEND\n",
        "negative vertex": good.replace("+ 2 1 0", "+ -1"),
        "vertex >= 2^32": good.replace("+ 2 1 0", f"+ {1 << 32}"),
        "two INIT": good + "INIT\nEND\n",
    }
    for name, text in bad.items():
        p = _write("bad.seq", text)
        try:
            validate_seq.validate(p)
        except (validate_seq.SeqError, ValueError):
            continue
        raise AssertionError(f"validator accepted: {name}")


# -------------------------------------------------------------- generators

def _check_instance(stem, meta, expect_analytic, brute_every=1):
    seq = stem + ".seq"
    rep = validate_seq.validate(seq)
    assert rep["updates"] == meta["n_updates"]
    assert rep["final"] == {k: meta["sizes"]["end"][k] for k in ("n0", "n1", "n2", "n3")}
    assert rep["update_ops_max"] == meta["ops"]["per_update_max"]
    g, _ = gudhi_oracle.run(seq, betti_out=stem + ".betti")
    if expect_analytic:
        exp = gudhi_oracle.read_betti(stem + ".expected.betti")
        assert len(exp) == len(g)
        for t, (a, b) in enumerate(zip(g, exp)):
            assert a == b, f"{stem}: state {t}: gudhi {a} != analytic {b}"
    # brute force on (a subset of) the states
    states = bf.replay(seq)
    for t in range(0, len(g), brute_every):
        assert states[t] == g[t], f"{stem}: state {t}: brute {states[t]} != gudhi {g[t]}"
    assert states[-1] == g[-1]
    return g


def test_base_meshes():
    for L in range(4):
        nv, tris = icosphere(2 ** L)
        assert gudhi_betti(faces_of(tris)) == [1, 0, 1, 0]
    for f in (3, 5):
        assert gudhi_betti(faces_of(icosphere(f)[1])) == [1, 0, 1, 0]
    for n, m in ((3, 3), (3, 7), (6, 4)):
        assert gudhi_betti(faces_of(torus_grid(n, m)[1])) == [1, 2, 1, 0]
    for N in (1, 2, 4):
        assert gudhi_betti(faces_of(freudenthal(N)[2])) == [1, 0, 0, 0]


def test_w1_sphere():
    stem = os.path.join(TMP, "w1s")
    meta = w1_surfaces.generate(stem, "sphere", level=3, k=2, target_holes=3, updates=150,
                                seed=3, check=True)
    g = _check_instance(stem, meta, True, brute_every=10)
    seen_h = {(b[1], b[2]) for b in g}
    assert (0, 1) in seen_h and (0, 0) in seen_h and any(b1 >= 2 for b1, _ in seen_h), seen_h


def test_w1_torus():
    stem = os.path.join(TMP, "w1t")
    meta = w1_surfaces.generate(stem, "torus", n=14, m=12, k=1, target_holes=3, updates=150,
                                seed=4, check=True)
    g = _check_instance(stem, meta, True, brute_every=10)
    b1s = {b[1] for b in g}
    assert {2, 3}.issubset(b1s) and any(b[2] == 1 for b in g) and any(b[2] == 0 for b in g)


def test_w1_frequency_sphere():
    stem = os.path.join(TMP, "w1f")
    meta = w1_surfaces.generate(stem, "sphere", freq=5, k=1, target_holes=2, updates=60,
                                seed=5, check=True)
    _check_instance(stem, meta, True, brute_every=6)


def test_w2():
    stem = os.path.join(TMP, "w2")
    meta = w2_refine.generate(stem, N=3, s=4, updates=120, seed=6, check=True)
    _check_instance(stem, meta, True, brute_every=4)
    st = meta["stats"]
    assert st["refine_updates"] > 20 and st["coarsen_updates"] > 20
    assert st["nested_subdivisions"] > 0


def test_w2_size_is_bounded():
    s, T = 4, 3000
    stem = os.path.join(TMP, "w2long")
    meta = w2_refine.generate(stem, N=4, s=s, updates=T, seed=8)
    sz = meta["sizes"]
    start = sz["start"]["total"]
    # linear growth would add 14 s T = 168000 simplices
    assert sz["max"]["total"] - start < 14 * s * 40, sz
    assert start - sz["min"]["total"] < 14 * s * 40, sz
    assert abs(sz["end"]["total"] - start) < 14 * s * 40, sz
    series = sz["total_series"]
    half = len(series) // 2
    assert abs(np.mean(series[half:]) - np.mean(series[:half])) < 14 * s * 10


def test_w3():
    stem = os.path.join(TMP, "w3")
    meta = w3_cavities.generate(stem, N=7, k=1, target_cavities=3, updates=100, seed=9,
                                check=True)
    g = _check_instance(stem, meta, True, brute_every=20)
    st = meta["stats"]
    assert st.get("carve_cavity", 0) > 0 and st.get("carve_dent", 0) > 0, st
    assert max(b[2] for b in g) >= 2


def test_w3_k2():
    stem = os.path.join(TMP, "w3k2")
    meta = w3_cavities.generate(stem, N=8, k=2, target_cavities=2, updates=40, seed=10,
                                check=True)
    _check_instance(stem, meta, True, brute_every=20)


def test_w4_2d():
    stem = os.path.join(TMP, "w4")
    meta = w4_pointcloud.generate(stem, n=150, ambient=2, degree=8, D=2, updates=80,
                                  seed=11, check=True)
    g = _check_instance(stem, meta, False, brute_every=4)
    assert len({tuple(b) for b in g}) > 5
    assert abs(meta["stats"]["mean_degree_initial"] - 8) < 1e-9


def test_w4_3d():
    stem = os.path.join(TMP, "w4c")
    meta = w4_pointcloud.generate(stem, n=120, ambient=3, degree=8, D=3, updates=60,
                                  seed=12, check=True)
    _check_instance(stem, meta, False, brute_every=6)


def test_w5():
    stem = os.path.join(TMP, "w5a")
    meta = w5_witness.generate_cycle(stem, L=50, updates=20, check=True)
    g = _check_instance(stem, meta, True)
    assert g[0] == [1, 1, 0, 0] and g[1] == [1, 0, 0, 0] and g[2] == [1, 1, 0, 0]
    stem = os.path.join(TMP, "w5b")
    meta = w5_witness.generate_sphere(stem, level=2, updates=20, seed=1, check=True)
    g = _check_instance(stem, meta, True)
    assert g[0] == [1, 0, 1, 0] and g[1] == [1, 0, 0, 0]


def test_determinism():
    def h(stem):
        with open(stem + ".seq", "rb") as fh:
            return fh.read()
    cases = [
        (w1_surfaces.generate, dict(surface="torus", n=10, m=10, k=1, updates=40)),
        (w2_refine.generate, dict(N=3, s=3, updates=40)),
        (w3_cavities.generate, dict(N=6, k=1, updates=40)),
        (w4_pointcloud.generate, dict(n=100, updates=40)),
        (w5_witness.generate_sphere, dict(level=1, updates=4)),
    ]
    for i, (fn, kw) in enumerate(cases):
        a, b, c = (os.path.join(TMP, f"det{i}{x}") for x in "abc")
        fn(a, seed=21, **kw)
        fn(b, seed=21, **kw)
        fn(c, seed=22, **kw)
        assert h(a) == h(b), fn.__module__
        assert h(a) != h(c), fn.__module__


def test_committed_samples_are_current():
    """samples/ is what make_samples.py produces now, and its .betti files are
    what the GUDHI oracle computes from the committed .seq files."""
    import hashlib
    import json
    import make_samples
    for name, (fn, kw) in make_samples.SAMPLES.items():
        stem = os.path.join(HERE, "samples", name)
        with open(stem + ".meta.json") as fh:
            meta = json.load(fh)
        with open(stem + ".seq", "rb") as fh:
            committed = fh.read()
        assert hashlib.sha256(committed).hexdigest() == meta["seq_sha256"], name
        regen = os.path.join(TMP, "regen_" + name)
        fn(regen, **kw)
        with open(regen + ".seq", "rb") as fh:
            assert fh.read() == committed, f"{name}: generator output changed; rerun make_samples.py"
        g, _ = gudhi_oracle.run(stem + ".seq")
        assert g == gudhi_oracle.read_betti(stem + ".betti"), name
        if meta["expected_betti"]:
            assert g == gudhi_oracle.read_betti(stem + ".expected.betti"), name


# ------------------------------------------------------------------ runner

def main():
    tests = [(k, v) for k, v in list(globals().items())
             if k.startswith("test_") and callable(v)]
    failed = 0
    t_all = time.perf_counter()
    for name, fn in tests:
        t0 = time.perf_counter()
        try:
            fn()
            print(f"PASS {name} ({time.perf_counter() - t0:.1f}s)", flush=True)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL {name}: {type(e).__name__}: {e}", flush=True)
    print(f"{len(tests) - failed}/{len(tests)} passed in {time.perf_counter() - t_all:.1f}s")
    if failed:
        print(f"scratch files kept in {TMP}")
    else:
        shutil.rmtree(TMP, ignore_errors=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
