#!/usr/bin/env python3
"""Randomised property checks for the MMHM v2 theory (SPEC 2-4;
paper/sections/theory.tex and erratum.tex).

  (a) Theorem 1: (I1)-(I3) (and the pivot/occ indices) hold after every atomic
      edit and every rebuild, and the DRB Betti numbers equal a brute-force
      GF(2) rank computation that shares no code with the DRB.
  (b) Lemma 2: under the collapse (Morse) order the matching is acyclic, ord is
      a filtration order, and every gradient pair (tau, sigma) is an apparent
      pair: column sigma is not cleared and takes pivot tau with zero additions
      (with and without clearing, FIFO and random queue disciplines).
      Corollary 2.1: with clearing, additions occur only in critical columns.
      Corollary 2.2: critical cells precede lower cells in ord (per dimension);
      a reduced critical column has no lower cell, its critical part is the
      reduced Morse column, and its additions are apparent-then-critical,
      the critical ones being exactly those of the Morse reduction.
  (c) E1: the matrix counterexample of SPEC 0, and an exhaustive search for a
      shortest atomic edit sequence on which v1's rule ('lcr') reports wrong
      Betti numbers.
  (d) E2: a small complex + collapse matching + deletion of a MATCHED cell
      that changes the Morse boundary of a critical cell sharing no vertex
      with the edited cell (so v1's affected set misses it); smallest found,
      one with a far critical triangle, and the whole cycle family C_5..C_40.
  (e) Proposition 4: on the W5 families every toggle costs >= L (resp. n_2)
      elementary operations, and toggling is 2-periodic after the first delete.

Run:  python3 check_props.py [--quick] [--seed S] [--write counterexamples.json]
Exit code 0 iff every check passed.
"""

from __future__ import annotations

import argparse
import itertools
import json
import random
import sys
import time

sys.setrecursionlimit(100000)

from drb_ref import (ColumnDRB, ColumnLCR, Complex, Method, SimplicialDRB,
                     collapse, facets)

FAILURES = []


def expect(cond, msg):
    if not cond:
        FAILURES.append(msg)
        if len(FAILURES) <= 20:
            print("  FAIL:", msg)
    return cond


# ---------------------------------------------------------------------------
# Independent brute force (bitmask Gaussian elimination over GF(2))
# ---------------------------------------------------------------------------

def gf2_rank(vectors):
    basis = {}
    r = 0
    for v in vectors:
        while v:
            h = v.bit_length() - 1
            if h in basis:
                v ^= basis[h]
            else:
                basis[h] = v
                r += 1
                break
    return r


def brute_betti(cells):
    """cells: iterable of sorted tuples (a simplicial complex)."""
    by = [sorted(c for c in cells if len(c) == k + 1) for k in range(4)]
    idx = [{s: i for i, s in enumerate(b)} for b in by]
    r = [0] * 5
    for k in range(1, 4):
        r[k] = gf2_rank([sum(1 << idx[k - 1][f] for f in facets(s)) for s in by[k]])
    return [len(by[k]) - r[k] - r[k + 1] for k in range(4)]


def bd(chain):
    """Z2 boundary of a chain of simplices."""
    out = set()
    for s in chain:
        for f in facets(s):
            out ^= {f}
    return out


def check_invariants(S, tag=""):
    """(I1)-(I3) and index consistency for a SimplicialDRB, from first principles."""
    ok = True
    for k, d in S.drb.items():
        Kk = S.K.cells[k]
        key = S.key
        # (I1)
        for j in d.R:
            ok &= expect(d.R[j] == bd(d.V[j]), f"{tag} I1 k={k} slot {j}")
        # (I2) and the pivot index
        lows = {}
        for j, R in d.R.items():
            if R:
                l = max(R, key=key.__getitem__)
                ok &= expect(l not in lows, f"{tag} I2 k={k} low {l} repeated")
                lows[l] = j
        ok &= expect(lows == d.pivot, f"{tag} pivot index k={k}")
        # (I3): n_k slots, chains inside K_k, GF(2)-independent
        ok &= expect(len(d.V) == len(Kk), f"{tag} I3 #slots {len(d.V)} != n_{k} {len(Kk)}")
        idx = {s: i for i, s in enumerate(sorted(Kk))}
        inside = all(x in idx for V in d.V.values() for x in V)
        ok &= expect(inside, f"{tag} I3 V outside K_{k}")
        if inside:
            masks = [sum(1 << idx[x] for x in V) for V in d.V.values()]
            ok &= expect(gf2_rank(masks) == len(Kk), f"{tag} I3 V not a basis k={k}")
        # occ index
        occ = {}
        for j, V in d.V.items():
            for x in V:
                occ.setdefault(x, set()).add(j)
        ok &= expect(occ == d.occ, f"{tag} occ index k={k}")
    return ok


