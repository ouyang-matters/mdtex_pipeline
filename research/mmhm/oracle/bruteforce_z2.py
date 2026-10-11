#!/usr/bin/env python3
"""Brute-force Z2 Betti numbers (small complexes only).

beta_k = n_k - rank(B_k) - rank(B_{k+1}) with every boundary matrix built
explicitly as a dense 0/1 numpy array and ranked by Gaussian elimination over
GF(2) on bit-packed rows. Shares no code with GUDHI or the engine; used to
verify the GUDHI oracle (workloads/test_workloads.py) and, via the CLI, to
replay a small `.seq` file into a Betti file.
"""

from __future__ import annotations

import argparse
import sys
from itertools import combinations

import numpy as np


def gf2_rank(M) -> int:
    """Rank over GF(2) of a 0/1 matrix (any integer/bool dtype)."""
    M = np.asarray(M, dtype=bool)
    if M.size == 0:
        return 0
    if M.shape[0] > M.shape[1]:
        M = M.T
    A = np.packbits(M, axis=1)           # rows x ceil(cols/8), big-endian bits
    rows, cols = M.shape
    r = 0
    for c in range(cols):
        byte, mask = c >> 3, np.uint8(0x80 >> (c & 7))
        hits = np.flatnonzero(A[r:, byte] & mask)
        if hits.size == 0:
            continue
        p = r + int(hits[0])
        if p != r:
            A[[r, p]] = A[[p, r]]
        below = r + 1 + np.flatnonzero(A[r + 1:, byte] & mask)
        if below.size:
            A[below, byte:] ^= A[r, byte:]
        r += 1
        if r == rows:
            break
    return r


def betti_z2(simplices, maxdim=3):
    """simplices: iterable of vertex tuples forming a simplicial complex.
    Returns [b0, b1, b2, b3] (entries above maxdim are 0)."""
    by = [[] for _ in range(4)]
    for s in simplices:
        s = tuple(sorted(s))
        by[len(s) - 1].append(s)
    idx = [{s: i for i, s in enumerate(sorted(g))} for g in by]
    n = [len(g) for g in by]
    rank = [0] * 5
    for k in range(1, 4):
        if n[k] == 0 or n[k - 1] == 0:
            continue
        B = np.zeros((n[k - 1], n[k]), dtype=bool)
        for s, j in idx[k].items():
            for f in combinations(s, k):
                B[idx[k - 1][f], j] = True
        rank[k] = gf2_rank(B)
    b = [n[k] - rank[k] - rank[k + 1] for k in range(4)]
    return [b[k] if k <= maxdim else 0 for k in range(4)]


def replay(path, max_updates=None):
    """Replay a .seq naively (set of simplices) and return Betti per state."""
    K = set()
    out = []
    started = False
    nupd = 0
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            if "#" in line:
                line = line[:line.index("#")]
            p = line.split()
            if not p:
                continue
            if p[0] == "+":
                K.add(tuple(sorted(int(x) for x in p[1:])))
            elif p[0] == "-":
                K.remove(tuple(sorted(int(x) for x in p[1:])))
            elif p[0] == "END":
                out.append(betti_z2(K))
                if started:
                    nupd += 1
                    if max_updates is not None and nupd >= max_updates:
                        break
                started = True
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("seq")
    ap.add_argument("--betti-out", "-o")
    ap.add_argument("--max-updates", type=int)
    a = ap.parse_args(argv)
    res = replay(a.seq, a.max_updates)
    text = "\n".join(" ".join(map(str, b)) for b in res) + "\n"
    if a.betti_out:
        with open(a.betti_out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
