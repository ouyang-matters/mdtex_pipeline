# MMHM v2 — specification

This is the single source of truth for definitions, algorithms, file formats and
acceptance criteria. Code, experiments and the paper must agree with it. If an
implementation finds the spec wrong or ambiguous, fix the spec in the same
change and say why — never let code and spec drift.

## 0. Why v2 exists (what v1 got wrong)

v1 (arXiv:2508.14429v1) maintained Betti numbers by (i) a one-shot discrete
Morse reduction, (ii) "replacing" the affected columns of the critical boundary
matrices and re-reducing only those columns, (iii) periodic recompression,
(iv) combinatorial gates. Two defects make (ii) incorrect as specified:

* **E1 — basis tracking.** Re-reducing only the replaced column ignores every
  other reduced column that previously absorbed it. Counterexample over Z2:
  `B = [a | b]`, `a = b = e1`. Reduction gives `b <- b + a = 0`, rank 1. Replace
  `a` by `e2`: re-reducing `a` gives pivot `e2`, no conflict, `b` stays `0`,
  reported rank 1; true rank of `[e2 | e1]` is 2. Deleting a column has the
  same failure.
* **E2 — affected set.** v1 defines the affected critical columns as
  `critical ∩ directly-modified`. Morse boundaries are path sums along gradient
  paths, so an edit to a *matched* cell on a gradient path changes columns of
  critical cells far from the edit. v1 also never specifies how the matching is
  maintained between recompressions.

v1's experiments also could not detect this: P1/P3 are connected surfaces where
`β0, β1, β2` follow from `χ = V − E + F`, `β0 = 1`, and the boundary-edge gate,
so no linear algebra is exercised; P2 has constant Betti numbers.

v2 replaces (ii) with an exact dynamic reduction whose correctness does not
depend on locality, and uses discrete Morse theory where it is actually sound:
to choose the reduction order so that the maintained basis is sparse.

## 1. Setting

* `K` — finite simplicial complex, `dim K ≤ 3`. Vertices are non-negative
  32-bit integers; a simplex is a sorted tuple of 1..4 distinct vertices.
* Coefficients: the field `F = Z2` throughout. No claims about `Z` or torsion.
* **Atomic edits.** `insert σ` (σ absent, all facets of σ present) and
  `delete σ` (σ present, no coface of σ present). Each atomic edit leaves `K` a
  simplicial complex.
* **Update.** `u_t` is a finite sequence of atomic edits (a *batch*); Betti
  numbers are reported after each update. The **size** of an update is
  `s_t = |u_t|` = number of atomic edits. This replaces v1's informal "star of a
  small set" locality parameter.
* Goal: after every update, output exact `β_0..β_3` of `K_t` over Z2.

Notation: `K_k` = set of k-simplices, `n_k = |K_k|`, `∂_k : C_k → C_{k-1}`,
`B_k` = matrix of `∂_k` (rows `K_{k-1}`, columns `K_k`), `r_k = rank B_k`,
`r_0 = r_{d+1} = 0`, and `β_k = n_k − r_k − r_{k+1}`.

**Structural fact used everywhere.** A simplex's boundary never changes while it
exists. Inserting a (k−1)-simplex adds a *zero* row to `B_k` (it has no cofaces
yet); deleting one removes a row that is zero (its cofaces are already gone).
So, per dimension, maintaining `r_k` under atomic edits is exactly maintaining
the rank of a matrix under **column insertion and column deletion**, with rows
appearing and disappearing only while zero.

## 2. Dynamic reduced basis (DRB) — the exact core

Each cell `x` carries an **order key** `ord(x)` (unique 64-bit integer). For a
non-empty Z2 chain `c` (a set of cells of one dimension), `low(c)` is the cell
of `c` with maximal `ord`. Keys are fixed between rebuilds (§4); a newly
inserted cell receives a key larger than every key in use.

