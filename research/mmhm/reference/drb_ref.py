#!/usr/bin/env python3
"""MMHM v2 pure-Python reference implementation (clarity over speed).

Implements, following research/mmhm/SPEC.md exactly:

  SPEC 2    dynamic reduced basis (DRB): insert (2.1), delete Case A / Case B (2.2)
  SPEC 3    collapse-based acyclic matching, Morse order; insertion order
  SPEC 4    static reduction with clearing, tracking V (rebuild / FULL baselines)
  SPEC 5    methods drb-id, mmhm, mmhm-norb, full-id, full-morse, lcr
  SPEC 6.1  .seq reader;  SPEC 6.2  Betti-file writer

Z2 chains are Python sets of cells; a cell is a sorted tuple of vertices.
Nothing here is optimised: every step is the literal algorithm of the spec, so
that the code can serve as an oracle and as the executable form of the proofs.

Usage:
  drb_ref.py --seq FILE [--method mmhm] [--betti-out FILE] [--period M]
             [--alpha A] [--check-invariants] [--max-updates T]
"""

from __future__ import annotations

import argparse
import heapq
import math
import sys
from collections import deque

METHODS = ("drb-id", "mmhm", "mmhm-norb", "full-id", "full-morse", "lcr")


class EditError(ValueError):
    """An atomic edit that would not leave K a simplicial complex (SPEC 1)."""


def facets(s):
    """Codimension-1 faces of the simplex s (sorted tuple); [] for a vertex."""
    if len(s) == 1:
        return []
    return [s[:i] + s[i + 1:] for i in range(len(s))]


# ---------------------------------------------------------------------------
# .seq reader (SPEC 6.1) and Betti writer (SPEC 6.2)
# ---------------------------------------------------------------------------

def parse_seq(path):
    """Return (D, init_ops, updates); ops are (sign, simplex) with sign in '+-'."""
    D = None
    init, updates, block = None, [], None
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    if not lines or lines[0].split("#")[0].split() != ["MMHMSEQ", "1"]:
        raise ValueError(f"{path}: missing 'MMHMSEQ 1' header")
    for lineno, raw in enumerate(lines[1:], start=2):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        tok = line.split()
        if tok[0] == "dim":
            D = int(tok[1])
            if not 0 <= D <= 3:
                raise ValueError(f"{path}:{lineno}: dim must be in 0..3")
        elif tok[0] in ("INIT", "UPDATE"):
            if block is not None:
                raise ValueError(f"{path}:{lineno}: nested block")
            if tok[0] == "INIT" and (init is not None or updates):
                raise ValueError(f"{path}:{lineno}: INIT must come first, once")
            block = []
            if tok[0] == "INIT":
                init = block
            else:
                updates.append(block)
        elif tok[0] == "END":
            if block is None:
                raise ValueError(f"{path}:{lineno}: END outside a block")
            block = None
        elif tok[0] in ("+", "-"):
            if block is None:
                raise ValueError(f"{path}:{lineno}: edit outside a block")
            verts = tuple(sorted(int(v) for v in tok[1:]))
            if not verts or len(set(verts)) != len(verts) or len(verts) > 4:
                raise ValueError(f"{path}:{lineno}: bad simplex {tok[1:]}")
            if verts[0] < 0 or verts[-1] >= 2 ** 32:
                raise ValueError(f"{path}:{lineno}: vertex out of range")
            block.append((tok[0], verts))
        else:
            raise ValueError(f"{path}:{lineno}: unknown line {raw!r}")
    if D is None:
        raise ValueError(f"{path}: missing 'dim' line")
    if block is not None:
        raise ValueError(f"{path}: unterminated block")
    return D, (init or []), updates


def betti_line(b):
    return " ".join(str(x) for x in (list(b) + [0, 0, 0, 0])[:4])


# ---------------------------------------------------------------------------
# The simplicial complex itself
# ---------------------------------------------------------------------------

