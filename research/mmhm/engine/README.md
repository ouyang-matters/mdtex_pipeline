# MMHM engine

C++17 implementation of SPEC.md §2–§5 and §7: the dynamic reduced basis (DRB),
the collapse-based Morse order, static reduction with clearing, the exact
methods `full-id`, `full-morse`, `full-sorted`, `drb-id`, `drb-id-rb`, `drb-rand`, `mmhm`,
`mmhm-norb`, and the
baselines `lcr` / `lcr-rc` (v1's rule, inexact on purpose; `lcr-rc` adds v1's periodic
recompression, m = 32) and `euler` (surfaces only).
`gudhi` is not part of the engine (see `../oracle/`).

## Build, test, run

```sh
cd research/mmhm/engine
cmake -S . -B build-release -DCMAKE_BUILD_TYPE=Release   # -O2 -DNDEBUG, no -march=native
cmake --build build-release -j4
(cd build-release && ctest -j4)

cmake -S . -B build-debug -DCMAKE_BUILD_TYPE=Debug       # -O1 -g, MMHM_CHECKS
cmake --build build-debug -j4
(cd build-debug && ctest -j4)

build-release/mmhm check --seq file.seq
build-release/mmhm run --method mmhm --seq file.seq --out run.csv --betti-out run.betti \
    [--period m|off] [--alpha a|off] [--verify-every N] [--max-updates T]
```

Debug builds define `MMHM_CHECKS`: after every DRB operation (build, insert,
delete) the engine checks (I1) `R_j = ∂V_j` for every slot, (I2) distinct lows
and the pivot table, (I3) `#slots = n_k` and, when `n_k ≤ 512`, linear
independence of the `V_j` by dense GF(2) elimination, plus consistency of
`occ`, its counters and the nnz totals; a violation aborts. This is O(size) per
operation, so use Debug only on small inputs. The same checker
(`Drb::check`) is also called explicitly by the tests in Release builds.

`build-*/gen_seq` writes small synthetic sequences for tests and sanity runs
(`ball`: random insert/delete batches on a Freudenthal tet grid; `torus`:
triangle toggles that keep a connected surface). The paper's workloads are
produced by `../workloads/`, not by this tool.

## CLI behaviour (SPEC §7)

* The `.seq` file is parsed completely before any timing. Every atomic edit is
  validated (closure, presence, no cofaces on delete) in every build — the
  hash lookups needed for validation are needed anyway. Invalid input → exit 2
  with the line number.
* INIT need only be closed under faces; it is inserted stably sorted by
  dimension (SPEC §6.1 note).
* `--verify-every N` verifies `t = 0`, every `t ≡ 0 (mod N)` and the last
  processed update against an internal `full-id` recomputation (not timed).
  Exact methods (and `euler`) write the row, print a diagnostic and exit 3 on
  a mismatch; `lcr` sets `mismatch = 1` in the row and continues. The stderr
  summary line reports totals (updates, init/update ms, rebuilds, verified,
  mismatches).
* `--period` / `--alpha` only affect `mmhm` and `drb-id-rb` (warning otherwise). Defaults:
  period off, alpha 1.0. `off` (or `inf`) disables a trigger.
* Exit codes: 0 ok, 1 usage, 2 invalid input, 3 mismatch, 4 `euler`
  precondition violated, 5 internal error / out of memory.

### CSV columns

`t,ops,n0,n1,n2,n3,b0,b1,b2,b3,time_ns,rebuild,rebuild_ns,nnz_R,nnz_V,footprint_sum,chain_adds,verified,mismatch`

