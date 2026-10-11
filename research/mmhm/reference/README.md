# reference/ — pure-Python DRB and proof sanity checks

Executable form of SPEC §2–§4 and of the theory section of the paper
(`paper/sections/theory.tex`). Clarity over speed: Z2 chains are Python sets,
every step is the literal algorithm of the spec. No dependencies beyond the
Python 3 standard library.

| file | what it is |
|---|---|
| `drb_ref.py` | `.seq` reader (§6.1), DRB insert (§2.1) and delete Case A/B (§2.2), collapse matching + Morse order (§3), static reduction with clearing tracking `V` (§4), methods `drb-id`, `mmhm`, `mmhm-norb`, `full-id`, `full-morse`, `lcr` (§5, incl. the §5.1 rebuild policy), Betti writer (§6.2) |
| `check_props.py` | randomized checks of Theorem 1, Lemma 2 and its corollaries, Proposition 4, and the searches that produce the E1/E2 counterexamples of the erratum |
| `counterexamples.json` | output of `check_props.py --write counterexamples.json` (seed 20250817): every recorded instance below, machine-readable |

```
python3 drb_ref.py --seq FILE --method mmhm [--period M] [--alpha A] [--betti-out OUT] [--check-invariants]
python3 check_props.py [--quick] [--seed S] [--write counterexamples.json]
```
`check_props.py` takes about 18 s (`--quick`: 2 s) and exits non-zero on any
failure. `--check-invariants` makes `drb_ref.py` verify (I1)–(I3) after every
atomic edit (slow; for small samples).

Conventions of the reference (all allowed by SPEC): the INIT block is loaded
and then reduced by the static reduction with clearing (§4), with insertion
keys for `drb-id` and the Morse order for `mmhm*`; the collapse queue is FIFO,
initialised in (dimension, vertex tuple) order; Case A picks the zero slot with
the smallest `|V|` (ties by slot id). `lcr` uses insertion keys and never
forgets a key, so stale columns that mention deleted cells stay well defined.

## What each check verifies (seed 20250817, full run)

**(a) Theorem 1 — exactness of the DRB.** 600 random valid edit sequences
(5–8 vertex universes, dim 2 or 3; every fifth starts from a seed complex:
7-vertex torus, 6-vertex RP², boundary of the 4-simplex, octahedron), cut into
batches of 1–4 edits; 33,892 atomic edits, each run under four configurations
(`drb-id`, `mmhm-norb`, `mmhm` with period 2, `mmhm` with α = 0.1, which
rebuilds often: 9,551 rebuilds). After INIT, after **every atomic edit** and
after every rebuild: (I1) `R_j = ∂V_j`; (I2) distinct lows and `pivot` equal to
the recomputed low table; (I3) `#slots = n_k`, `V_j ⊆ K_k`, and the `V_j` are
GF(2)-independent (bitmask rank); `occ` equal to the recomputed inverted index;
and the Betti numbers equal a brute-force GF(2) rank computation that shares no
code with the DRB. 128,511 invariant checks, 142,854 Betti checks, 0 failures.
Every branch is exercised in every dimension (counts are over all four
configurations): insert positive/negative, delete Case A/B for k = 1, 2, 3
(e.g. 3-simplices: 3,896 negative and 1,028 positive inserts, 972 Case A and
2,520 Case B deletes). `full-id` and `full-morse` agree with brute force on
every update; `lcr` is wrong on 3,970 of 11,947 updates (33%).

**(b) Lemma 2 and Corollaries 2.1/2.2 — the Morse order.** 1,200 complexes
(the seeds; full 2-skeleta of Δ⁵, Δ⁶ and the 3-skeleton of Δ⁵; random
closures of simplices up to dim 3; random flag complexes; random graphs; chains
of cycles joined by bridges and 3×3 tori with 1–3 disks glued on a meridian,
both built so that the collapse matching is *not* perfect and critical columns
interact); every third complex uses a uniformly random queue discipline in the
collapse instead of FIFO. Checks: `ord` is a filtration order; the matching
has no closed V-path and `rm` strictly increases along V-paths; for each of the
22,164 gradient pairs `(τ, σ)`: τ is the youngest facet of σ, σ is the oldest
coface of τ, and in the static reduction both **with and without clearing**
column σ is not cleared, takes pivot τ and performs **zero additions**
(all 22,164 apparent); every lower cell of dim ≥ 1 is cleared (13,622);
all 14,265 column additions happen in columns of critical cells (Cor. 2.1);
in every dimension all critical cells precede all lower cells in `ord`; for
each of the 3,347 critical columns: the reduced column contains no lower cell,
its critical part equals the reduced column of the Morse boundary matrix
(computed independently by gradient-path counting and a separate reduction
with clearing), clearing decisions agree, and the additions are apparent-then-
critical with the critical ones identical to the Morse reduction's (Cor. 2.2;
124 critical-column additions occur). Upper cells do remain in 127 reduced
critical columns, so the paper does not claim otherwise. The Morse complex has
the brute-force Betti numbers in every case.