For each `k ≥ 1`, the DRB of `B_k` is a set of **slots**; slot `j` stores
`(R_j, V_j)` where `V_j` is a k-chain (set of k-simplices) and `R_j` a
(k−1)-chain. Invariants:

* **(I1)** `R_j = ∂_k V_j` for every slot.
* **(I2)** The non-zero `R_j` have pairwise distinct `low(R_j)`.
* **(I3)** `{V_j}` is a basis of `C_k(K)`; in particular `#slots = n_k`.

Consequences (Theorem 1 in the paper): `r_k = #{j : R_j ≠ 0}` and
`{V_j : R_j = 0}` is a basis of `Z_k = ker ∂_k`.

Index structures: `pivot[row] -> slot` for non-zero `R`; `occ[σ] -> {slots j :
σ ∈ V_j}` (inverted index of V, needed by deletion).

### 2.1 Insert k-simplex σ
```
j := new slot; V_j := {σ}; R_j := ∂σ
while R_j ≠ 0 and pivot[low(R_j)] = p exists:
    R_j ^= R_p ; V_j ^= V_p
if R_j = 0:  (β_k increases by 1)            -- σ is "positive"
else:        pivot[low(R_j)] := j  (r_k += 1, β_{k-1} decreases by 1)
```
### 2.2 Delete k-simplex σ  (no cofaces present)
```
O := occ[σ]                        -- non-empty by (I3)
Z := { j ∈ O : R_j = 0 }
if Z ≠ ∅:                          -- Case A: σ lies on a k-cycle
    z := argmin_{j∈Z} |V_j|        -- heuristic; any choice is correct
    for j ∈ O \ {z}:  V_j ^= V_z   -- R_j unchanged because ∂V_z = 0
    remove slot z                  -- r_k unchanged, β_k decreases by 1
else:                              -- Case B: σ on no k-cycle
    p := argmin_{j∈O} ord(low(R_j))   -- forced choice
    for j ∈ O \ {p}:  R_j ^= R_p ; V_j ^= V_p   -- low(R_j) unchanged
    free pivot[low(R_p)]; remove slot p        -- r_k -= 1, β_{k-1} += 1
remove σ from K
```
Correctness sketch (the paper proves it): after the loop no remaining `V`
contains σ, so the remaining `n_k − 1` independent chains span `C_k(K∖σ)`;
(I1) holds by linearity (Case A adds a cycle, Case B adds `(R_p, V_p)`
consistently); (I2) holds because Case A leaves every `R` unchanged and Case B
only adds `R_p` to columns whose low is strictly larger. The row σ of
`B_{k+1}` is zero (no cofaces) hence σ is not a pivot of dimension `k+1`.

Vertices (`k = 0`) need no DRB: they only change `n_0`.

**Cost (output-sensitive, no locality promise).** Insert: `Σ (|R_p| + |V_p|)`
over the reduction chain. Delete: `|O| · (|V_z|)` in Case A, `|O| · (|R_p| +
|V_p|)` in Case B, plus `occ` maintenance. We call `occ[σ]` the **footprint**
of σ. These are bounded by local quantities only when footprints and reduction
chains are local; Section 6 (W5) exhibits families where they are Θ(n).

## 3. Morse order (where discrete Morse theory is used)

At (re)build time compute an acyclic matching by **collapses**
(Benedetti–Lutz style, deterministic):
```
P := all cells; cof(x) := #immediate cofaces of x in P; t := 0
Q := { x : cof(x) = 1 }                    -- free faces
loop:
  while Q ≠ ∅:
     pop x; if x ∉ P or cof(x) ≠ 1: continue
     y := unique immediate coface of x in P   -- y is maximal in P
     pair (x, y); rm(y) := t; rm(x) := t+1; t += 2   -- y removed first, then x
     remove y, x from P; decrement cof of their facets; push new free faces
  if P = ∅: break
  c := a maximal cell of P of highest dimension (smallest vertex tuple)
  mark c critical; rm(c) := t; t += 1; remove c; decrement cof of its facets; push new free faces
```
**Morse order:** `ord(x) := −rm(x)` (later removal ⇒ smaller key), mapped to
increasing integers. With this order, for every gradient pair `(τ, σ)`:
`τ = low(∂σ)` and the column σ is the first column (in increasing `ord`) with
that low, so σ is an **apparent pair** — it takes its pivot with zero additions
(Lemma 2 in the paper; the proof uses only that every facet of σ other than τ is
removed after σ). Reduction work therefore concentrates on critical cells, and
the reduced column of a critical cell traces its gradient flow.

