#!/usr/bin/env python3
"""GUDHI oracle and `gudhi` baseline timing for MMHM `.seq` files.

Replays a `.seq` (SPEC 6.1) on a gudhi.SimplexTree:
  * `+ s`  ->  st.insert(s, 0.0)            (all facets already present)
  * `- s`  ->  st.remove_maximal_simplex(s) (no coface present)
After INIT and after each UPDATE it calls
  st.compute_persistence(homology_coeff_field=2, persistence_dim_max=True)
  st.betti_numbers()
and writes the Betti file (SPEC 6.2): one line `b0 b1 b2 b3` per state,
always 4 integers, zeros above the top dimension.

GUDHI facts this relies on (checked by workloads/test_workloads.py against a
brute-force Z2 rank computation, including after removals):
  * `persistence_dim_max=True` is REQUIRED. With the default (False) GUDHI
    does not compute homology in the top dimension of the complex: a hollow
    tetrahedron reports [1, 0] instead of [1, 0, 1], and a complex made only
    of vertices reports [] instead of [b0].
  * `homology_coeff_field=2` (default is 11): e.g. RP^2 has beta = (1,1,1)
    over Z2 but (1,0,0) over Z11.
  * isolated vertices are counted in b0; betti_numbers() has length
    dimension()+1 (empty list for the empty complex), so it is zero-padded.
  * every compute_persistence() call rebuilds the filtration order and the
    persistent-cohomology object from the current tree, also after
    remove_maximal_simplex (the dimension is lowered when the top cells go).

Timing (--csv): per state, `time_ns` covers the edits of the block plus
compute_persistence plus betti_numbers (time.perf_counter_ns); parsing is done
beforehand and excluded. Row t = 0 is INIT (build from empty + persistence).
CSV columns: t,ops,time_ns,b0,b1,b2,b3
"""

from __future__ import annotations

import argparse
import sys
import time

import gudhi


def parse_seq(path, max_updates=None):
    """Returns (D, init_ops, updates); ops are (sign, [vertices]) with
    sign True for insert. '#' starts a comment running to the end of the
    line; blank lines are skipped."""
    D = None
    init = None
    updates = []
    cur = None
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            if "#" in line:
                line = line[:line.index("#")]
            parts = line.split()
            if not parts:
                continue
            tok = parts[0]
            if tok == "+":
                cur.append((True, [int(x) for x in parts[1:]]))
            elif tok == "-":
                cur.append((False, [int(x) for x in parts[1:]]))
            elif tok == "END":
                if init is None:
                    init = cur
                else:
                    updates.append(cur)
                cur = None
            elif tok == "INIT" or tok == "UPDATE":
                if (tok == "UPDATE" and max_updates is not None
                        and len(updates) >= max_updates):
                    break
                cur = []
            elif tok == "dim":
                D = int(parts[1])
            elif tok == "MMHMSEQ":
                if parts[1:] != ["1"]:
                    raise ValueError(f"unsupported format {line.strip()!r}")
            else:
                raise ValueError(f"unknown token {tok!r}")
    if init is None:
        raise ValueError("no INIT block")
    return D, init, updates


def _apply(st, ops):
    ins = st.insert
    rem = st.remove_maximal_simplex
    for sign, s in ops:
        if sign:
            ins(s, 0.0)
        else:
            rem(s)


def betti4(st):
    st.compute_persistence(homology_coeff_field=2, persistence_dim_max=True)
    b = list(st.betti_numbers())
    if len(b) > 4:
        if any(b[4:]):
            raise RuntimeError(f"non-zero Betti number above dimension 3: {b}")
        b = b[:4]
    return b + [0] * (4 - len(b))


def run(path, betti_out=None, csv_out=None, max_updates=None, progress=False):
    D, init, updates = parse_seq(path, max_updates)
    st = gudhi.SimplexTree()
    pc = time.perf_counter_ns
    rows = []
    bettis = []

    t0 = pc()
    _apply(st, init)
    b = betti4(st)
    t1 = pc()
    rows.append((0, len(init), t1 - t0, b))
    bettis.append(b)
    for t, ops in enumerate(updates, 1):
        t0 = pc()
        _apply(st, ops)
        b = betti4(st)
        t1 = pc()
        rows.append((t, len(ops), t1 - t0, b))
        bettis.append(b)
        if progress and t % 100 == 0:
            print(f"  {t}/{len(updates)}", file=sys.stderr)

    if betti_out:
        with open(betti_out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(" ".join(map(str, b)) for b in bettis))
            fh.write("\n")
    if csv_out:
        with open(csv_out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("t,ops,time_ns,b0,b1,b2,b3\n")
            for t, ops, ns, b in rows:
                fh.write(f"{t},{ops},{ns},{b[0]},{b[1]},{b[2]},{b[3]}\n")
    return bettis, rows


def read_betti(path):
    with open(path, "r", encoding="utf-8") as fh:
        return [[int(x) for x in line.split()] for line in fh if line.strip()]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("seq")
    ap.add_argument("--betti-out", "-o", help="Betti file to write (SPEC 6.2)")
    ap.add_argument("--csv", help="per-update timing CSV to write")
    ap.add_argument("--max-updates", type=int, help="process only the first T updates")
    ap.add_argument("--expected", help="Betti file to compare against (exit 2 on mismatch)")
    ap.add_argument("--progress", action="store_true")
    a = ap.parse_args(argv)
    t0 = time.perf_counter()
    bettis, rows = run(a.seq, a.betti_out, a.csv, a.max_updates, a.progress)
    secs = time.perf_counter() - t0
    upd_ns = [r[2] for r in rows[1:]]
    msg = (f"{a.seq}: {len(rows) - 1} updates, final betti {bettis[-1]}, "
           f"init {rows[0][2] / 1e9:.3f}s, update mean "
           f"{(sum(upd_ns) / len(upd_ns) / 1e6) if upd_ns else 0:.3f}ms, wall {secs:.1f}s")
    print(msg)
    if a.expected:
        exp = read_betti(a.expected)
        bad = [i for i, b in enumerate(bettis) if i >= len(exp) or exp[i] != b]
        if bad:
            i = bad[0]
            print(f"MISMATCH at state {i}: gudhi {bettis[i]} expected "
                  f"{exp[i] if i < len(exp) else None} ({len(bad)} mismatching states)")
            return 2
        print(f"matches {a.expected} on all {len(bettis)} states")
    return 0


if __name__ == "__main__":
    sys.exit(main())