**(c) E1 — v1's rule without basis tracking (`lcr`).**
*Matrix instance (SPEC §0):* `B = [a | b]`, `a = b = e1`; after replacing `a`
by `e2`, `lcr` reports rank 1 (`R_b` stays 0), the DRB reports 2 = true rank.
*Simplicial instance, shortest by exhaustive search:* all valid atomic edit
sequences with vertices labelled in order of first insertion (up to 4 vertices,
dim ≤ 2) were enumerated: 1, 2, 5, 15, 61, 263 sequences of length 1–6 — `lcr`
is right on all of them — and 1,250 of length 7, of which 18 make `lcr` wrong
at the last edit. (Length ≤ 6 with ≥ 5 vertices leaves ≤ 1 non-vertex edit, on
which `lcr` is trivially exact, so 7 is the minimum over all sequences.)
Recorded instance (insertion-order keys):

```
+ 0 ; + 1 ; + 2 ; + 0 1 ; + 0 2 ; + 1 2 ; - 0 1
```
After `+ 1 2` the column of `{1,2}` is reduced by adding the columns of
`{0,2}` and `{0,1}`, so `R_{12} = 0`. Deleting `{0,1}` makes `lcr` free only the
pivot of `{0,1}`; `R_{12}` stays 0 although `{1,2}` no longer lies on a cycle.
`lcr` reports β = (2, 1, 0, 0); the truth (path 1–2–0) and the DRB give
(1, 0, 0, 0). The failing edit deletes an edge, so the row set of B₁ does not
change and v1's "re-initialise the pivot map when rows change" clause does not
apply.

**(d) E2 — the affected set `critical ∩ directly modified` is wrong.**
Matching = collapse matching of SPEC §3; edit = deletion of a maximal cell `y`
that is the upper cell of a gradient pair `(x, y)`; maintenance convention =
keep every other pair, `x` becomes critical (the restriction of an acyclic
matching is acyclic). Morse boundaries are computed by counting gradient paths
mod 2 (and validated: the Morse complex always has the true Betti numbers).
v1's stale update recomputes only critical columns among `{y} ∪ facets(y)`.

*Smallest instance found (8 cells):* the 4-cycle with edges
`{0,1} {1,2} {2,3} {0,3}`. Collapse: critical `{0,1}` and `{3}`; pairs
`({1},{1,2})`, `({0},{0,3})`, `({2},{2,3})`. Delete the matched edge `{2,3}`
(so `{2}` becomes critical). `∂^M{0,1}` changes from `0` to `{2}+{3}`, although
`{0,1}` shares no vertex with `{2,3}`. True Betti after: (1, 0, 0, 0); v1's
stale critical complex: (2, 1, 0, 0).

*Instance with a far critical triangle (61 cells):* the 3×3 grid torus on
vertices 1..9 (vertex (i,j) ↦ 1 + 3i + j, triangles `{(i,j),(i+1,j),(i+1,j+1)}`
and `{(i,j),(i,j+1),(i+1,j+1)}`, indices mod 3) plus the cone with apex 0 over
the meridian 1–4–7. Collapse: critical `{0,1,4}`, `{1,2,5}`, `{3,4}`, `{3,8}`,
`{9}`. Delete the matched triangle `{6,7,9}` (paired with edge `{6,9}`):
`∂^M{1,2,5}` changes from `0` to `{6,9}`; `{1,2,5}` and `{6,7,9}` share no
vertex. True Betti after: (1, 1, 0, 0); v1's stale critical complex:
(1, 2, 1, 0). Full pair lists are in `counterexamples.json`.

**(e) Proposition 4 — W5 non-locality.** Cycle graph `C_L` toggling edge
`{0,1}`, and the bipyramid sphere over an `L/2`-cycle (`n₂ = L` triangles)
toggling one triangle, for L = 8 … 128, insertion and Morse order. Asserted for
every toggle: deletion is Case A, deletion work ≥ L (resp. n₂), insertion work
≥ L − 1 (resp. n₂ − 1); and after the first deletion the states are exactly
2-periodic. Measured steady-state toggle work (elementary chain/occ
operations): 4.0·n (insertion order), 5.6–7.0·n (Morse order), i.e. linear.
