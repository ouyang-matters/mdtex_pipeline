#!/usr/bin/env python3
"""Independent validator for MMHM `.seq` files (SPEC 6.1 and SPEC 1).

Replays the file and checks, for every atomic edit:
  * syntax: `+ v0 [v1 ...]` / `- v0 [v1 ...]` inside an INIT/UPDATE block;
  * vertices are integers in [0, 2^32), pairwise distinct, 1..D+1 of them;
  * insert: the simplex is absent and all its facets are present;
  * delete: the simplex is present and has no coface present.
and the block structure: header `MMHMSEQ 1`, `dim D` with 0 <= D <= 3, exactly
one INIT block first, then UPDATE blocks, every block closed by END.
'#' starts a comment that runs to the end of the line; blank lines are
ignored.

State: dict simplex(sorted tuple) -> number of cofaces present, so each edit is
O(dim) dictionary operations. It does not import any generator code.

Exit status 0 when valid, 1 when invalid (first error reported with its line).
"""

from __future__ import annotations

import argparse
import json
import sys
import time

VMAX = 1 << 32


class SeqError(Exception):
    def __init__(self, lineno, msg):
        super().__init__(f"line {lineno}: {msg}")
        self.lineno = lineno


def validate(path):
    st = {}
    n = [0, 0, 0, 0]
    D = None
    block = None
    seen_init = False
    n_updates = 0
    ops = 0
    ops_max = 0
    ops_total = 0
    empty_updates = 0
    unsorted = 0
    init_ops = 0
    header = False
    with open(path, "r", encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            if "#" in line:
                line = line[:line.index("#")]
            parts = line.split()
            if not parts:
                continue
            tok = parts[0]
            if tok == "+" or tok == "-":
                if block is None:
                    raise SeqError(lineno, "edit outside INIT/UPDATE block")
                try:
                    vs = [int(x) for x in parts[1:]]
                except ValueError:
                    raise SeqError(lineno, f"non-integer vertex in {line.strip()!r}")
                k = len(vs)
                if k == 0:
                    raise SeqError(lineno, "edit without vertices")
                if k > D + 1:
                    raise SeqError(lineno, f"simplex of dimension {k - 1} > D = {D}")
                s = tuple(sorted(vs))
                if s != tuple(vs):
                    unsorted += 1
                for i in range(k):
                    v = s[i]
                    if v < 0 or v >= VMAX:
                        raise SeqError(lineno, f"vertex {v} outside [0, 2^32)")
                    if i and s[i - 1] == v:
                        raise SeqError(lineno, f"repeated vertex {v}")
                ops += 1
                if tok == "+":
                    if s in st:
                        raise SeqError(lineno, f"insert of present simplex {s}")
                    if k > 1:
                        for i in range(k):
                            f = s[:i] + s[i + 1:]
                            c = st.get(f)
                            if c is None:
                                raise SeqError(lineno, f"insert {s}: facet {f} absent")
                        for i in range(k):
                            st[s[:i] + s[i + 1:]] += 1
                    st[s] = 0
                    n[k - 1] += 1
                else:
                    c = st.get(s)
                    if c is None:
                        raise SeqError(lineno, f"delete of absent simplex {s}")
                    if c:
                        raise SeqError(lineno, f"delete {s}: {c} coface(s) still present")
                    del st[s]
                    if k > 1:
                        for i in range(k):
                            st[s[:i] + s[i + 1:]] -= 1
                    n[k - 1] -= 1
            elif tok == "END":
                if block is None:
                    raise SeqError(lineno, "END without open block")
                if block == "INIT":
                    init_ops = ops
                else:
                    n_updates += 1
                    ops_total += ops
                    ops_max = max(ops_max, ops)
                    if ops == 0:
                        empty_updates += 1
                block = None
            elif tok == "INIT":
                if D is None:
                    raise SeqError(lineno, "INIT before dim line")
                if block is not None:
                    raise SeqError(lineno, "INIT inside a block")
                if seen_init:
                    raise SeqError(lineno, "second INIT block")
                seen_init = True
                block = "INIT"
                ops = 0
            elif tok == "UPDATE":
                if block is not None:
                    raise SeqError(lineno, "UPDATE inside a block")
                if not seen_init:
                    raise SeqError(lineno, "UPDATE before INIT")
                block = "UPDATE"
                ops = 0
            elif tok == "MMHMSEQ":
                if header or len(parts) != 2 or parts[1] != "1":
                    raise SeqError(lineno, f"bad header {line.strip()!r}")
                header = True
            elif tok == "dim":
                if not header:
                    raise SeqError(lineno, "dim before MMHMSEQ header")
                if D is not None or len(parts) != 2:
                    raise SeqError(lineno, "bad or repeated dim line")
                D = int(parts[1])
                if not 0 <= D <= 3:
                    raise SeqError(lineno, f"dim {D} not in 0..3")
            else:
                raise SeqError(lineno, f"unknown token {tok!r}")
    if not header:
        raise SeqError(0, "missing MMHMSEQ header")
    if block is not None:
        raise SeqError(lineno, f"unterminated {block} block at end of file")
    if not seen_init:
        raise SeqError(lineno, "no INIT block")
    return {
        "valid": True,
        "dim": D,
        "init_ops": init_ops,
        "updates": n_updates,
        "update_ops_total": ops_total,
        "update_ops_max": ops_max,
        "update_ops_mean": ops_total / n_updates if n_updates else 0.0,
        "empty_updates": empty_updates,
        "unsorted_vertex_lists": unsorted,
        "final": {"n0": n[0], "n1": n[1], "n2": n[2], "n3": n[3]},
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("seq", nargs="+")
    ap.add_argument("--quiet", "-q", action="store_true")
    a = ap.parse_args(argv)
    bad = 0
    for p in a.seq:
        t0 = time.perf_counter()
        try:
            rep = validate(p)
            rep["seconds"] = round(time.perf_counter() - t0, 3)
            if not a.quiet:
                print(json.dumps({"file": p, **rep}))
        except (SeqError, OSError, ValueError) as e:
            bad += 1
            print(json.dumps({"file": p, "valid": False, "error": str(e)}))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
