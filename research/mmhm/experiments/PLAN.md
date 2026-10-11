# Experiment plan

Every experiment is a config in `experiments/configs/*.json` run by
`experiments/run.py`, producing `experiments/results/<exp>/<workload>__<method>__seed<k>.csv`
(engine CSV schema, SPEC §7). Aggregation (`experiments/aggregate.py`) produces the
tables; `figures/*.py` produce the figures. Nothing in the paper is typed by hand.

Timing protocol: single-threaded processes; at most 2 timing runs concurrently on
the 4-core host (the other cores stay idle to limit memory-bandwidth interference);
3 seeds per configuration; report median and IQR of per-update latency, and
amortized latency (total processing time incl. rebuilds / T). Static baselines at
the largest sizes may run on a prefix of T' ≥ 100 updates (stated in captions).

Correctness protocol: exact methods run with `--verify-every 1` on every committed
sample and with `--verify-every 50` (plus the final state) on every timed run; a
separate untimed pass checks every update of every timed workload against the
GUDHI oracle Betti file where affordable. Any mismatch for an exact method stops
the pipeline.

| id | question | workload | sweep | methods |
|---|---|---|---|---|
| E0 | Are the exact methods exact, and how wrong is v1's rule? | all samples + every timed workload | — | all; `lcr` error rate = fraction of updates with any wrong β |
| E1 | Does per-update cost depend on global size at fixed edit size? | W2 | \|K\| ≈ 1e4 … 1e6 (5 sizes), s = 8 | full-id, full-morse, gudhi (≤ 3e5), drb-id, mmhm, mmhm-norb |
| E2 | How does cost scale with edit size? | W2 | \|K\| ≈ 3e5, s ∈ {1,2,4,…,64} | drb-id, mmhm, mmhm-norb, full-morse |
| E3 | Genuine 3D topology changes | W3 | 3 sizes up to ~5e5 | as E1 |
| E4 | Non-manifold, all Betti numbers vary | W4 | n ∈ {1k, 4k, 16k}, D = 2; D = 3 at 1k, 4k | as E1 |
| E5 | Surfaces: algebra vs combinatorial invariants | W1 sphere, torus | 4 sizes up to ~5e5 triangles | as E1 + euler |
| E6 | Where locality fails | W5a cycle, W5b sphere puncture | L, n over 3 decades | drb-id, mmhm, full-id, euler (W5b) |
| E7 | Rebuild policy sensitivity | W2, W4 at one size each | α ∈ {0.25, 0.5, 1, 2, 4, ∞}, period ∈ {∞, 64, 256} | mmhm |
| E8 | What does the Morse order buy? | W2, W3, W4 | — | footprint (\|occ\|) and chain-length distributions, nnz(V) over time: mmhm vs drb-id |

Figures (in `figures/`):
- F1 method schematic (TikZ, in the paper source): DRB insert, delete Case A/B; collapse order ⇒ apparent pairs.
- F2 latency vs \|K\| (E1, E3, E4 panels), log–log, median with IQR band.
- F3 latency vs s (E2).
- F4 latency time series with rebuild markers + nnz(V)+nnz(R) (E1 one size, E3 one size).
- F5 footprint CCDF, Morse vs insertion order (E8).
- F6 non-locality: cost vs L and vs n (E6), with fitted slopes.
- F7 rebuild sensitivity: amortized vs p99 latency per α (E7).
Tables: T1 correctness (E0), T2 summary of medians/amortized across workloads (E1–E5).
