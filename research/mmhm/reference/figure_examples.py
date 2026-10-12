#!/usr/bin/env python3
"""Computes, prints and checks every entry shown in the paper's two worked
figures (paper/figures/f2_deletion.tex, paper/figures/f3_morse.tex) with the
reference implementation drb_ref.py. Run:  python3 figure_examples.py

Figure 2 (deletion cases), on graphs, rows = vertices with keys 0<1<2<3, columns
= edges in insertion order:
  Case A  triangle 0-1-2, edges inserted 01, 02, 12; delete 01.
  Case B  star with centre 3, edges inserted 03, 13, 23; delete 03.
Figure 3 (Morse order): the complex with vertices 0..3, edges 01, 02, 03, 12, 23
and the triangle 012 (a square with a diagonal, one half filled), collapse with
the FIFO discipline of drb_ref.collapse, static reduction with clearing in the
Morse order.
"""
import sys

from drb_ref import Complex, SimplicialDRB, collapse, facets, morse_keys

FAIL = []


def check(cond, msg):
    if not cond:
        FAIL.append(msg)
        print("  FAIL:", msg)


def name(s):
    return "".join(str(v) for v in s)


def chain(c):
    return "{" + ",".join(sorted(name(x) for x in c)) + "}" if c else "0"


def slots(D, k=1):
    d = D.drb[k]
    out = []
    for j in sorted(d.R):
        R, V = d.R[j], d.V[j]
        out.append((j, frozenset(R), frozenset(V), max(R, key=d.rkey) if R else None))
    return out


def show(D, label):
    print(f"  {label}: beta = {D.betti()[:2]}")
    for j, R, V, low in slots(D):
        print(f"    slot s{j + 1}: V = {chain(V):14s} R = {chain(R):10s} low = "
              f"{name(low) if low else '-'}")


def deletion_case(title, vertices, edges, sigma, expect_case, before, after, betti):
    print(title)
    D = SimplicialDRB(1)
    for v in vertices:
        D.insert((v,))
    for e in edges:
        D.insert(e)
    show(D, "before")
    got = {(R, V) for _, R, V, _ in slots(D)}
    check(got == before, f"{title}: slots before")
    check(tuple(D.betti()[:2]) == betti[0], f"{title}: betti before")
    occ = sorted(D.drb[1].occ[sigma])
    print(f"  footprint occ({name(sigma)}) = {['s%d' % (j + 1) for j in occ]}")
    case = D.delete(sigma)
    print(f"  delete {name(sigma)}: Case {case}")
    check(case == expect_case, f"{title}: case")
    show(D, "after")
    got = {(R, V) for _, R, V, _ in slots(D)}
    check(got == after, f"{title}: slots after")
    check(tuple(D.betti()[:2]) == betti[1], f"{title}: betti after")
    return occ


def fs(*cells):
    return frozenset(tuple(sorted(c)) for c in cells)


def vs(*vertices):
    return frozenset((v,) for v in vertices)