class Complex:
    """Finite simplicial complex with immediate-coface sets."""

    def __init__(self, D):
        self.D = D
        self.cells = [set() for _ in range(4)]   # K_k
        self.cof = {}                             # cell -> set of immediate cofaces

    def __contains__(self, s):
        return s in self.cof

    def __len__(self):
        return len(self.cof)

    def n(self):
        return [len(c) for c in self.cells]

    def check_insert(self, s):
        if s in self.cof:
            raise EditError(f"insert {s}: already present")
        if len(s) - 1 > self.D:
            raise EditError(f"insert {s}: dimension exceeds dim {self.D}")
        for f in facets(s):
            if f not in self.cof:
                raise EditError(f"insert {s}: facet {f} missing")

    def check_delete(self, s):
        if s not in self.cof:
            raise EditError(f"delete {s}: not present")
        if self.cof[s]:
            raise EditError(f"delete {s}: has cofaces {sorted(self.cof[s])}")

    def add(self, s):
        self.check_insert(s)
        self.cells[len(s) - 1].add(s)
        self.cof[s] = set()
        for f in facets(s):
            self.cof[f].add(s)

    def remove(self, s):
        self.check_delete(s)
        self.cells[len(s) - 1].remove(s)
        del self.cof[s]
        for f in facets(s):
            self.cof[f].discard(s)


# ---------------------------------------------------------------------------
# DRB of one boundary matrix (SPEC 2). Generic over rows/columns so that the
# matrix-level E1 example can be run through exactly the same code.
# ---------------------------------------------------------------------------

class ColumnDRB:
    """Slots j hold (R_j, V_j) with  (I1) R_j = B V_j,  (I2) distinct lows of
    non-zero R_j,  (I3) {V_j} a basis of the column space C_k.
    pivot[row] -> slot (non-zero R only);  occ[col] -> {j : col in V_j}."""

    def __init__(self, rkey, track_V=True):
        self.rkey = rkey          # row -> order key ord(row)
        self.track_V = track_V
        self.R = {}
        self.V = {}
        self.pivot = {}
        self.occ = {}
        self._next = 0
        # instrumentation (SPEC 7): column additions, footprints, per-op work
        self.adds = 0
        self.footprint = 0
        self.work = 0             # sum of |operand| over all symmetric differences + occ updates

    # -- helpers -----------------------------------------------------------
    def low(self, chain):
        return max(chain, key=self.rkey)

    def nnz(self):
        return sum(map(len, self.R.values())) + sum(map(len, self.V.values()))

    def rank(self):
        return len(self.pivot)

    def _occ_toggle(self, x, j):
        s = self.occ.setdefault(x, set())
        if j in s:
            s.remove(j)
            if not s:
                del self.occ[x]
        else:
            s.add(j)
        self.work += 1

    def _store(self, R, V):
        j = self._next
        self._next += 1
        self.R[j] = R
        self.V[j] = V
        for x in V:
            self._occ_toggle(x, j)
        if R:
            l = self.low(R)
            assert l not in self.pivot, "I2 violated on store"
            self.pivot[l] = j
        return j

    def _drop(self, j):
        R = self.R.pop(j)
        V = self.V.pop(j)
        if R:
            del self.pivot[self.low(R)]
        for x in V:
            self._occ_toggle(x, j)

    def _add_V(self, j, src):
        """V_j ^= src, keeping occ the inverted index of V."""
        Vj = self.V[j]
        for x in src:
            if x in Vj:
                Vj.remove(x)
            else:
                Vj.add(x)
            self._occ_toggle(x, j)

    def reduce(self, R, V, trace=None):
        """Left-to-right reduction of a fresh column (R, V) against the pivots.
        If `trace` is a list, the slots added are appended to it in order."""
        while R:
            p = self.pivot.get(self.low(R))
            if p is None:
                break
            R ^= self.R[p]
            V ^= self.V[p]
            self.adds += 1
            self.work += len(self.R[p]) + len(self.V[p])
            if trace is not None:
                trace.append(p)
        return R, V

    # -- SPEC 2.1 ----------------------------------------------------------
    def insert(self, col, boundary):
        """Insert column `col` with B-column `boundary`. Returns 'positive' if the
        reduced column is zero (beta_k += 1) and 'negative' otherwise."""
        R, V = self.reduce(set(boundary), {col} if self.track_V else set())
        self.work += len(R) + len(V)
        self._store(R, V)
        return "negative" if R else "positive"

    # -- SPEC 2.2 ----------------------------------------------------------
    def delete(self, col):
        """Delete column `col` (its row in the next matrix must be zero).
        Returns 'A' (col lies on a cycle: beta_k -= 1) or 'B' (rank -= 1)."""
        assert self.track_V, "deletion needs V"
        O = sorted(self.occ.get(col, ()))
        assert O, "occ[col] is empty: (I3) violated"
        self.footprint += len(O)
        Z = [j for j in O if not self.R[j]]
        if Z:                                            # Case A
            z = min(Z, key=lambda j: (len(self.V[j]), j))  # heuristic; any z works
            Vz = self.V[z]
            for j in O:
                if j != z:
                    self._add_V(j, Vz)                   # R_j unchanged: B V_z = 0
                    self.adds += 1
            self._drop(z)
            case = "A"
        else:                                            # Case B
            p = min(O, key=lambda j: self.rkey(self.low(self.R[j])))  # forced
            Rp, Vp = self.R[p], self.V[p]
            for j in O:
                if j != p:
                    old_low = self.low(self.R[j])
                    self.R[j] ^= Rp
                    self.work += len(Rp)
                    assert self.R[j] and self.low(self.R[j]) == old_low
                    self._add_V(j, Vp)
                    self.adds += 1
            self._drop(p)
            case = "B"
        assert col not in self.occ, "column still referenced after deletion"
        return case

    # -- SPEC 4 ------------------------------------------------------------
    @classmethod
    def build(cls, rkey, columns, boundary, clear=None, track_V=True, stats=None):
        """Static reduction with clearing. `columns` in increasing ord;
        `clear` maps a column to the reduced column R of the next matrix whose
        low is that column (then R_col := 0, V_col := R). `stats`, if given,
        receives col -> (cleared?, number of additions, low or None, columns
        added in order)."""
        d = cls(rkey, track_V=track_V)
        slot_col = {}
        for c in columns:
            if clear is not None and c in clear:
                slot_col[d._store(set(), set(clear[c]) if track_V else set())] = c
                if stats is not None:
                    stats[c] = (True, 0, None, [])
                continue
            trace = []
            R, V = d.reduce(set(boundary(c)), {c} if track_V else set(), trace)
            slot_col[d._store(R, V)] = c
            if stats is not None:
                stats[c] = (False, len(trace), d.low(R) if R else None,
                            [slot_col[p] for p in trace])
        return d

    def clearing_map(self):
        """low(R_j) -> R_j for every non-zero slot: the clearing data for the
        next lower dimension (rows of this matrix are columns of that one)."""
        return {l: self.R[j] for l, j in self.pivot.items()}