**Insertion order** (the ablation): `ord(x)` = insertion counter.

## 4. Static reduction with clearing (rebuild and FULL baseline)

Process `k = d, d−1, ..., 1`. Columns of `B_k` in increasing `ord`.
* If the k-simplex τ is `low(R)` of some reduced column `R` of `B_{k+1}`
  (already reduced), then **clear**: slot for τ gets `R_τ := 0`,
  `V_τ := R` (a boundary, hence a cycle; `low(V_τ) = τ`, so V stays unit
  upper-triangular in `ord` and invertible).
* Otherwise reduce normally (left to right, `pivot` table), tracking `V`.

FULL baselines skip `V` tracking (ranks only). DRB rebuilds keep `V` and build
`occ`.

## 5. Methods (names used in code, CSV, figures, paper)

| name | what it is | exact? |
|---|---|---|
| `full-id` | per update: static reduction with clearing, insertion order, ranks only | yes |
| `full-morse` | per update: collapse matching + Morse order + clearing (v1's "coreduction-only", done properly) | yes |
| `gudhi` | per update: GUDHI SimplexTree `compute_persistence` (external static baseline, Python) | yes |
| `drb-id` | DRB, insertion order, never rebuilt | yes |
| `mmhm` | DRB + Morse order + rebuild policy (§5.1) — **the method** | yes |
| `mmhm-norb` | DRB + Morse order at build only, never rebuilt (ablation) | yes |
| `lcr` | v1 localized column re-reduction **without** basis tracking (E1); deletion = clear the column's pivot and drop it; insertion = reduce new column | **no** — used only to measure error rate |
| `euler` | surfaces only: `β0 := 1` (asserted), `β2 := [#boundary edges = 0]` (manifold check), `β1 := β0 + β2 − χ` | only under its preconditions |

### 5.1 Rebuild policy (`mmhm`)
Rebuild (fresh collapse matching, Morse order, static reduction with `V`) after
update `t` if any holds: (a) `t − t_last ≥ m` (period, default `m = ∞` i.e.
off), (b) `nnz(V) + nnz(R) > (1+α) · max(nnz_at_last_rebuild, n_cells)` (growth
trigger, default `α = 1.0`). Rebuild time is charged to the update that
triggers it. Report both per-update latency and amortized latency.

## 6. Workloads (`.seq` generators in `workloads/`)

All generators are deterministic given `--seed`, emit only valid atomic edits,
and write a sidecar `.meta.json` (parameters, counts, expected Betti numbers
when analytically known).

* **W1 punctured surfaces.** Closed triangulated sphere (subdivided
  icosahedron) or torus (grid). Update = open a disk patch (k-ring umbrella of
  a random vertex, non-overlapping with existing holes) or close an existing
  hole, chosen to keep the hole count fluctuating around a target. Real
  topology changes in β1, β2. Sweep size; patch size fixed.
* **W2 refine/coarsen in a 3-ball.** Freudenthal/Kuhn tetrahedralization of an
  `N^3` grid. Update = `s` 1→4 stellar subdivisions of tets in a random
  cluster, or `s` exact inverses of earlier leaf subdivisions; the size
  performs a random walk around its initial value (it must NOT grow linearly —
  that was v1's P2 inconsistency). Betti numbers constant `(1,0,0,0)`. Sweep
  `|K|` at fixed `s`, and `s` at fixed `|K|`.
* **W3 cavities in a 3-ball.** Same mesh; update = remove the closed k-ring
  ball of tets around a random interior vertex together with every face left
  without cofaces (creates a cavity: β2 += 1, or a dent if it touches the
  boundary), or refill an existing cavity. Genuine 3-dimensional algebra.
* **W4 moving point cloud (flag complex).** `n` points in the unit square or
  cube; flag (clique) complex of the ε-neighbourhood graph up to dimension 2
  (and 3 where affordable). Update = move one random point by a small step:
  delete its closed star top-down, reinsert vertex and new star bottom-up.
  Non-manifold, all Betti numbers vary.
* **W5 non-locality witnesses.** (a) Cycle graph of length `L`, toggling one
  edge (β1 toggles; the cycle representative has `L` edges). (b) Sphere with a
  single toggled puncture (the fundamental 2-cycle has all `n_2` triangles).
  Expected: `drb-*`/`mmhm` cost Θ(L) / Θ(n_2) per toggle, `euler` O(1).

### 6.1 `.seq` format (text, UTF-8)
```
MMHMSEQ 1
dim <D>                      # max dimension, ≤ 3
# comment lines anywhere
INIT
+ <v0> [<v1> ...]            # insert simplex (vertex order irrelevant)
...
END
UPDATE
- <v0> [<v1> ...]            # delete simplex
+ <v0> [<v1> ...]
...
END
UPDATE
...
```
The INIT block builds `K_0` (timed separately as build time). Each UPDATE block
is one update. Betti numbers are reported after INIT and after each UPDATE.

### 6.2 Betti file
One line per state (INIT, then each UPDATE): `b0 b1 b2 b3` (zeros above `D`).

## 7. Engine CLI (`engine/`, C++17, CMake, binary `mmhm`)

```
mmhm run --method <name> --seq <file> [--out <csv>] [--betti-out <file>]
         [--period m] [--alpha a] [--verify-every N] [--max-updates T]
mmhm check --seq <file>          # validate closure of every atomic edit
```
* Parsing is outside the timed region; only processing of each UPDATE block is
  timed (`std::chrono::steady_clock`).
* `--verify-every N`: every N updates compare against an internal `full-id`
  recomputation. Exact methods abort on mismatch (exit code 3) with a
  diagnostic; `lcr` counts mismatches instead.
* CSV columns (one row per update; INIT row has `t = 0`):
  `t,ops,n0,n1,n2,n3,b0,b1,b2,b3,time_ns,rebuild,rebuild_ns,nnz_R,nnz_V,
  footprint_sum,chain_adds,verified,mismatch`
  (`footprint_sum` = Σ |occ[σ]| over deletions in the update; `chain_adds` =
  number of column additions performed in the update.)

## 8. Acceptance criteria

* Unit + randomized differential tests (`ctest`): for random valid edit
  sequences on random complexes up to dim 3, every exact method's Betti numbers
  equal a brute-force Z2 rank computation after every update; `lcr` must be
  shown to fail on the E1 counterexample. DRB invariants (I1)–(I3) checked
  explicitly in debug builds.
* Three independent oracles must agree on every committed workload sample:
  engine `full-id`, `oracle/` GUDHI, `reference/` pure-Python DRB.
* Every number in the paper is regenerated by a script in `experiments/` from
  committed CSVs; figures by scripts in `figures/`. Hardware, compiler flags,
  seeds and repetition counts are recorded in `experiments/ENVIRONMENT.md`.
* The paper claims only what was measured. In particular: no locality theorem;
  locality is reported as measured footprints and reduction-chain lengths.

## 9. Layout
```
research/mmhm/
  SPEC.md           this file
  engine/           C++ engine + tests
  workloads/        Python generators -> data/ (large .seq files gitignored)
  oracle/           GUDHI oracle + gudhi baseline timing
  reference/        pure-Python DRB reference + proof sanity checks
  experiments/      run scripts, configs, results/*.csv, ENVIRONMENT.md
  figures/          plotting scripts -> figures/*.pdf
  paper/            LaTeX source (main.tex, sections/, refs.bib)
```
