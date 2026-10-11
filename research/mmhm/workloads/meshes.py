"""Base meshes and small combinatorial-topology helpers for the generators.

All meshes are purely combinatorial: vertices are 0..nv-1, top simplices are
sorted tuples. Geometry is only produced where a generator needs it (W2/W3).
"""

from __future__ import annotations

from collections import Counter, deque
from itertools import combinations, permutations

# Regular icosahedron, 12 vertices / 20 faces (standard orientation-free list).
ICO_FACES = [
    (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
    (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
    (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
    (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
]


def _sorted3(a, b, c):
    if a > b:
        a, b = b, a
    if b > c:
        b, c = c, b
    if a > b:
        a, b = b, a
    return (a, b, c)


def icosphere(freq: int):
    """Geodesic sphere: every icosahedron face split into freq^2 triangles.

    freq = 2**L gives the classical level-L subdivision (each level splits a
    triangle into 4). Returns (nv, triangles) with nv = 10 f^2 + 2 and
    20 f^2 triangles. Points are identified across faces by their barycentric
    key over the icosahedron vertices, so shared edges are glued exactly.
    """
    if freq < 1:
        raise ValueError("freq >= 1")
    key2id: dict = {}
    tris = []
    for (A, B, C) in ICO_FACES:
        P = {}
        for i in range(freq + 1):
            for j in range(freq + 1 - i):
                w = ((A, freq - i - j), (B, i), (C, j))
                key = tuple(sorted(x for x in w if x[1] > 0))
                v = key2id.get(key)
                if v is None:
                    v = key2id[key] = len(key2id)
                P[i, j] = v
        for i in range(freq):
            for j in range(freq - i):
                tris.append(_sorted3(P[i, j], P[i + 1, j], P[i, j + 1]))
                if i + j <= freq - 2:
                    tris.append(_sorted3(P[i + 1, j], P[i, j + 1], P[i + 1, j + 1]))
    nv = len(key2id)
    assert nv == 10 * freq * freq + 2 and len(tris) == 20 * freq * freq
    assert len(set(tris)) == len(tris)
    return nv, sorted(tris)


def torus_grid(n: int, m: int):
    """n x m periodic grid, each square split by its (i,j)-(i+1,j+1) diagonal.
    A valid simplicial complex for n, m >= 3. Returns (nv, triangles)."""
    if n < 3 or m < 3:
        raise ValueError("torus grid needs n, m >= 3")

    def v(i, j):
        return (i % n) * m + (j % m)

    tris = []
    for i in range(n):
        for j in range(m):
            a, b, c, d = v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)
            tris.append(_sorted3(a, b, c))
            tris.append(_sorted3(a, c, d))
    assert len(set(tris)) == len(tris)
    return n * m, sorted(tris)


def freudenthal(N: int):
    """Freudenthal/Kuhn triangulation of [0,N]^3: 6 tets per unit cube, all
    along monotone lattice paths, so the cubes glue into a simplicial complex.
    Returns (nv, coords, tets) with coords[v] = (i, j, k) / N."""
    if N < 1:
        raise ValueError("N >= 1")
    M = N + 1

    def vid(i, j, k):
        return (i * M + j) * M + k

    coords = [None] * (M ** 3)
    for i in range(M):
        for j in range(M):
            for k in range(M):
                coords[vid(i, j, k)] = (i / N, j / N, k / N)
    units = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
    tets = []
    for i in range(N):
        for j in range(N):
            for k in range(N):
                for perm in permutations(range(3)):
                    p = [i, j, k]
                    path = [vid(*p)]
                    for ax in perm:
                        p[ax] += 1
                        path.append(vid(*p))
                    tets.append(tuple(sorted(path)))
    assert len(set(tets)) == len(tets) == 6 * N ** 3
    return M ** 3, coords, sorted(tets)


def freudenthal_boundary_vertex(N: int):
    M = N + 1

    def is_bd(v):
        k = v % M
        j = (v // M) % M
        i = v // (M * M)
        return i in (0, N) or j in (0, N) or k in (0, N)

    return is_bd


# ---------------------------------------------------------------- helpers


def closure(tops):
    """All faces of the given simplices, grouped by dimension, each sorted."""
    tops = list(tops)
    if not tops:
        return []
    d = max(len(t) for t in tops) - 1
    out = [set() for _ in range(d + 1)]
    for t in tops:
        k = len(t)
        for r in range(1, k + 1):
            out[r - 1].update(combinations(t, r))
    return [sorted(s) for s in out]


def adjacency(nv, tops):
    adj = [set() for _ in range(nv)]
    for t in tops:
        for a, b in combinations(t, 2):
            adj[a].add(b)
            adj[b].add(a)
    return adj


def vertex_star(nv, tops):
    star = [[] for _ in range(nv)]
    for t in tops:
        for v in t:
            star[v].append(t)
    return star


def bfs_ball(adj, v, r):
    """Vertices at graph distance <= r from v (r >= 0)."""
    seen = {v}
    frontier = [v]
    for _ in range(r):
        nxt = []
        for u in frontier:
            for w in adj[u]:
                if w not in seen:
                    seen.add(w)
                    nxt.append(w)
        frontier = nxt
        if not frontier:
            break
    return seen


def expand(adj, vs, r):
    """Vertices at graph distance <= r from the set vs."""
    seen = set(vs)
    frontier = list(vs)
    for _ in range(r):
        nxt = []
        for u in frontier:
            for w in adj[u]:
                if w not in seen:
                    seen.add(w)
                    nxt.append(w)
        frontier = nxt
    return seen


def _link_ok(link_edges, want_cycle_only):
    """link_edges: list of (a, b). True iff they form one path or one cycle
    (only a cycle if want_cycle_only)."""
    deg = Counter()
    nbr = {}
    for a, b in link_edges:
        deg[a] += 1
        deg[b] += 1
        nbr.setdefault(a, []).append(b)
        nbr.setdefault(b, []).append(a)
    if not deg or max(deg.values()) > 2:
        return False
    V, E = len(deg), len(link_edges)
    # connected?
    start = next(iter(deg))
    seen = {start}
    st = [start]
    while st:
        x = st.pop()
        for y in nbr[x]:
            if y not in seen:
                seen.add(y)
                st.append(y)
    if len(seen) != V:
        return False
    if E == V:
        return True  # cycle
    if want_cycle_only:
        return False
    return E == V - 1  # path


def surface_type(tris):
    """Classify a set of triangles (sorted 3-tuples) as a 2-complex.

    Returns 'disk', 'sphere', or None (anything else: not a connected
    2-manifold, or wrong Euler characteristic)."""
    tris = list(tris)
    if not tris:
        return None
    ecount = Counter()
    vlink = {}
    for (a, b, c) in tris:
        ecount[(a, b)] += 1
        ecount[(a, c)] += 1
        ecount[(b, c)] += 1
        vlink.setdefault(a, []).append((b, c))
        vlink.setdefault(b, []).append((a, c))
        vlink.setdefault(c, []).append((a, b))
    if max(ecount.values()) > 2:
        return None
    closed = all(x == 2 for x in ecount.values())
    for v, le in vlink.items():
        if not _link_ok(le, want_cycle_only=closed):
            return None
    # edge-connectivity of triangles
    e2t = {}
    for idx, (a, b, c) in enumerate(tris):
        for e in ((a, b), (a, c), (b, c)):
            e2t.setdefault(e, []).append(idx)
    seen = {0}
    st = [0]
    while st:
        i = st.pop()
        a, b, c = tris[i]
        for e in ((a, b), (a, c), (b, c)):
            for j in e2t[e]:
                if j not in seen:
                    seen.add(j)
                    st.append(j)
    if len(seen) != len(tris):
        return None
    chi = len(vlink) - len(ecount) + len(tris)
    if closed and chi == 2:
        return "sphere"
    if not closed and chi == 1:
        return "disk"
    return None