class ColumnLCR:
    """v1's localized column re-reduction WITHOUT basis tracking (SPEC 5 'lcr').
    Insert = reduce the new column against the pivots; delete = clear the
    column's own pivot and drop it. Deliberately NOT exact (erratum E1)."""

    def __init__(self, rkey):
        self.rkey = rkey
        self.R = {}
        self.pivot = {}
        self.pivot_of = {}        # col -> the pivot row it was assigned

    def low(self, chain):
        return max(chain, key=self.rkey)

    def rank(self):
        return len(self.pivot)

    def insert(self, col, boundary):
        R = set(boundary)
        while R:
            p = self.pivot.get(self.low(R))
            if p is None:
                break
            R ^= self.R[p]
        self.R[col] = R
        if R:
            self.pivot[self.low(R)] = col
            self.pivot_of[col] = self.low(R)
        return "negative" if R else "positive"

    def delete(self, col):
        self.R.pop(col)
        row = self.pivot_of.pop(col, None)
        if row is not None and self.pivot.get(row) == col:
            del self.pivot[row]

    def replace(self, col, boundary):
        """v1 2.3 'column replacement': clear own pivot, re-reduce this column only."""
        self.delete(col)
        return self.insert(col, boundary)


# ---------------------------------------------------------------------------
# SPEC 3: collapse-based acyclic matching and the Morse order
# ---------------------------------------------------------------------------

def collapse(K, rng=None):
    """Deterministic collapse matching (SPEC 3). Returns (rm, pairs, critical):
    rm[cell] = removal time, pairs = [(x, y)] with x a facet of y, critical cells.
    Queue discipline: FIFO, initialised in (dim, vertex tuple) order. Lemma 2
    holds for any discipline; only the matching depends on it. Passing a
    random.Random as `rng` pops a uniformly random queued face instead (used by
    check_props to test that claim)."""
    P = set(K.cof)
    cof = {x: len(K.cof[x]) for x in P}
    Q = deque(sorted((x for x in P if cof[x] == 1), key=lambda s: (len(s), s)))
    heap = [(-len(s), s) for s in P]
    heapq.heapify(heap)
    rm, pairs, critical = {}, [], []
    t = 0

    def remove(c):
        P.discard(c)
        for f in facets(c):
            cof[f] -= 1
            if cof[f] == 1 and f in P:
                Q.append(f)

    while True:
        while Q:
            if rng is None:
                x = Q.popleft()
            else:
                i = rng.randrange(len(Q))
                Q[i], Q[-1] = Q[-1], Q[i]
                x = Q.pop()
            if x not in P or cof[x] != 1:
                continue
            ys = [c for c in K.cof[x] if c in P]
            assert len(ys) == 1
            y = ys[0]                     # maximal in P (diamond property)
            pairs.append((x, y))
            rm[y] = t
            rm[x] = t + 1
            t += 2
            remove(y)
            remove(x)
        while heap and heap[0][1] not in P:
            heapq.heappop(heap)
        if not heap:
            break
        c = heapq.heappop(heap)[1]        # highest dimension, smallest tuple
        critical.append(c)
        rm[c] = t
        t += 1
        remove(c)
    return rm, pairs, critical


