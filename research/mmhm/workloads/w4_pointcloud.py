"""W4 — moving point cloud, flag complex (SPEC 6, W4).

n points uniform in [0,1]^a (a = 2 or 3). eps is calibrated on the initial
points so that the eps-neighbourhood graph has exactly round(degree * n / 2)
edges (mean degree = `degree`). K = flag (clique) complex of that graph up to
dimension D (default 2; D = 3 adds the 4-cliques).

Update = move one uniformly random point p by a displacement with each
coordinate uniform in [-step*eps, step*eps], reflected at the border; then
  delete the closed star of p top-down (tets, triangles, edges containing p,
  each dimension in sorted order, then the vertex p), and
  insert p and its new star bottom-up (vertex, edges to all points within
  eps, then the triangles / tets that are cliques).
The vertex id of p is kept. Neighbour queries use a uniform grid of cell size
eps, so an update costs O(local density), independent of n.

Adjacency test everywhere: dx*dx + dy*dy (+ dz*dz) <= eps2 in float64, the
same expression for the initial build and for updates.
"""

from __future__ import annotations

import math
import random
from collections import Counter

import numpy as np
from scipy.spatial import cKDTree

from common import SeqWriter


def _sqdist_np(P, I, J):
    acc = None
    for a in range(P.shape[1]):
        d = P[I, a] - P[J, a]
        acc = d * d if acc is None else acc + d * d
    return acc


