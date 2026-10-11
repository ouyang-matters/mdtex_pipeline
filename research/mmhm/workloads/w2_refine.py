"""W2 — refine/coarsen in a 3-ball (SPEC 6, W2).

Base: Freudenthal/Kuhn tetrahedralization of [0,N]^3 (6 tets per cube).

Refine update  = s 1->4 stellar subdivisions of the tets of a spatial cluster:
                 a breadth-first set of s face-adjacent tets grown from a
                 uniformly random current tet. One subdivision of t = (a,b,c,d)
                 with a fresh vertex w is 16 edits:
                   - t ; + w ; + 4 edges (x,w) ; + 6 triangles (x,y,w) ;
                   + 4 tets (x,y,z,w)
                 Child tets may be refined again (nested refinement).
Coarsen update = exact inverses of s *leaf* subdivisions (records whose 4
                 child tets are all still present): a uniformly random leaf
                 and its s-1 nearest leaves (Euclidean distance between the
                 inserted vertices). One inverse is 16 edits:
                   - 4 child tets ; - 6 triangles ; - 4 edges ; - w ; + t

Bounded size. Coarsening can only undo subdivisions, so the INIT complex
already contains `warmup` subdivisions (applied as refine clusters before
INIT is written). With x = number of live subdivisions, an update refines with
probability clamp(0.5 - 0.5 (x - warmup) / spread, 0.05, 0.95) (forced refine
when fewer than s leaves exist). x therefore performs a mean-reverting random
walk around its initial value `warmup`, and |K| = |K_base| + 14 x fluctuates
around |K_0| with no linear drift.

Betti numbers are constant (1, 0, 0, 0): stellar moves preserve the PL type.
"""

from __future__ import annotations

import random
from collections import Counter, deque
from itertools import combinations

import numpy as np

from common import IndexedSet, SeqWriter
from meshes import closure, freudenthal