# ---------------------------------------------------------------------------
# Random complexes and random valid edit sequences
# ---------------------------------------------------------------------------

def closure(tops):
    out = set()
    for t in tops:
        t = tuple(sorted(t))
        for r in range(1, len(t) + 1):
            out.update(itertools.combinations(t, r))
    return out


def by_dim(cells):
    return sorted(cells, key=lambda s: (len(s), s))


TORUS7 = [(i % 7, (i + 1) % 7, (i + 3) % 7) for i in range(7)] + \
         [(i % 7, (i + 2) % 7, (i + 3) % 7) for i in range(7)]
RP2_6 = [(0, 1, 2), (0, 2, 3), (0, 3, 4), (0, 4, 5), (0, 1, 5), (1, 2, 4),
         (2, 3, 5), (1, 3, 4), (2, 4, 5), (1, 3, 5)]
SPHERE3 = list(itertools.combinations(range(5), 4))      # boundary of the 4-simplex
OCTA = [(a, b, c) for a in (0, 1) for b in (2, 3) for c in (4, 5)]
SEEDS = {"torus7": TORUS7, "rp2": RP2_6, "s3": SPHERE3, "octahedron": OCTA}


def random_ops(rng, nverts, D, n_grow, n_churn, seed_tops=None):
    """Valid atomic edit sequence: optional seed complex, growth, then churn."""
    K = set()
    ops = []
    if seed_tops:
        for s in by_dim(closure(seed_tops)):
            K.add(s)
            ops.append(("+", s))
        nverts = max(nverts, 1 + max(v for s in K for v in s))
    universe = [s for r in range(1, D + 2) for s in itertools.combinations(range(nverts), r)]
    weight = {1: 1.0, 2: 1.5, 3: 2.5, 4: 3.0}
    for count, p_ins in ((n_grow, 0.85), (n_churn, 0.5)):
        for _ in range(count):
            ins = [s for s in universe if s not in K and all(f in K for f in facets(s))]
            has_cof = {f for c in K for f in facets(c)}
            dels = [s for s in K if s not in has_cof]
            if ins and (not dels or rng.random() < p_ins):
                s = rng.choices(ins, weights=[weight[len(x)] for x in ins])[0]
                K.add(s)
                ops.append(("+", s))
            elif dels:
                s = rng.choice(sorted(dels))
                K.discard(s)
                ops.append(("-", s))
    return ops


def split_updates(rng, ops, n_init):
    """INIT = longest insert-only prefix of ops[:n_init]; the rest is cut into
    updates (batches) of 1..4 atomic edits."""
    k = 0
    while k < min(n_init, len(ops)) and ops[k][0] == "+":
        k += 1
    init, rest = ops[:k], ops[k:]
    updates = []
    i = 0
    while i < len(rest):
        s = rng.randint(1, 4)
        updates.append(rest[i:i + s])
        i += s
    return init, updates


# ---------------------------------------------------------------------------
# (a) Theorem 1
# ---------------------------------------------------------------------------

CONFIGS = [  # (name, method, period, alpha)
    ("drb-id", "drb-id", float("inf"), 1.0),
    ("mmhm-norb", "mmhm-norb", float("inf"), 1.0),
    ("mmhm period=2", "mmhm", 2, float("inf")),
    ("mmhm alpha=0.1", "mmhm", float("inf"), 0.1),
]