def generate(stem, n=1000, ambient=2, degree=10.0, D=2, step=0.25,
             updates=1000, seed=0, check=False):
    if ambient not in (2, 3):
        raise ValueError("ambient dimension must be 2 or 3")
    if not 1 <= D <= 3:
        raise ValueError("D in 1..3")
    if n < 3:
        raise ValueError("n >= 3")
    rng = random.Random(seed)
    pts = [[rng.random() for _ in range(ambient)] for _ in range(n)]
    P = np.array(pts, dtype=np.float64)

    # ---- eps calibration: exactly M = round(degree n / 2) pairs within eps
    M = int(round(degree * n / 2))
    if not 1 <= M < n * (n - 1) // 2:
        raise ValueError("degree out of range")
    cd = math.pi if ambient == 2 else 4.0 * math.pi / 3.0
    r = 1.3 * (degree / (n * cd)) ** (1.0 / ambient)
    tree = cKDTree(P)
    while True:
        pairs = tree.query_pairs(r * (1 + 1e-9), output_type="ndarray")
        if len(pairs) > M or r > 2.0:
            break
        r *= 1.4
    d2 = _sqdist_np(P, pairs[:, 0], pairs[:, 1])
    order = np.argsort(d2, kind="stable")
    d2s = d2[order]
    if len(d2s) > M:
        eps2 = float((d2s[M - 1] + d2s[M]) / 2.0)
    else:
        eps2 = float(d2s[-1]) * (1 + 1e-12)
    eps = math.sqrt(eps2)
    keep = d2 <= eps2
    E = pairs[keep]

    adj = [set() for _ in range(n)]
    for i, j in E.tolist():
        adj[i].add(j)
        adj[j].add(i)

    # ---- grid
    G = max(1, int(1.0 / eps))
    cell_size = 1.0 / G          # >= eps, so +-1 cells cover the eps-ball

    def cell_of(x):
        return tuple(min(G - 1, int(c / cell_size)) for c in x)

    grid = {}
    cell = [None] * n
    for i in range(n):
        c = cell_of(pts[i])
        cell[i] = c
        grid.setdefault(c, set()).add(i)
    if ambient == 2:
        offsets = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
    else:
        offsets = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                   for dz in (-1, 0, 1)]

    def neighbours(i):
        x = pts[i]
        c = cell[i]
        out = []
        for off in offsets:
            cc = tuple(a + b for a, b in zip(c, off))
            bucket = grid.get(cc)
            if not bucket:
                continue
            for j in bucket:
                if j == i:
                    continue
                y = pts[j]
                if ambient == 2:
                    dx = x[0] - y[0]
                    dy = x[1] - y[1]
                    dd = dx * dx + dy * dy
                else:
                    dx = x[0] - y[0]
                    dy = x[1] - y[1]
                    dz = x[2] - y[2]
                    dd = dx * dx + dy * dy + dz * dz
                if dd <= eps2:
                    out.append(j)
        return out

    # sanity: the grid reproduces the calibrated graph for a few points
    for i in range(0, n, max(1, n // 50)):
        assert set(neighbours(i)) == adj[i], "grid/KD-tree adjacency mismatch"

    # ---- initial flag complex
    verts = [(i,) for i in range(n)]
    edges = sorted((min(i, j), max(i, j)) for i, j in E.tolist())
    tris, tets4 = [], []
    if D >= 2:
        for (u, v) in edges:
            for x in adj[u] & adj[v]:
                if x > v:
                    tris.append((u, v, x))
        tris.sort()
    if D >= 3:
        for (u, v, x) in tris:
            for y in adj[u] & adj[v] & adj[x]:
                if y > x:
                    tets4.append((u, v, x, y))
        tets4.sort()

    params = dict(n=n, ambient=ambient, degree=degree, D=D, step=step,
                  updates=updates, seed=seed)
    w = SeqWriter(stem, D, comments=[
        "W4 moving point cloud flag complex: " + " ".join(f"{a}={b}" for a, b in params.items()),
        f"eps={eps!r}"], check=check)
    w.init_complex([verts, edges, tris, tets4][:D + 1])

    def star(p):
        Np = adj[p]
        e = sorted((min(p, u), max(p, u)) for u in Np)
        tr, te = [], []
        if D >= 2:
            for u in Np:
                common = adj[u] & Np
                for x in common:
                    if x > u:
                        tr.append(tuple(sorted((p, u, x))))
                        if D >= 3:
                            for y in adj[x] & common:
                                if y > x:
                                    te.append(tuple(sorted((p, u, x, y))))
        tr.sort()
        te.sort()
        return e, tr, te

    delta = step * eps
    stats = Counter()
    star_sizes = []
    for t in range(updates):
        p = rng.randrange(n)
        x = pts[p]
        newx = []
        for a in range(ambient):
            v = x[a] + rng.uniform(-delta, delta)
            if v < 0.0:
                v = -v
            elif v > 1.0:
                v = 2.0 - v
            newx.append(v)
        w.begin_update()
        e, tr, te = star(p)
        for s_ in te:
            w.dele(s_)
        for s_ in tr:
            w.dele(s_)
        for s_ in e:
            w.dele(s_)
        w.dele((p,))
        for u in adj[p]:
            adj[u].discard(p)
        adj[p] = set()
        grid[cell[p]].discard(p)
        pts[p] = newx
        cell[p] = cell_of(newx)
        grid.setdefault(cell[p], set()).add(p)
        nb = neighbours(p)
        adj[p] = set(nb)
        for u in nb:
            adj[u].add(p)
        e2, tr2, te2 = star(p)
        w.ins((p,))
        for s_ in e2:
            w.ins(s_)
        for s_ in tr2:
            w.ins(s_)
        for s_ in te2:
            w.ins(s_)
        w.end_block()
        star_sizes.append(1 + len(e2) + len(tr2) + len(te2))

    extra = dict(stats)
    extra["eps"] = eps
    extra["eps2"] = eps2
    extra["mean_degree_initial"] = 2.0 * len(edges) / n
    extra["mean_degree_final"] = 2.0 * w.n[1] / n
    extra["grid_cells_per_axis"] = G
    if star_sizes:
        extra["closed_star_size_mean"] = sum(star_sizes) / len(star_sizes)
        extra["closed_star_size_max"] = max(star_sizes)
    return w.close("W4", params, extra)