def morse_keys(rm):
    """ord(x) := -rm(x), mapped to 0..N-1 (later removal => smaller key)."""
    N = len(rm)
    return {x: N - 1 - r for x, r in rm.items()}


# ---------------------------------------------------------------------------
# DRB over a simplicial complex (one ColumnDRB per dimension k >= 1)
# ---------------------------------------------------------------------------

class SimplicialDRB:
    def __init__(self, D):
        self.D = D
        self.K = Complex(D)
        self.key = {}                 # ord of every present cell
        self.next_key = 0
        self.drb = {k: ColumnDRB(self._rkey) for k in range(1, D + 1)}
        self.last_case = None

    def _rkey(self, x):
        return self.key[x]

    # atomic edits ------------------------------------------------------------
    def insert(self, s):
        self.K.add(s)
        self.key[s] = self.next_key   # larger than every key in use
        self.next_key += 1
        k = len(s) - 1
        self.last_case = "positive" if k == 0 else self.drb[k].insert(s, facets(s))
        return self.last_case

    def delete(self, s):
        self.K.check_delete(s)
        k = len(s) - 1
        self.last_case = "A" if k == 0 else self.drb[k].delete(s)
        self.K.remove(s)
        del self.key[s]
        return self.last_case

    # queries -----------------------------------------------------------------
    def ranks(self):
        r = [0] * 5
        for k, d in self.drb.items():
            r[k] = d.rank()
        return r

    def betti(self):
        n, r = self.K.n(), self.ranks()
        return [n[k] - r[k] - r[k + 1] for k in range(4)]

    def nnz(self):
        return sum(d.nnz() for d in self.drb.values())

    # SPEC 4 rebuild ----------------------------------------------------------
    def rebuild(self, order, stats=None, clearing=True, track_V=True, rng=None):
        """Static reduction with clearing (and V) under the given order:
        'morse' recomputes the collapse matching and re-keys every cell;
        'id' keeps the current (insertion) keys."""
        info = None
        if order == "morse":
            rm, pairs, critical = collapse(self.K, rng)
            self.key = morse_keys(rm)
            self.next_key = len(self.key)
            info = (rm, pairs, critical)
        elif order != "id":
            raise ValueError(order)
        self.drb = {}
        clear = None
        for k in range(self.D, 0, -1):
            cols = sorted(self.K.cells[k], key=self._rkey)
            st = {} if stats is not None else None
            d = ColumnDRB.build(self._rkey, cols, facets,
                                clear=clear if clearing else None,
                                track_V=track_V, stats=st)
            if stats is not None:
                stats[k] = st
            self.drb[k] = d
            clear = d.clearing_map()
        return info


# ---------------------------------------------------------------------------
# Methods (SPEC 5)
# ---------------------------------------------------------------------------