def main():
    # ---- Figure 2, Case A --------------------------------------------------
    occ = deletion_case(
        "Case A (triangle, delete 01)", [0, 1, 2], [(0, 1), (0, 2), (1, 2)], (0, 1), "A",
        before={(vs(0, 1), fs((0, 1))), (vs(0, 2), fs((0, 2))),
                (frozenset(), fs((0, 1), (0, 2), (1, 2)))},
        after={(vs(0, 1), fs((0, 2), (1, 2))), (vs(0, 2), fs((0, 2)))},
        betti=((1, 1), (1, 0)))
    check(len(occ) == 2, "Case A: footprint has two slots")

    # ---- Figure 2, Case B --------------------------------------------------
    occ = deletion_case(
        "Case B (star, delete 03)", [0, 1, 2, 3], [(0, 3), (1, 3), (2, 3)], (0, 3), "B",
        before={(vs(0, 3), fs((0, 3))), (vs(0, 1), fs((1, 3), (0, 3))),
                (vs(0, 2), fs((2, 3), (0, 3)))},
        after={(vs(1, 3), fs((1, 3))), (vs(1, 2), fs((2, 3), (1, 3)))},
        betti=((1, 0), (2, 0)))
    check(len(occ) == 3, "Case B: footprint has three slots")
    # the wrong choice: adding the slot with the LARGEST low (R = {0,3}, low 3)
    # to the other two gives them the same low 3
    R1, R2, Rp = {0, 1}, {0, 2}, {0, 3}
    w1, w2 = R1 ^ Rp, R2 ^ Rp
    print(f"  wrong choice (largest low): {sorted(w1)} and {sorted(w2)} -> lows "
          f"{max(w1)} and {max(w2)}")
    check(max(w1) == max(w2) == 3, "Case B: largest-low choice duplicates low 3")

    # ---- Figure 3: Morse order --------------------------------------------
    print("Morse order (square 0-1-2-3 with diagonal 02, triangle 012 filled)")
    K = Complex(2)
    for s in [(0,), (1,), (2,), (3,), (0, 1), (0, 2), (0, 3), (1, 2), (2, 3), (0, 1, 2)]:
        K.add(s)
    rm, pairs, critical = collapse(K)
    seq = sorted(rm, key=lambda x: rm[x])
    print("  removal sequence:", " ".join(f"{name(x)}@{rm[x]}" for x in seq))
    print("  pairs:", [(name(x), name(y)) for x, y in pairs])
    print("  critical:", [name(c) for c in critical])
    check([(name(x), name(y)) for x, y in pairs] == [("01", "012"), ("1", "12"),
                                                    ("2", "23"), ("0", "03")], "pairs")
    check([name(c) for c in critical] == ["02", "3"], "critical cells")
    key = morse_keys(rm)
    order = sorted(key, key=lambda x: key[x])
    print("  Morse order (increasing key):", " < ".join(name(x) for x in order))
    check([name(x) for x in order] == ["3", "0", "03", "2", "23", "02", "1", "12", "01",
                                       "012"], "Morse order")
    # every pair is adjacent in the order and is an apparent pair
    for x, y in pairs:
        check(key[y] == key[x] + 1, f"pair {name(x)},{name(y)} adjacent")
    D = SimplicialDRB(2)
    for s in sorted(K.cof, key=lambda s: (len(s), s)):
        D.insert(s)
    stats = {}
    D.rebuild("morse", stats=stats)
    for k in (2, 1):
        for c in sorted(stats[k], key=lambda c: D.key[c]):
            cleared, nadd, low, added = stats[k][c]
            print(f"  B{k} column {name(c):3s}: " +
                  ("cleared" if cleared else
                   f"{nadd} additions {[name(a) for a in added]}, low {name(low) if low else '0'}"))
    check(stats[2][(0, 1, 2)] == (False, 0, (0, 1), []), "012 apparent with low 01")
    check(stats[1][(0, 1)][0], "column 01 cleared (Corollary 2.1)")
    for y, x in [((2, 3), (2,)), ((0, 3), (0,)), ((1, 2), (1,))]:
        check(stats[1][y] == (False, 0, x, []), f"{name(y)} apparent with low {name(x)}")
    check(stats[1][(0, 2)] == (False, 2, None, [(2, 3), (0, 3)]),
          "critical column 02: adds bd23 then bd03 and reduces to 0")
    print("  betti:", D.betti()[:3])
    check(D.betti()[:3] == [1, 1, 0], "betti (1,1,0)")
    # the working column of 02, step by step (rows = vertices)
    R = {0, 2}
    steps = [sorted(R, key=lambda v: key[(v,)])]
    for y in [(2, 3), (0, 3)]:
        R ^= set(v for f in facets(y) for v in f)
        steps.append(sorted(R, key=lambda v: key[(v,)]))
    print("  column 02 during its reduction:", steps)
    check(steps == [[0, 2], [3, 0], []], "steps of column 02 (rows in key order)")
    print("FAILURES:", len(FAIL))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
