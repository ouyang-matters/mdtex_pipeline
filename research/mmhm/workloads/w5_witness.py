"""W5 — non-locality witnesses (SPEC 6, W5).

(a) Cycle graph C_L (vertices 0..L-1, edges {i, i+1 mod L}); every update is
    one edit toggling the fixed edge {e, e+1 mod L} (default e = 0):
    odd updates delete it, even updates reinsert it.
    Betti: INIT (1,1,0,0); after a deletion (1,0,0,0).
(b) Geodesic icosphere (frequency f, level L means f = 2^L); every update
    toggles one fixed triangle (chosen by the seed): delete / reinsert.
    Betti: INIT (1,0,1,0); after a deletion (1,0,0,0).
"""

from __future__ import annotations

import random

from common import SeqWriter
from meshes import closure, icosphere


def generate_cycle(stem, L=1000, edge=0, updates=1000, seed=0, check=False):
    if L < 3:
        raise ValueError("L >= 3")
    e0 = edge % L
    tog = tuple(sorted((e0, (e0 + 1) % L)))
    params = dict(L=L, edge=e0, toggled=list(tog), updates=updates, seed=seed)
    w = SeqWriter(stem, 1, comments=[
        "W5a cycle toggle: " + " ".join(f"{a}={b}" for a, b in params.items())],
        check=check)
    verts = [(i,) for i in range(L)]
    edges = sorted(tuple(sorted((i, (i + 1) % L))) for i in range(L))
    w.init_complex([verts, edges], (1, 1, 0, 0))
    present = True
    for t in range(updates):
        w.begin_update()
        if present:
            w.dele(tog)
        else:
            w.ins(tog)
        present = not present
        w.end_block((1, 1 if present else 0, 0, 0))
    return w.close("W5a", params, {"cycle_length": L},
                   expected_source="analytic: beta1 = [toggled edge present]")


def generate_sphere(stem, level=None, freq=None, updates=1000, seed=0, check=False):
    rng = random.Random(seed)
    if freq is None:
        if level is None:
            raise ValueError("needs --level or --freq")
        freq = 2 ** level
    nv, tris = icosphere(freq)
    tog = tris[rng.randrange(len(tris))]
    params = dict(level=level, freq=freq, toggled=list(tog), updates=updates,
                  seed=seed)
    w = SeqWriter(stem, 2, comments=[
        "W5b sphere puncture toggle: " + " ".join(f"{a}={b}" for a, b in params.items())],
        check=check)
    w.init_complex(closure(tris), (1, 0, 1, 0))
    present = True
    for t in range(updates):
        w.begin_update()
        if present:
            w.dele(tog)
        else:
            w.ins(tog)
        present = not present
        w.end_block((1, 0, 1 if present else 0, 0))
    return w.close("W5b", params, {"n2": len(tris)},
                   expected_source="analytic: beta2 = [toggled triangle present]")