def check_theorem1(rng, n_seq):
    stats = {"sequences": 0, "edits": 0, "invariant_checks": 0, "betti_checks": 0,
             "rebuilds": 0, "lcr_updates": 0, "lcr_wrong_updates": 0}
    cases = {}
    for it in range(n_seq):
        D = 3 if it % 4 else 2
        seed = None
        if it % 5 == 0:
            name = sorted(SEEDS)[(it // 5) % len(SEEDS)]
            seed = SEEDS[name] if (D == 3 or name != "s3") else None
        nverts = rng.randint(5, 8)
        ops = random_ops(rng, nverts, D, n_grow=rng.randint(10, 30),
                         n_churn=rng.randint(20, 40), seed_tops=seed)
        init, updates = split_updates(rng, ops, n_init=rng.randint(0, len(ops) // 2))
        # brute-force Betti after INIT, after each edit, after each update
        K = set(s for _, s in init)
        truth_init = brute_betti(K)
        truth_ops = []
        for upd in updates:
            row = []
            for sign, s in upd:
                (K.add if sign == "+" else K.discard)(s)
                row.append(brute_betti(K))
            truth_ops.append(row)
        stats["sequences"] += 1
        stats["edits"] += len(ops)
        for cname, meth, period, alpha in CONFIGS:
            m = Method(meth, D, period=period, alpha=alpha)
            b = m.build(init)
            expect(b == truth_init, f"seq {it} {cname} INIT betti {b} != {truth_init}")
            check_invariants(m.S, f"seq {it} {cname} INIT")
            stats["invariant_checks"] += 1
            stats["betti_checks"] += 1
            for t, upd in enumerate(updates, start=1):
                for (sign, s), tb in zip(upd, truth_ops[t - 1]):
                    case = m.apply(sign, s)
                    key = (len(s) - 1, sign, case)
                    cases[key] = cases.get(key, 0) + 1
                    b = m.betti()
                    expect(b == tb, f"seq {it} {cname} t={t} {sign}{s}: {b} != {tb}")
                    check_invariants(m.S, f"seq {it} {cname} t={t} {sign}{s}")
                    stats["invariant_checks"] += 1
                    stats["betti_checks"] += 1
                if m.end_update(t):
                    stats["rebuilds"] += 1
                    check_invariants(m.S, f"seq {it} {cname} t={t} rebuild")
                    stats["invariant_checks"] += 1
                    expect(m.betti() == truth_ops[t - 1][-1], f"seq {it} {cname} rebuild betti")
        # Static baselines and lcr (betti only)
        for meth in ("full-id", "full-morse", "lcr"):
            m = Method(meth, D)
            b = m.build(init)
            if meth != "lcr":
                expect(b == truth_init, f"seq {it} {meth} INIT")
            for t, upd in enumerate(updates, start=1):
                for sign, s in upd:
                    m.apply(sign, s)
                b = m.betti()
                if meth == "lcr":
                    stats["lcr_updates"] += 1
                    stats["lcr_wrong_updates"] += b != truth_ops[t - 1][-1]
                else:
                    expect(b == truth_ops[t - 1][-1], f"seq {it} {meth} t={t}")
                    stats["betti_checks"] += 1
    return stats, cases


# ---------------------------------------------------------------------------
# Discrete Morse helpers: gradient-path counting
# ---------------------------------------------------------------------------

def morse_boundaries(pairs, critical):
    """Z2 Morse boundary of every critical cell of dim >= 1, by counting
    gradient paths mod 2: d^M c = sum over facets t of c of flow(t), where
    flow(t) = {t} if t critical, sum_{t' facet of V(t), t' != t} flow(t') if t
    is matched upward with V(t), and 0 if t is matched downward."""
    up = {x: y for x, y in pairs}
    crit = set(critical)
    memo = {}

    def flow(t):
        if t not in memo:
            if t in crit:
                res = {t}
            elif t in up:
                res = set()
                for f in facets(up[t]):
                    if f != t:
                        res ^= flow(f)
            else:
                res = set()
            memo[t] = frozenset(res)
        return memo[t]

    out = {}
    for c in critical:
        if len(c) > 1:
            acc = set()
            for f in facets(c):
                acc ^= flow(f)
            out[c] = frozenset(acc)
    return out


def morse_betti(critical, mb):
    cr = [sorted(c for c in critical if len(c) == k + 1) for k in range(4)]
    idx = [{s: i for i, s in enumerate(b)} for b in cr]
    r = [0] * 5
    for k in range(1, 4):
        r[k] = gf2_rank([sum(1 << idx[k - 1][f] for f in mb[c]) for c in cr[k]])
    return [len(cr[k]) - r[k] - r[k + 1] for k in range(4)]


def morse_reduce(critical, mb, key):
    """Standard reduction with clearing of the Morse boundary matrices, critical
    cells in increasing ord, top dimension first. Returns c -> (cleared?,
    reduced column, critical columns added in order)."""
    out = {}
    clear = {}
    for k in range(3, 0, -1):
        cols = sorted((c for c in critical if len(c) == k + 1), key=key.__getitem__)
        pivot, R = {}, {}
        for c in cols:
            if c in clear:
                R[c] = frozenset()
                out[c] = (True, frozenset(), [])
                continue
            r, trace = set(mb[c]), []
            while r:
                p = pivot.get(max(r, key=key.__getitem__))
                if p is None:
                    break
                r ^= R[p]
                trace.append(p)
            R[c] = frozenset(r)
            if r:
                pivot[max(r, key=key.__getitem__)] = c
            out[c] = (False, R[c], trace)
        clear = {l: True for l in pivot}
    return out


def acyclic(pairs, cells):
    """No closed V-path: DFS on the modified Hasse diagram (edges y->f for
    facets f of y, reversed to f->y on matched pairs)."""
    up = {x: y for x, y in pairs}
    down = {y: x for x, y in pairs}
    succ = {}
    for y in cells:
        for f in facets(y):
            if up.get(f) == y:
                succ.setdefault(f, []).append(y)
            else:
                succ.setdefault(y, []).append(f)
    color = {}
    for s in cells:
        if color.get(s):
            continue
        stack = [(s, iter(succ.get(s, ())))]
        color[s] = 1
        while stack:
            v, it = stack[-1]
            nxt = next(it, None)
            if nxt is None:
                color[v] = 2
                stack.pop()
            elif color.get(nxt) == 1:
                return False
            elif not color.get(nxt):
                color[nxt] = 1
                stack.append((nxt, iter(succ.get(nxt, ()))))
    return True


# ---------------------------------------------------------------------------
# (b) Lemma 2
# ---------------------------------------------------------------------------

def random_complex(rng, nverts, D, ntops):
    tops = []
    for _ in range(ntops):
        k = rng.choices(range(1, D + 1), weights=[1, 2, 4][:D])[0]
        tops.append(tuple(sorted(rng.sample(range(nverts), k + 1))))
    return closure(tops)


def bridged_cycles(rng):
    """2-4 cycles joined in a chain by bridges; bridge endpoints get the
    smallest labels, so the collapse tends to remove bridges as critical edges
    (a non-perfect matching whose critical columns interact)."""
    edges, v, prev, bridges = [], 0, None, []
    for _ in range(rng.randint(2, 4)):
        L = rng.randint(3, 5)
        cyc = list(range(v, v + L))
        v += L
        edges += [(cyc[i], cyc[(i + 1) % L]) for i in range(L)]
        if prev is not None:
            bridges.append((prev, cyc[0]))
        prev = cyc[rng.randrange(L)]
    ends = [x for b in bridges for x in b]
    order = list(dict.fromkeys(ends)) + [x for x in range(v) if x not in ends]
    m = {x: i for i, x in enumerate(order)}
    return closure([tuple(sorted((m[a], m[b]))) for a, b in edges + bridges])


def torus_with_disks(nd, g=3):
    """g x g grid torus with nd cones (disks) glued along the meridian j = 0;
    the cone apexes get the smallest labels, so the collapse removes cone
    triangles as critical first and the meridian survives as a critical edge
    killed nd times."""
    vv = lambda i, j: nd + g * (i % g) + (j % g)
    tri = []
    for i in range(g):
        for j in range(g):
            tri.append((vv(i, j), vv(i + 1, j), vv(i + 1, j + 1)))
            tri.append((vv(i, j), vv(i, j + 1), vv(i + 1, j + 1)))
    m = [vv(i, 0) for i in range(g)]
    for a in range(nd):
        tri += [(a, m[i], m[(i + 1) % g]) for i in range(g)]
    return closure(tri)


def check_lemma2(rng, n_cx):
    st = {"complexes": 0, "cells": 0, "pairs": 0, "critical": 0, "apparent_ok": 0,
          "cleared_lower": 0, "adds_total": 0, "adds_in_critical": 0,
          "critical_columns": 0, "morse_reduction_ok": 0, "critical_additions": 0,
          "upper_cells_left_in_Rc": 0}
    complexes = [closure(t) for t in SEEDS.values()]
    complexes += [closure(itertools.combinations(range(n), k + 1)) for n, k in ((6, 2), (7, 2), (6, 3))]
    while len(complexes) < n_cx:
        r = rng.random()
        n = rng.randint(4, 11)
        if r < 0.15:                                  # cycles joined by bridges (non-perfect in dim 1)
            complexes.append(bridged_cycles(rng))
        elif r < 0.27:                                # torus + 1 or 2 disks on a meridian (dim 2)
            complexes.append(torus_with_disks(rng.choice((1, 2, 3))))
        elif r < 0.35:                                # graphs (bridges, many cycles)
            complexes.append(closure([tuple(sorted(rng.sample(range(n), 2)))
                                      for _ in range(rng.randint(3, 20))]))
        elif r < 0.47:                                # random flag complexes, dim <= 3
            E = [e for e in itertools.combinations(range(n), 2) if rng.random() < 0.55]
            cl = [s for q in range(1, 5) for s in itertools.combinations(range(n), q)
                  if all(e in E for e in itertools.combinations(s, 2))]
            complexes.append(closure(cl))
        else:
            complexes.append(random_complex(rng, n, rng.choice((2, 3, 3)), rng.randint(3, 25)))
    for ci, cells in enumerate(complexes):
        D = max(len(s) for s in cells) - 1
        S = SimplicialDRB(max(D, 1))
        for s in by_dim(cells):
            S.K.add(s)
        st_clear = {}
        # every third complex: random queue discipline (Lemma 2 claims any works)
        rm, pairs, critical = S.rebuild("morse", stats=st_clear, clearing=True,
                                        rng=random.Random(ci) if ci % 3 == 2 else None)
        key = S.key
        st_plain = {}
        S2 = SimplicialDRB(max(D, 1))
        S2.K = S.K
        S2.key = dict(key)
        S2.rebuild("id", stats=st_plain, clearing=False)
        st["complexes"] += 1
        st["cells"] += len(cells)
        st["pairs"] += len(pairs)
        st["critical"] += len(critical)
        crit = set(critical)
        # ord is a filtration order (faces before cofaces)
        expect(all(key[f] < key[s] for s in cells for f in facets(s)), f"cx {ci} ord not a filtration")
        # acyclicity, and rm strictly increases along V-paths
        expect(acyclic(pairs, cells), f"cx {ci} matching has a closed V-path")
        for x, y in pairs:
            expect(all(rm[f] > rm[x] for f in facets(y) if f != x), f"cx {ci} rm along V-path")
        # Lemma 2 (with and without clearing)
        for x, y in pairs:
            k = len(y) - 1
            ok = True
            for tag, stt in (("clearing", st_clear), ("plain", st_plain)):
                cleared, adds, low, _ = stt[k][y]
                ok &= expect(not cleared and adds == 0 and low == x,
                             f"cx {ci} {tag}: pair {x}<{y} not apparent ({cleared},{adds},{low})")
            # apparent in Ripser's sense: x youngest facet of y, y oldest coface of x
            ok &= expect(max(facets(y), key=key.__getitem__) == x, f"cx {ci} youngest facet")
            ok &= expect(min(S.K.cof[x], key=key.__getitem__) == y, f"cx {ci} oldest coface")
            st["apparent_ok"] += ok
            # Corollary: the lower cell is cleared (k-1 >= 1)
            if len(x) >= 2:
                st["cleared_lower"] += expect(st_clear[k - 1][x][0], f"cx {ci} lower cell {x} not cleared")
        # Corollary: additions only in critical columns (with clearing)
        for k, stt in st_clear.items():
            for c, (cleared, adds, low, _) in stt.items():
                st["adds_total"] += adds
                if adds:
                    expect(c in crit, f"cx {ci} additions in non-critical column {c}")
                    st["adds_in_critical"] += adds
        # Morse complex: Betti numbers by gradient-path counting
        mb = morse_boundaries(pairs, critical)
        expect(morse_betti(critical, mb) == brute_betti(cells), f"cx {ci} Morse complex betti")
        # Proposition 3 (critical columns perform the Morse reduction)
        lower = {x for x, _ in pairs}
        upper = {y for _, y in pairs}
        for q in range(4):
            cq = [key[c] for c in critical if len(c) == q + 1]
            lq = [key[x] for x in lower if len(x) == q + 1]
            if cq and lq:
                expect(max(cq) < min(lq), f"cx {ci} dim {q}: a lower cell precedes a critical cell")
        mred = morse_reduce(critical, mb, key)
        for c in critical:
            if len(c) < 2:
                continue
            k = len(c) - 1
            d = S.drb[k]
            j = next(j for j in d.occ[c] if max(d.V[j], key=key.__getitem__) == c)
            Rc = d.R[j]
            cleared, adds, low, added = st_clear[k][c]
            m_cleared, m_R, m_trace = mred[c]
            ok = expect(not (Rc & lower), f"cx {ci} reduced critical column {c} contains a lower cell")
            ok &= expect(frozenset(Rc & crit) == m_R, f"cx {ci} R_c|crit != reduced Morse column for {c}")
            ok &= expect(cleared == m_cleared, f"cx {ci} clearing differs for {c}")
            kinds = ["c" if a in crit else ("a" if a in upper else "?") for a in added]
            ok &= expect("?" not in kinds and "ca" not in "".join(kinds),
                         f"cx {ci} additions on {c} not apparent-then-critical: {kinds}")
            ok &= expect([a for a in added if a in crit] == m_trace, f"cx {ci} critical additions differ for {c}")
            st["morse_reduction_ok"] += ok
            st["critical_columns"] += 1
            st["upper_cells_left_in_Rc"] += bool(Rc & upper)
            st["critical_additions"] += kinds.count("c")
    return st


# ---------------------------------------------------------------------------
# (c) E1
# ---------------------------------------------------------------------------

def e1_matrix():
    """SPEC 0: B = [a | b], a = b = e1; replace a by e2."""
    rkey = {"e1": 0, "e2": 1}.__getitem__
    lcr = ColumnLCR(rkey)
    drb = ColumnDRB(rkey)
    for M in (lcr, drb):
        M.insert("a", {"e1"})
        M.insert("b", {"e1"})
    before = (lcr.rank(), drb.rank())
    lcr.replace("a", {"e2"})
    drb.delete("a")
    drb.insert("a", {"e2"})
    true_rank = 2
    expect(drb.rank() == true_rank, "E1 matrix: DRB rank")
    expect(lcr.rank() == 1, "E1 matrix: lcr should report 1")
    return {"rank_before": before, "lcr_rank_after": lcr.rank(), "drb_rank_after": drb.rank(),
            "true_rank_after": true_rank, "lcr_R_b": sorted(lcr.R["b"])}


def lcr_first_failure(ops, D=3):
    """Replay ops one atomic edit per update; index of first wrong lcr Betti."""
    m = Method("lcr", D)
    m.build([])
    K = set()
    for i, (sign, s) in enumerate(ops):
        m.apply(sign, s)
        (K.add if sign == "+" else K.discard)(s)
        if m.betti() != brute_betti(K):
            return i, m.betti(), brute_betti(K)
    return None


def enumerate_sequences(L, max_verts, D):
    """All valid atomic edit sequences of length L, vertices labelled in order
    of first insertion (0, 1, 2, ...), up to max_verts vertices."""
    def rec(K, nv, seq):
        if len(seq) == L:
            yield list(seq)
            return
        opts = []
        if nv < max_verts:
            opts.append(("+", (nv,), nv + 1))
        verts = sorted(s[0] for s in K if len(s) == 1)
        for r in range(2, D + 2):
            for s in itertools.combinations(verts, r):
                if s not in K and all(f in K for f in facets(s)):
                    opts.append(("+", s, nv))
        for s in sorted(K):
            if not any(len(c) == len(s) + 1 and set(s) <= set(c) for c in K):
                opts.append(("-", s, nv))
        for sign, s, nv2 in opts:
            K2 = K | {s} if sign == "+" else K - {s}
            seq.append((sign, s))
            yield from rec(K2, nv2, seq)
            seq.pop()
    yield from rec(frozenset(), 0, [])


def e1_search(max_len, max_verts=4, D=2):
    counts = {}
    found = []
    for L in range(1, max_len + 1):
        n = 0
        fails = []
        for seq in enumerate_sequences(L, max_verts, D):
            n += 1
            f = lcr_first_failure(seq, D)
            if f is not None and f[0] == L - 1:
                fails.append((seq, f))
        counts[L] = (n, len(fails))
        if fails:
            found = fails
            break

    def size(item):
        seq, _ = item
        K = set()
        for sign, s in seq:
            (K.add if sign == "+" else K.discard)(s)
        first_edge = next(i for i, (_, s) in enumerate(seq) if len(s) > 1)
        late_vertices = sum(1 for _, s in seq[first_edge:] if len(s) == 1)
        return (len(set(s for _, s in seq)), len(K), late_vertices, seq)
    found.sort(key=size)
    return counts, found


def describe_drb_on(ops, D=2):
    S = SimplicialDRB(D)
    for sign, s in ops:
        (S.insert if sign == "+" else S.delete)(s)
    return S.betti()


# ---------------------------------------------------------------------------
# (d) E2
# ---------------------------------------------------------------------------

def e2_on(cells, pairs, critical, verbose=False):
    """For every MATCHED maximal cell y (upper cell of a pair (x, y)), delete y
    keeping the remaining pairs (x becomes critical). Return the far critical
    cells whose Morse boundary changed, plus v1's stale Betti numbers."""
    cof = {s: [c for c in cells if len(c) == len(s) + 1 and set(s) <= set(c)] for s in cells}
    mb = morse_boundaries(pairs, critical)
    results = []
    for x, y in pairs:
        if cof[y]:
            continue                      # only maximal cells can be deleted
        cells2 = cells - {y}
        pairs2 = [p for p in pairs if p != (x, y)]
        crit2 = list(critical) + [x]
        mb2 = morse_boundaries(pairs2, crit2)
        far = [c for c in critical if len(c) > 1 and mb[c] != mb2[c] and not set(c) & set(y)]
        if not far:
            continue
        modified = {y} | set(facets(y))   # v1: cells whose incidences change
        stale = {c: (mb2[c] if c in modified else mb.get(c, mb2.get(c))) for c in mb2}
        results.append({"deleted": y, "partner_now_critical": x, "far_changed": far,
                        "mb_before": {c: sorted(mb[c]) for c in far},
                        "mb_after": {c: sorted(mb2[c]) for c in far},
                        "true_betti": brute_betti(cells2),
                        "morse_betti_after": morse_betti(crit2, mb2),
                        "v1_stale_betti": morse_betti(crit2, stale)})
    return results


def e2_search(rng, n_cx):
    best_any = best_wrong = best_dim2 = None
    explicit = []
    cands = [closure([(0, 1), (1, 2), (2, 3), (0, 3)])]          # the 4-cycle
    cands += [torus_with_disks(nd, g) for g in (3, 4, 5) for nd in (1, 2)]
    while len(cands) < n_cx:
        cands.append(random_complex(rng, rng.randint(4, 8), 2, rng.randint(3, 10)))
    for cells in cands:
        K = Complex(2)
        for s in by_dim(cells):
            K.add(s)
        rm, pairs, critical = collapse(K)
        for r in e2_on(cells, pairs, critical):
            item = (len(cells), sorted(cells), pairs, critical, r)
            if best_any is None or item[0] < best_any[0]:
                best_any = item
            if r["v1_stale_betti"] != r["true_betti"] and (best_wrong is None or item[0] < best_wrong[0]):
                best_wrong = item
            if any(len(c) == 3 for c in r["far_changed"]) and (best_dim2 is None or item[0] < best_dim2[0]):
                best_dim2 = item
            expect(r["morse_betti_after"] == r["true_betti"], "E2: Morse complex after edit")
    return best_any, best_wrong, best_dim2


def e2_cycles(Ls):
    """On C_L with the collapse matching, every matched edge sharing no vertex
    with the critical edge is an E2 edit (its deletion changes the critical
    edge's Morse boundary from 0 to a sum of two critical vertices)."""
    n_edits = 0
    for L in Ls:
        cells = closure([(i, (i + 1) % L) for i in range(L)])
        K = Complex(1)
        for s in by_dim(cells):
            K.add(s)
        rm, pairs, critical = collapse(K)
        (c,) = [x for x in critical if len(x) == 2]
        hits = {r["deleted"] for r in e2_on(cells, pairs, critical)}
        expected = {y for x, y in pairs if len(y) == 2 and not set(y) & set(c)}
        expect(hits == expected, f"E2 cycle L={L}: {sorted(hits)} != {sorted(expected)}")
        n_edits += len(hits)
    return n_edits


def fmt_instance(item):
    if item is None:
        return None
    n, cells, pairs, critical, r = item
    tops = [s for s in cells if not any(len(c) == len(s) + 1 and set(s) <= set(c) for c in cells)]
    return {"n_cells": n, "maximal_simplices": sorted(tops, key=lambda s: (len(s), s)),
            "pairs": [[list(x), list(y)] for x, y in pairs],
            "critical": [list(c) for c in critical],
            "deleted_matched_cell": list(r["deleted"]),
            "partner_now_critical": list(r["partner_now_critical"]),
            "far_critical_changed": [list(c) for c in r["far_changed"]],
            "morse_boundary_before": {str(list(c)): [list(v) for v in vs] for c, vs in r["mb_before"].items()},
            "morse_boundary_after": {str(list(c)): [list(v) for v in vs] for c, vs in r["mb_after"].items()},
            "true_betti_after": r["true_betti"], "v1_stale_betti_after": r["v1_stale_betti"]}


# ---------------------------------------------------------------------------
# (e) Proposition 4 on the W5 families
# ---------------------------------------------------------------------------

def toggle_costs(cells, f, order, toggles=4):
    D = max(len(s) for s in cells) - 1
    S = SimplicialDRB(D)
    for s in by_dim(cells):
        S.K.add(s)
        S.key[s] = S.next_key
        S.next_key += 1
    S.rebuild(order)
    d = S.drb[len(f) - 1]
    out = []
    snapshots = []
    for _ in range(toggles):
        w0 = d.work
        case = S.delete(f)
        wd = d.work - w0
        snapshots.append({j: (frozenset(d.R[j]), frozenset(d.V[j])) for j in d.R})
        w0 = d.work
        S.insert(f)
        wi = d.work - w0
        out.append((case, wd, wi))
    periodic = all(sorted(snapshots[i].values(), key=repr) == sorted(snapshots[1].values(), key=repr)
                   for i in range(1, len(snapshots)))
    return out, periodic


def check_prop4(sizes):
    rows = []
    for L in sizes:
        cyc = closure([(i, (i + 1) % L) for i in range(L)])
        f = (0, 1)
        m = L // 2                         # bipyramid over an m-cycle: n_2 = 2m triangles
        sph = closure([(i, (i + 1) % m, m) for i in range(m)] + [(i, (i + 1) % m, m + 1) for i in range(m)])
        g = tuple(sorted((0, 1, m)))
        n2 = 2 * m
        for fam, cells, cell, n in (("cycle", cyc, f, L), ("sphere", sph, g, n2)):
            for order in ("id", "morse"):
                costs, periodic = toggle_costs(cells, cell, order)
                lb = all(case == "A" and wd >= n and wi >= n - 1 for case, wd, wi in costs)
                expect(lb, f"Prop 4 lower bound {fam} n={n} {order}: {costs}")
                expect(periodic, f"Prop 4 periodicity {fam} n={n} {order}")
                rows.append((fam, order, n, costs[0][1] + costs[0][2], costs[-1][1] + costs[-1][2]))
    return rows


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20250817)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--write", help="write recorded counterexamples as JSON")
    a = ap.parse_args()
    rng = random.Random(a.seed)
    T0 = time.time()
    report = {}

    print("(a) Theorem 1: invariants and Betti numbers after every atomic edit")
    t = time.time()
    st, cases = check_theorem1(rng, 40 if a.quick else 600)
    for k, v in st.items():
        print(f"    {k:22s} {v}")
    print("    edit cases (dim, sign, outcome): " +
          ", ".join(f"{k[0]}{k[1]}{k[2][:3]}={v}" for k, v in sorted(cases.items())))
    print(f"    [{time.time() - t:.1f}s]")
    report["theorem1"] = st
    report["theorem1_cases"] = {f"{k[0]}{k[1]}{k[2]}": v for k, v in sorted(cases.items())}

    print("(b) Lemma 2: gradient pairs are apparent pairs under the Morse order")
    t = time.time()
    st = check_lemma2(rng, 80 if a.quick else 1200)
    for k, v in st.items():
        print(f"    {k:22s} {v}")
    print(f"    [{time.time() - t:.1f}s]")
    report["lemma2"] = st

    print("(c) E1: v1's rule without basis tracking")
    t = time.time()
    m = e1_matrix()
    print(f"    matrix: ranks before (lcr, drb) = {m['rank_before']}; after replacing a: "
          f"lcr {m['lcr_rank_after']}, drb {m['drb_rank_after']}, true {m['true_rank_after']}")
    counts, found = e1_search(7, max_verts=4, D=2)
    for L, (n, nf) in counts.items():
        print(f"    length {L}: {n} canonical sequences, {nf} where lcr is first wrong at the last edit")
    expect(found, "E1: no simplicial counterexample found")
    rec = None
    if found:
        seq, (i, bl, bt) = found[0]
        bd_ = describe_drb_on(seq)
        expect(bd_ == bt, "E1: DRB wrong on the counterexample")
        rec = {"ops": [f"{sg} {' '.join(map(str, s))}" for sg, s in seq],
               "lcr_betti": bl, "true_betti": bt, "drb_betti": bd_,
               "n_failing_sequences_at_min_length": len(found),
               "sequences_checked": {L: n for L, (n, _) in counts.items()}}
        print(f"    shortest: {' ; '.join(rec['ops'])}")
        print(f"      lcr {bl}  true {bt}  drb {bd_}")
    print(f"    [{time.time() - t:.1f}s]")
    report["E1"] = {"matrix": m, "simplicial": rec}

    print("(d) E2: editing a matched cell changes a far critical cell's Morse boundary")
    t = time.time()
    best_any, best_wrong, best_dim2 = e2_search(rng, 150 if a.quick else 1000)
    expect(best_any is not None, "E2: no instance found")
    for tag, item in (("smallest", best_any), ("smallest with wrong v1 Betti", best_wrong),
                      ("smallest with a far critical triangle", best_dim2)):
        fi = fmt_instance(item)
        report[f"E2 {tag}"] = fi
        if fi:
            print(f"    {tag}: {fi['n_cells']} cells, maximal {fi['maximal_simplices']}")
            print(f"      delete matched {fi['deleted_matched_cell']} (partner {fi['partner_now_critical']} "
                  f"becomes critical); far critical {fi['far_critical_changed']}")
            print(f"      Morse boundary before {fi['morse_boundary_before']} after {fi['morse_boundary_after']}")
            print(f"      Betti true {fi['true_betti_after']}  v1-stale {fi['v1_stale_betti_after']}")
    ne = e2_cycles(range(5, 41))
    print(f"    cycle graphs C_L, L = 5..40: all {ne} matched edges disjoint from the critical edge are E2 edits")
    report["E2 cycles"] = {"L": [5, 40], "edits": ne}
    print(f"    [{time.time() - t:.1f}s]")

    print("(e) Proposition 4: W5 toggles (work = elementary chain/occ operations)")
    t = time.time()
    rows = check_prop4([8, 16, 32, 64] if a.quick else [8, 16, 32, 64, 128])
    for fam, order, n, first, steady in rows:
        print(f"    {fam:6s} order={order:5s} n={n:4d}  first toggle {first:6d}  steady toggle {steady:6d}  steady/n {steady / n:.2f}")
    report["prop4"] = [dict(zip(("family", "order", "n", "first_toggle_work", "steady_toggle_work"), r))
                       for r in rows]
    print(f"    [{time.time() - t:.1f}s]")

    print(f"\nTotal {time.time() - T0:.1f}s; {len(FAILURES)} failure(s).")
    if a.write:
        with open(a.write, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=1, default=str)
            fh.write("\n")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