| column | meaning |
|---|---|
| `t` | 0 for INIT, then 1, 2, … per UPDATE block |
| `ops` | atomic edits in the block (`s_t`; for `t = 0` the number of INIT simplices) |
| `n0..n3` | simplex counts after the block |
| `b0..b3` | Betti numbers reported by the method after the block |
| `time_ns` | `steady_clock` time of processing the block. `t = 0`: store insertion + build. `t ≥ 1`: every atomic edit (store update + method hook) + per-update recomputation (`full-*`) + rebuild (`mmhm`, `drb-id-rb`, if triggered). Verification and CSV output are excluded. |
| `rebuild` | 1 iff `mmhm` / `drb-id-rb` rebuilt at the end of this update (never at `t = 0`) |
| `rebuild_ns` | duration of that rebuild; **included** in `time_ns` |
| `nnz_R`, `nnz_V` | `Σ|R_j|`, `Σ|V_j|` over all slots of all dimensions after the row (after its rebuild). `full-*`: entries of the non-zero reduced columns of the recomputation, `nnz_V = 0`. `lcr`: `Σ|R|`, `nnz_V = 0`. `euler`: 0. |
| `footprint_sum` | DRB methods: `Σ |occ[σ]|` over the deletions of simplices of dimension ≥ 1 in the block (exact sizes, after filtering the lazy lists). 0 for other methods. |
| `chain_adds` | column additions performed in the block: one per reduction step of an insertion (`R ^= R_p; V ^= V_p` counts once), one per `j ∈ O∖{z}` (Case A) or `O∖{p}` (Case B) of a deletion, plus **all** additions of the build (`t = 0`) or rebuild (`rebuild = 1`). `full-*`: additions of the static recomputation. `lcr`: reduction steps of insertions (and its build at `t = 0`). Use rows with `rebuild = 0` for dynamic chain lengths. |
| `verified`, `mismatch` | per-row 0/1 flags |

## Data structures

**Complex store** (`complex.hpp`). Simplex key = sorted vertex tuple packed in
128 bits (unused positions = `0xFFFFFFFF`, so that vertex id is reserved) →
cell id through an open-addressing linear-probing hash map with backward-shift
deletion. Cell ids are reused through a free list, so per-cell arrays are
bounded by the peak size of `K`. Per cell (structure of arrays): dimension,
vertices, facet cell ids (facet `i` omits vertex `i`), immediate coface list,
insertion counter, alive flag. Two optional order indices — alive cells per
dimension by insertion counter (`full-id`, verification) and by vertex tuple
(Morse order) — are maintained by appending edits and merging them in on the
next query (sequential passes only); a method turns off the indices it does
not read, so they cost nothing per edit for it.

**Order keys and chains** (`smallvec.hpp`, `column.hpp`). Each method keeps
`cell → key` and `key → cell` maps. Keys are dense 32-bit integers: a (re)build
assigns `0..N−1` in the chosen order (Morse: `N−1−rm(x)`; insertion: by
insertion counter), and every later insertion takes `next_key++` (larger than
every key in use, SPEC §2). A chain (`R_j`, `V_j`) is a strictly increasing
array of **keys** — so `low(c)` is the last entry and XOR is a linear merge
with no indirection — stored in a 24-byte small vector with 4 inline entries
(boundaries and apparent-pair columns never allocate). Keys change only at a
rebuild, which recomputes everything. Keys are 32-bit (SPEC says 64-bit; any
unique ordered keys work): the engine aborts if one build epoch ever hands out
2^32−1 keys, i.e. that many insertions without a rebuild.

Working columns during a reduction are sorted vectors merged in place while
that is cheap (short column, or the added chain is at least a quarter of its
length). When short chains are added to a long column, `R` switches to a
max-heap with lazy cancellation of equal pairs (`low()` looks at the root and
its two children) and `V` to append-then-sort-once. A reduction step therefore
costs `O(|R_p| + |V_p|)` (times a log in heap mode), matching SPEC §2's cost
model; plain merging would cost `O(|working column|)` per step, quadratic on
long chains (e.g. building a length-L cycle in insertion order).

**DRB** (`drb.hpp`), one per dimension `k = 1..3`: slots `(R_j, V_j)` in two
vectors with a free list; `pivot[key] → slot` (a global array: keys are unique
across dimensions, so the entry for a (k−1)-cell belongs to `B_k`); exact rank
counters; `nnz` totals maintained incrementally.