class Method:
    """Runs one SPEC-5 method over INIT + UPDATE blocks."""

    def __init__(self, name, D, period=math.inf, alpha=1.0):
        if name not in METHODS:
            raise ValueError(f"unknown method {name}")
        self.name, self.D = name, D
        self.period = period if name == "mmhm" else math.inf
        self.alpha = alpha if name == "mmhm" else math.inf
        self.t_last = 0
        self.nnz_last = 0
        self.rebuilds = 0
        if name in ("drb-id", "mmhm", "mmhm-norb"):
            self.S = SimplicialDRB(D)
        else:
            self.K = Complex(D)
            self.key = {}             # insertion keys, never reused
            self.next_key = 0
            if name == "lcr":
                self.lcr = {k: ColumnLCR(self.key.__getitem__) for k in range(1, D + 1)}

    # build -------------------------------------------------------------------
    def build(self, init_ops):
        for sign, s in init_ops:
            if sign != "+":
                raise EditError("INIT may only insert")
        if hasattr(self, "S"):
            for _, s in init_ops:          # K_0 with insertion keys, then static build
                self.S.K.add(s)
                self.S.key[s] = self.S.next_key
                self.S.next_key += 1
            self.S.rebuild("id" if self.name == "drb-id" else "morse")
            self.nnz_last = self.S.nnz()
        else:
            for _, s in init_ops:
                self._plain_apply("+", s, during_init=True)
            if self.name == "lcr":       # static reduction of K_0, insertion order
                self._lcr_static()
        return self.betti()

    def _lcr_static(self):
        for k in range(1, self.D + 1):
            self.lcr[k] = ColumnLCR(self.key.__getitem__)
            for s in sorted(self.K.cells[k], key=self.key.__getitem__):
                self.lcr[k].insert(s, facets(s))

    def _plain_apply(self, sign, s, during_init=False):
        if sign == "+":
            self.K.add(s)
            self.key[s] = self.next_key
            self.next_key += 1
            if self.name == "lcr" and not during_init and len(s) > 1:
                self.lcr[len(s) - 1].insert(s, facets(s))
        else:
            self.K.check_delete(s)
            if self.name == "lcr" and len(s) > 1:
                self.lcr[len(s) - 1].delete(s)
            self.K.remove(s)
            # lcr keeps keys of deleted cells: stale columns may still mention them

    # updates -----------------------------------------------------------------
    def apply(self, sign, s):
        if hasattr(self, "S"):
            return self.S.insert(s) if sign == "+" else self.S.delete(s)
        return self._plain_apply(sign, s)

    def end_update(self, t):
        """Called after update t (1-based); applies the SPEC 5.1 rebuild policy."""
        rebuilt = False
        if self.name == "mmhm":
            n_cells = len(self.S.K)
            grow = self.S.nnz() > (1 + self.alpha) * max(self.nnz_last, n_cells)
            if t - self.t_last >= self.period or grow:
                self.S.rebuild("morse")
                self.t_last, self.nnz_last = t, self.S.nnz()
                self.rebuilds += 1
                rebuilt = True
        return rebuilt

    def betti(self):
        if hasattr(self, "S"):
            return self.S.betti()
        n = self.K.n()
        r = [0] * 5
        if self.name == "lcr":
            for k in range(1, self.D + 1):
                r[k] = self.lcr[k].rank()
        else:
            S = SimplicialDRB(self.D)     # throwaway: static reduction, ranks only
            S.K = self.K
            if self.name == "full-id":
                S.key = dict(self.key)
                S.rebuild("id", track_V=False)
            else:
                S.rebuild("morse", track_V=False)
            r = S.ranks()
        return [n[k] - r[k] - r[k + 1] for k in range(4)]


def run(path, method, period=math.inf, alpha=1.0, check=None, max_updates=None):
    """Run a method over a .seq file; returns the list of Betti 4-tuples."""
    D, init, updates = parse_seq(path)
    m = Method(method, D, period=period, alpha=alpha)
    out = [m.build(init)]
    if check:
        check(m)
    for t, upd in enumerate(updates, start=1):
        if max_updates is not None and t > max_updates:
            break
        for sign, s in upd:
            m.apply(sign, s)
            if check:
                check(m)
        m.end_update(t)
        if check:
            check(m)
        out.append(m.betti())
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--seq", required=True)
    ap.add_argument("--method", default="mmhm", choices=METHODS)
    ap.add_argument("--betti-out")
    ap.add_argument("--period", type=float, default=math.inf)
    ap.add_argument("--alpha", type=float, default=1.0)
    ap.add_argument("--max-updates", type=int)
    ap.add_argument("--check-invariants", action="store_true",
                    help="verify (I1)-(I3) after every atomic edit (slow)")
    a = ap.parse_args(argv)
    check = None
    if a.check_invariants:
        from check_props import check_invariants   # same directory
        check = lambda m: check_invariants(m.S) if hasattr(m, "S") else None
    try:
        res = run(a.seq, a.method, a.period, a.alpha, check, a.max_updates)
    except EditError as e:
        print(f"invalid edit: {e}", file=sys.stderr)
        return 2
    text = "".join(betti_line(b) + "\n" for b in res)
    if a.betti_out:
        with open(a.betti_out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
