"""W3 — cavities in a 3-ball (SPEC 6, W3).

Base: Freudenthal/Kuhn tetrahedralization of [0,N]^3.

Ball around vertex v with radius k: B(v,k) = all tets incident to a vertex at
graph distance <= k-1 from v (k = 1: the closed star of v). Centres are drawn
uniformly from the vertices not on the cube boundary.

Open (carve)  = delete B's tets, then every triangle, edge, vertex left
                without cofaces (top-down, each dimension in sorted order).
                Since the remaining complex stays pure, a face of B is deleted
                iff every tet containing it lies in B.
Close (refill) = exact reverse of that ball's carving sequence (bottom-up).

Acceptance (so the topology is known in advance):
  * the closed vertex set of B is at graph distance > sep from every existing
    carved ball's closed vertex set (balls never touch or merge);
  * dB = triangles in exactly one tet of B is a 2-sphere (connected closed
    2-manifold, chi = 2), so B is a 3-ball;
  * D = dB-triangles lying on the cube boundary is empty (cavity: beta_2 += 1)
    or a disk (dent: homotopy type unchanged). Anything else is rejected.

Expected Betti numbers: (1, 0, #cavities, 0) — verified against GUDHI in the
tests; GUDHI remains the ground truth.
"""

from __future__ import annotations

import random
from collections import Counter
from itertools import combinations

from common import SeqWriter
from meshes import (adjacency, bfs_ball, closure, expand, freudenthal,
                    freudenthal_boundary_vertex, surface_type, vertex_star)


def generate(stem, N=8, k=2, sep=1, target_cavities=4, updates=1000, seed=0,
             max_attempts=200, check=False):
    if N < 2 or k < 1 or sep < 0:
        raise ValueError("N >= 2, k >= 1, sep >= 0")
    rng = random.Random(seed)
    nv, coords, tets = freudenthal(N)
    adj = adjacency(nv, tets)
    star = vertex_star(nv, tets)
    is_bd = freudenthal_boundary_vertex(N)
    interior = [v for v in range(nv) if not is_bd(v)]
    if not interior:
        raise ValueError("no interior vertex")

    params = dict(N=N, k=k, sep=sep, target_cavities=target_cavities,
                  updates=updates, seed=seed, max_attempts=max_attempts)
    w = SeqWriter(stem, 3, comments=[
        "W3 cavities in a 3-ball: " + " ".join(f"{a}={b}" for a, b in params.items())],
        check=check)
    w.init_complex(closure(tets), (1, 0, 0, 0))

    balls = []              # list of (deletion sequence, zone, is_cavity)
    blocked = Counter()
    stats = Counter()
    counts = []

    def tets_containing(f):
        fs = set(f)
        return [t for t in star[f[0]] if fs.issubset(t)]

    def try_open():
        for _ in range(max_attempts):
            v = interior[rng.randrange(len(interior))]
            if v in blocked:
                stats["reject_blocked"] += 1
                continue
            R = bfs_ball(adj, v, k - 1)
            B = set()
            for u in R:
                B.update(star[u])
            VB = {x for t in B for x in t}
            if any(u in blocked for u in VB):
                stats["reject_blocked"] += 1
                continue
            tri_count = Counter(f for t in B for f in combinations(t, 3))
            dB = [f for f, c in tri_count.items() if c == 1]
            if surface_type(dB) != "sphere":
                stats["reject_not_ball"] += 1
                continue
            D = [f for f in dB if len(tets_containing(f)) == 1]
            if D and surface_type(D) != "disk":
                stats["reject_bad_boundary_contact"] += 1
                continue
            dtris = sorted(f for f, c in tri_count.items()
                           if c == 2 or len(tets_containing(f)) == 1)
            edges = {e for t in B for e in combinations(t, 2)}
            dedges = sorted(e for e in edges if all(t in B for t in tets_containing(e)))
            dverts = sorted(u for u in VB if all(t in B for t in star[u]))
            seq = sorted(B) + dtris + dedges + [(u,) for u in dverts]
            return seq, expand(adj, VB, sep), not D
        return None

    def expected():
        return (1, 0, sum(1 for b in balls if b[2]), 0)

    for t in range(updates):
        h = len(balls)
        if h == 0:
            want_open = True
        else:
            p = 0.75 if h < target_cavities else (0.25 if h > target_cavities else 0.5)
            want_open = rng.random() < p
        w.begin_update()
        res = try_open() if want_open else None
        if res is not None:
            seq, zone, cav = res
            for s_ in seq:
                w.dele(s_)
            balls.append(res)
            for u in zone:
                blocked[u] += 1
            stats["carve_cavity" if cav else "carve_dent"] += 1
        else:
            if not balls:
                raise RuntimeError("could not place a ball; mesh too small for k/sep")
            if want_open:
                stats["open_fell_back_to_close"] += 1
            i = rng.randrange(len(balls))
            seq, zone, cav = balls[i]
            balls[i] = balls[-1]
            balls.pop()
            for s_ in reversed(seq):
                w.ins(s_)
            for u in zone:
                blocked[u] -= 1
                if blocked[u] == 0:
                    del blocked[u]
            stats["refill_cavity" if cav else "refill_dent"] += 1
        counts.append((len(balls), expected()[2]))
        w.end_block(expected())

    extra = dict(stats)
    if counts:
        extra["carved_min"] = min(c[0] for c in counts)
        extra["carved_max"] = max(c[0] for c in counts)
        extra["cavities_min"] = min(c[1] for c in counts)
        extra["cavities_max"] = max(c[1] for c in counts)
        extra["cavities_mean"] = sum(c[1] for c in counts) / len(counts)
    return w.close("W3", params, extra,
                   expected_source="analytic: (1,0,#cavities,0); dents (ball meeting the "
                   "cube boundary in a disk) leave the homotopy type unchanged")
