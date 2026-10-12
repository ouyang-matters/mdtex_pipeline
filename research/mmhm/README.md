# MMHM v2

Version 2 of arXiv:2508.14429, *Morse-based Modular Homology for Evolving
Simplicial Complexes*: exact Z2 Betti numbers of a simplicial complex
(dim ≤ 3) under simplex insertions and deletions.

**The paper:** [`paper/main.pdf`](paper/main.pdf) (34 pages).
Build it with `latexmk -pdf main.tex` in `paper/`.

## What changed from v1

v1's localized update was not exact. It re-reduced a replaced column but
not the columns that had absorbed it, and its affected set ignored gradient
paths. v2 makes three changes:

- It maintains a dynamic reduced basis `R = B·V`, with `V` tracked.
- It proves the update exact for every cell order.
- It uses a collapse (Morse) order only to choose the order of the static
  reduction at a build.

There is no locality theorem. The paper proves that none holds for this data
structure and measures footprints instead. The paper presents the method on its
own terms. The withdrawal of v1's exactness claim is recorded in
[`paper/VERSION_HISTORY.md`](paper/VERSION_HISTORY.md). The detailed erratum,
with counterexamples to v1's rule as v1 specified it, is the separate document
`paper/MMHM_v1_erratum.tex`.

## Where things are

| path | what |
|---|---|
| `SPEC.md` | definitions, algorithms, methods, formats — source of truth |
| `engine/` | C++17 engine (`mmhm run/check`), 46 ctest tests incl. randomized differential tests against brute-force GF(2) rank |
| `reference/` | pure-Python reference, `check_props.py` (property checks + counterexamples) |
| `workloads/` | generators W1–W5, validator, committed samples |
| `oracle/` | GUDHI and brute-force oracles |
| `experiments/` | configs, runner, verification, aggregation, `results/` (all runs, manifest with workload hashes) — see `experiments/README.md` |
| `figures/` | plot scripts and PDFs |
| `paper/` | LaTeX source; `generated/` holds every number and table, written by `experiments/aggregate.py` |
| `paper/REVIEW.md`, `REVIEW2.md`, `response/` | referee report, verification pass, item-by-item responses |

## Open items for the author

- `paper/sections/conclusion.tex`: replace the `TODO(author)` with the
  repository/archive URL once the code and data are public.
- Bauer–Roll (SoCG 2024) is cited from search results only. Check the cited
  claim against the full paper.
- Many venues and arXiv expect a statement on the use of AI tools in
  preparing a paper. Add one if it applies.