`occ[σ]` (indexed by cell id) is a *lazy* inverted index plus an exact counter
`|occ[σ]|`. When `σ` joins `V_j` the slot id is appended; when it leaves, only
the counter is decremented, so the list may hold stale or duplicate ids. A
deletion obtains the exact `O = occ[σ]` by filtering the list (slot alive, not
yet seen this epoch, `σ ∈ V_j` by binary search). A list is compacted the same
way when it exceeds `2·|occ| + 8` entries, so its length is O(true size)
amortized. Insertion only touches `occ` for the final `V_j` (pushes of
intermediate states are not needed). Slot ids are reused; a stale entry that
names a reused slot is still resolved correctly because membership is checked
against the current `V_j`.

Deletion follows SPEC §2.2 exactly. Case A: `z` = minimal `|V_z|` among the
cycles of `O` (ties: smallest slot id), `V_j ^= V_z` for the others. Case B:
`p` = minimal `low(R_p)`, `(R_j, V_j) ^= (R_p, V_p)` for the others, pivot of
`p` freed. Case A happens iff σ lies on a k-cycle, a topological condition, so
the A/B counts do not depend on the order.

**Static reduction** (`static_reduce.hpp`, `Drb::build`, `Lcr::build`): §4,
`k = D … 1`, columns in increasing key; a k-cell that is the low of a reduced
column `R_q` of `B_{k+1}` is cleared (`R := 0`, and in the DRB `V := R_q`).
The ranks-only version (`full-*`, verification) stores only non-zero reduced
columns.

**Morse order** (`morse.hpp`): the collapse of SPEC §3 with the queue
discipline stated in the SPEC note there (FIFO seeded in (dimension, vertex
tuple) order; facets visited in omit-vertex-i order; critical cell = smallest
tuple of the highest remaining dimension via a per-dimension cursor). Each cell
keeps (number of cofaces in P, XOR of their ids), so the unique coface of a
free face is read off directly. The matching depends only on `K` as a set
(tested).