def generate(stem, N=8, s=8, warmup=None, spread=None, updates=1000, seed=0,
             check=False):
    if N < 1 or s < 1:
        raise ValueError("N >= 1 and s >= 1")
    rng = random.Random(seed)
    if warmup is None:
        warmup = 8 * s
    if spread is None:
        spread = max(warmup, s)

    nv, coords, base_tets = freudenthal(N)
    coords = list(coords)
    next_vid = nv

    tets = IndexedSet(base_tets)
    face2tets = {}
    for t in base_tets:
        for f in combinations(t, 3):
            face2tets.setdefault(f, []).append(t)

    # subdivision records: rid -> [w, parent_tet, children(tuple), parent_rid]
    recs = {}
    present = {}              # rid -> number of its children currently present
    rec_of = {}               # tet -> rid of the record that created it
    leaves = IndexedSet()
    next_rid = 0
    stats = Counter()

    def subdivide(t, emit):
        nonlocal next_vid, next_rid
        w_ = next_vid
        next_vid += 1
        cs = [coords[x] for x in t]
        coords.append(tuple(sum(c[i] for c in cs) / 4.0 for i in range(3)))
        a, b, c, d = t
        children = tuple(sorted(f + (w_,) for f in combinations(t, 3)))
        inner = [(x, y, w_) for (x, y) in combinations(t, 2)]
        if emit is not None:
            emit.dele(t)
            emit.ins((w_,))
            for x in t:
                emit.ins((x, w_))
            for tri in inner:
                emit.ins(tri)
            for ch in children:
                emit.ins(ch)
        tets.remove(t)
        for ch in children:
            tets.add(ch)
        for f in combinations(t, 3):
            lst = face2tets[f]
            lst[lst.index(t)] = f + (w_,)
        for (x, y, _) in inner:
            face2tets[(x, y, w_)] = [ch for ch in children if x in ch and y in ch]
        prid = rec_of.pop(t, None)
        if prid is not None:
            if present[prid] == 4:
                leaves.remove(prid)
            present[prid] -= 1
            stats["nested_subdivisions"] += 1
        rid = next_rid
        next_rid += 1
        recs[rid] = (w_, t, children, prid)
        present[rid] = 4
        leaves.add(rid)
        for ch in children:
            rec_of[ch] = rid

    def coarsen(rid, emit):
        w_, t, children, prid = recs.pop(rid)
        assert present.pop(rid) == 4
        leaves.remove(rid)
        inner = [(x, y, w_) for (x, y) in combinations(t, 2)]
        if emit is not None:
            for ch in children:
                emit.dele(ch)
            for tri in sorted(inner):
                emit.dele(tri)
            for x in sorted(t):
                emit.dele((x, w_))
            emit.dele((w_,))
            emit.ins(t)
        for ch in children:
            tets.remove(ch)
            del rec_of[ch]
        tets.add(t)
        for f in combinations(t, 3):
            lst = face2tets[f]
            lst[lst.index(f + (w_,))] = t
        for tri in inner:
            del face2tets[tri]
        if prid is not None:
            rec_of[t] = prid
            present[prid] += 1
            if present[prid] == 4:
                leaves.add(prid)

    def refine_cluster(count, emit):
        seed_t = tets.choice(rng)
        chosen = [seed_t]
        seen = {seed_t}
        q = deque([seed_t])
        while q and len(chosen) < count:
            t = q.popleft()
            for f in combinations(t, 3):
                for u in face2tets[f]:
                    if u not in seen:
                        seen.add(u)
                        chosen.append(u)
                        q.append(u)
                        if len(chosen) >= count:
                            break
                if len(chosen) >= count:
                    break
        for t in chosen:
            subdivide(t, emit)
        return len(chosen)

    def coarsen_cluster(count, emit):
        ids = list(leaves.items)
        seed_r = ids[rng.randrange(len(ids))]
        P = np.array([coords[recs[r][0]] for r in ids])
        c = np.array(coords[recs[seed_r][0]])
        d2 = ((P - c) ** 2).sum(axis=1)
        order = np.lexsort((np.array(ids), d2))[:count]
        for i in order:
            coarsen(ids[int(i)], emit)
        return len(order)

    # ---- warm-up: live subdivisions present in K_0
    while len(recs) < warmup:
        refine_cluster(min(s, warmup - len(recs)), None)

    params = dict(N=N, s=s, warmup=warmup, spread=spread, updates=updates,
                  seed=seed)
    w = SeqWriter(stem, 3, comments=[
        "W2 refine/coarsen in a 3-ball: " + " ".join(f"{a}={b}" for a, b in params.items())],
        check=check)
    w.init_complex(closure(tets.items), (1, 0, 0, 0))

    live = []
    nleaves = []
    for t in range(updates):
        x = len(recs)
        if len(leaves) < s:
            refine = True
            stats["forced_refine"] += 1
        else:
            p = min(0.95, max(0.05, 0.5 - 0.5 * (x - warmup) / spread))
            refine = rng.random() < p
        w.begin_update()
        if refine:
            refine_cluster(s, w)
            stats["refine_updates"] += 1
        else:
            coarsen_cluster(s, w)
            stats["coarsen_updates"] += 1
        w.end_block((1, 0, 0, 0))
        live.append(len(recs))
        nleaves.append(len(leaves))

    extra = dict(stats)
    extra["base_tets"] = len(base_tets)
    extra["live_subdivisions_initial"] = warmup
    extra["live_subdivisions_min"] = min(live) if live else warmup
    extra["live_subdivisions_max"] = max(live) if live else warmup
    extra["live_subdivisions_final"] = len(recs)
    extra["leaves_min"] = min(nleaves) if nleaves else 0
    extra["leaves_max"] = max(nleaves) if nleaves else 0
    extra["max_vertex_id"] = next_vid - 1
    return w.close("W2", params, extra, expected_source="analytic: stellar moves preserve the 3-ball")
