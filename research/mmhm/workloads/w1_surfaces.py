"""W1 — punctured surfaces (SPEC 6, W1).

Base: closed sphere (geodesic icosphere, frequency f; level L means f = 2^L)
or torus (n x m periodic grid, n, m >= 3).

Patch around vertex v with radius k: P(v,k) = all triangles incident to a
vertex at graph distance <= k-1 from v (k = 1: the umbrella of v). A patch is
accepted only if its closure is a disk and its closed vertex set is at graph
distance > sep from every existing hole's closed vertex set (so holes never
touch or merge and the surface stays connected).

Open  = delete P's triangles, then the edges left without cofaces, then the
        vertices left without cofaces (all in sorted order).
Close = the exact reverse of that hole's opening sequence (bottom-up).

Expected Betti numbers with h holes (verified against GUDHI in the tests):
  sphere: (1, max(h-1, 0), [h = 0], 0)
  torus:  (1, 2 + max(h-1, 0), [h = 0], 0)
"""

from __future__ import annotations

import random
from collections import Counter

from common import SeqWriter
from meshes import (adjacency, bfs_ball, closure, expand, icosphere,
                    surface_type, torus_grid, vertex_star)


def expected_betti(surface, h):
    if surface == "sphere":
        return (1, max(h - 1, 0), 1 if h == 0 else 0, 0)
    return (1, 2 + max(h - 1, 0), 1 if h == 0 else 0, 0)


def generate(stem, surface="sphere", level=None, freq=None, n=None, m=None,
             k=2, sep=1, target_holes=3, updates=1000, seed=0,
             max_attempts=200, check=False):
    rng = random.Random(seed)
    if surface == "sphere":
        if freq is None:
            if level is None:
                raise ValueError("sphere needs --level or --freq")
            freq = 2 ** level
        nv, tris = icosphere(freq)
        mesh = {"freq": freq, "level": level}
    elif surface == "torus":
        if n is None or m is None:
            raise ValueError("torus needs --n and --m")
        nv, tris = torus_grid(n, m)
        mesh = {"n": n, "m": m}
    else:
        raise ValueError(surface)
    if k < 1 or sep < 0:
        raise ValueError("k >= 1, sep >= 0")

    adj = adjacency(nv, tris)
    star = vertex_star(nv, tris)
    params = dict(surface=surface, **mesh, k=k, sep=sep,
                  target_holes=target_holes, updates=updates, seed=seed,
                  max_attempts=max_attempts)
    w = SeqWriter(stem, 2, comments=[
        f"W1 punctured {surface}: " + " ".join(f"{a}={b}" for a, b in params.items())],
        check=check)
    w.init_complex(closure(tris), expected_betti(surface, 0))

    holes = []                # list of (deletion sequence, zone)
    blocked = Counter()       # vertex -> number of hole zones containing it
    stats = Counter()
    hole_counts = []
    patch_ops = []

    def try_open():
        for _ in range(max_attempts):
            v = rng.randrange(nv)
            if v in blocked:
                stats["reject_blocked"] += 1
                continue
            R = bfs_ball(adj, v, k - 1)
            P = set()
            for u in R:
                P.update(star[u])
            Vp = {x for t in P for x in t}
            if any(u in blocked for u in Vp):
                stats["reject_blocked"] += 1
                continue
            if surface_type(P) != "disk":
                stats["reject_not_disk"] += 1
                continue
            edges = {e for (a, b, c) in P for e in ((a, b), (a, c), (b, c))}
            dedges = sorted(e for e in edges
                            if all(t in P for t in star[e[0]] if e[1] in t))
            dverts = sorted(u for u in Vp if all(t in P for t in star[u]))
            seq = sorted(P) + dedges + [(u,) for u in dverts]
            return seq, expand(adj, Vp, sep)
        return None

    for t in range(updates):
        h = len(holes)
        if h == 0:
            want_open = True
        else:
            p = 0.75 if h < target_holes else (0.25 if h > target_holes else 0.5)
            want_open = rng.random() < p
        w.begin_update()
        res = try_open() if want_open else None
        if res is not None:
            seq, zone = res
            for s in seq:
                w.dele(s)
            holes.append((seq, zone))
            for u in zone:
                blocked[u] += 1
            stats["opens"] += 1
            patch_ops.append(len(seq))
        else:
            if not holes:
                raise RuntimeError("could not place a hole on the closed surface; "
                                   "mesh too small for k/sep")
            if want_open:
                stats["open_fell_back_to_close"] += 1
            i = rng.randrange(len(holes))
            seq, zone = holes[i]
            holes[i] = holes[-1]
            holes.pop()
            for s in reversed(seq):
                w.ins(s)
            for u in zone:
                blocked[u] -= 1
                if blocked[u] == 0:
                    del blocked[u]
            stats["closes"] += 1
        hole_counts.append(len(holes))
        w.end_block(expected_betti(surface, len(holes)))

    extra = dict(stats)
    extra["holes_min"] = min(hole_counts) if hole_counts else 0
    extra["holes_max"] = max(hole_counts) if hole_counts else 0
    extra["holes_mean"] = (sum(hole_counts) / len(hole_counts)) if hole_counts else 0.0
    extra["holes_zero_states"] = 1 + sum(1 for x in hole_counts if x == 0)
    extra["ops_per_open_min"] = min(patch_ops) if patch_ops else 0
    extra["ops_per_open_max"] = max(patch_ops) if patch_ops else 0
    return w.close("W1", params, extra, expected_source="analytic: sphere (1,max(h-1,0),[h=0]); "
                   "torus (1,2+max(h-1,0),[h=0]); h = number of holes")