**Methods** (`methods.hpp`). `full-id`/`full-morse` recompute after every
update. `drb-id` builds in insertion order at INIT and never rebuilds.
`mmhm-norb` builds in Morse order at INIT and never rebuilds. `mmhm` adds the
§5.1 policy, evaluated after each update. `drb-id-rb` is `drb-id` with the
same policy and flags; its rebuild reassigns keys by insertion counter — the
order of the keys already in use, renumbered `0..N−1` — and reruns the static
reduction with `V` (it keeps the store's insertion index for that). `full-sorted` recomputes like `full-id` but in the canonical order (dimension,
then lexicographic vertex tuple; the store's tuple index), so its order cannot
drift with the edit history. `drb-rand` builds the DRB in a uniformly random
order per dimension (seeded `std::mt19937_64`, Fisher-Yates over the cells in
tuple order; `MethodOptions::rand_seed`) and never rebuilds. `lcr-rc` is `lcr`
plus a rebuild of all reduced columns from scratch in the current key order
every `--period` updates (default 32). `lcr` uses the same order as
`mmhm-norb` and keeps only `R` per column. `euler` maintains `χ` and the
numbers of edges with 1 / 2 / other coface counts, O(1) per atomic edit, and
checks its preconditions at the end of each update (SPEC §5 note).

## Complexity

* Store: O(1) expected per edit (hash), plus a scan of the facets' coface
  lists on deletion.
* DRB insertion: `Σ(|R_p| + |V_p|)` over the reduction chain (log factor in
  heap mode), plus `|V_j|` `occ` pushes.
* DRB deletion: filtering the raw `occ` list (`O(raw · log|V|)`), then Case A
  `Σ_{j∈O}(|V_j| + |V_z|)`, Case B `Σ_{j∈O}(|R_j| + |R_p| + |V_j| + |V_p|)` —
  merges, so the size of the target column counts too — plus `occ` updates
  proportional to the entries that change.
* `full-*`: O(n) + reduction work per update; `full-morse` adds an O(n)
  collapse, the key map, and O(n + m log m) to merge `m` edits into the tuple
  index. A rebuild costs the same plus `V` and `occ`.

## Sanity numbers (this host, Release, `--verify-every 1`, all methods agreeing)

`gen_seq ball --n 24 --updates 300 --batch 8` (369,937 simplices, 3-ball with
random insert/delete batches of 1–8 edits, β2 up to 73 distinct values): INIT
build ≈ 220–280 ms for every method; per update (amortized) full-id 3.8 ms,
full-morse 19 ms, drb-id 16 µs, mmhm 16 µs, mmhm-norb 15 µs, lcr 13 µs.
Cycle graph with one toggled edge, L = 200,000: drb-id 2.8 ms, mmhm 2.4 ms,
full-id 4.7 ms per toggle (Θ(L) as SPEC W5 predicts). Peak RSS on the
370k-simplex ball with 4000 updates: 94 MB (full-id) to 124 MB (mmhm),
including the parsed sequence.

Observations worth checking on the real workloads:

* `full-morse` is ~5× slower than `full-id` per update on the ball: the
  collapse (≈ 9 ms) costs more than the reduction (≈ 3 ms), and on these
  meshes insertion order with clearing already needs 0 additions.
* On the random-edit ball, a forced `mmhm` rebuild (`--period 500`) *increased*
  later dynamic work: ≈ 50 additions/update after each rebuild vs ≈ 0 for
  `mmhm-norb` (same sequence, 4000 updates). Plausible mechanism: collapses
  start at free faces, which are exactly the faces exposed by deletions; they
  get the largest keys and become pivot rows of their tets, so re-insertions
  into those holes reduce along whole gradient paths. Relevant for E7.
* On W1 (`w1_torus_256x256_k2_h3_T2000_seed0`, 393k cells) DRB updates cost
  7–10 ms: each time all holes close, the fundamental 2-cycle (all n₂
  triangles) reappears, and a Case A deletion leaves a dense V slot behind;
  `nnz_V` grows 0.72M → 2.56M over 2000 updates (`mmhm-norb`), and later
  deletions merge with those slots (mean footprint 230, 1135 additions per
  61-edit update). The α = 1 growth trigger fired only 3 times. This is the
  W5b phenomenon inside W1, not an engine artefact.

## Tests (`ctest`, Release and Debug)

* `unit`: chain merge, small vector, hash map, parser (good and bad files),
  store validation, order indices vs brute force under random edits with
  tracking on/off/toggled, working columns in both representations, Morse
  order independence of history / cell ids / INIT order.
* `known`: textbook Z2 Betti numbers for the tetrahedron boundary (1,0,1),
  3-balls (single tet; 2×2×2 grid) (1,0,0,0), 3-sphere ∂Δ⁴ (1,0,0,1), tori
  3×3 and 4×5 (1,2,1), RP² (6 vertices) (1,1,1), figure-8 graph (1,2) — at
  INIT for every method, and built up / torn down one edit per update and in
  batches of 7 for every exact configuration; `euler` on surfaces and a
  punctured torus, and its rejection of non-surfaces.
* `e1`: SPEC §0 E1 at matrix level (DRB rank 2, lcr rank 1; also a deletion
  variant exercising Case B with `p` ≠ the deleted column's slot), a 3-edge
  complex where lcr disagrees with the oracle while every exact method agrees,
  and lcr's error rate on random sequences.
* `apparent`: Lemma 2 (every gradient pair has zero additions and `low = τ`),
  Corollary 2.1 (lower cells cleared, all additions in critical columns) and
  Corollary 2.2 (critical cells precede lower cells per dimension) on random
  complexes, complexes reached by edits, a 4³ ball and its boundary sphere.
* `random_*`: randomized differential tests (random closed complexes up to
  dim 3, random valid batches; INIT deliberately shuffled): after every update
  every exact method (including `mmhm` and `drb-id-rb` with α ∈ {0, 0.05,
  0.25, 1, off} × period ∈ {off, 1, 2, 5}) equals the dense brute-force Z2 rank computation,
  and `Drb::check` passes. Asserts that Case A, Case B and rebuilds occur.
* `cli_*`: generated ball and torus sequences through the binary for every
  method with `--verify-every 1`, with and without verification, identical
  Betti files, `mmhm` and `drb-id-rb` with aggressive rebuilds, `check`, and `euler`'s refusal
  of a 3-complex.
