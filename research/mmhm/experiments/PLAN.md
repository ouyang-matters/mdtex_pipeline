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
| E1 | Does per-update cost depend on global size at fixed edit size? | W2 | \|K\| ≈ 1e4 … 1e6 (5 sizes: N ∈ {7,10,15,22,33}), s = 8 | full-id, full-morse, gudhi, drb-id, drb-id-rb, mmhm, mmhm-norb |
| E2 | How does cost scale with edit size? | W2 | \|K\| ≈ 3e5 (N = 22), s ∈ {1,2,4,8,16,32,64} (s = 8 is E1's instance) | drb-id, drb-id-rb, mmhm, mmhm-norb, full-morse, full-id; GUDHI as untimed oracle |
| E3 | Genuine 3D topology changes | W3 | N ∈ {14, 20, 27} (\|K\| ≈ 7.5e4 … 5.3e5) | as E1 |
| E4 | Non-manifold, all Betti numbers vary | W4 | 2D n ∈ {1k, 4k, 16k}, D = 2; D = 3 at n ∈ {1k, 4k} in 2D and 3D | as E1 |
| E5 | Surfaces: algebra vs combinatorial invariants | W1 sphere L ∈ {4..7}, torus {64², 128², 256², 500²} | up to 1.5e6 simplices | as E1 + euler |
| E6 | Where locality fails | W5a cycle L ∈ {1e3, 3e3, …, 1e6}; W5b sphere level 3..8 (n₂ = 1,280 … 1,310,720) | 3 decades each | drb-id, drb-id-rb, mmhm, mmhm-norb, full-id, gudhi, euler (W5b) |
| E7 | Rebuild policy sensitivity: does rebuilding help, and does the Morse order at rebuild help? | W2 N = 22, W3 N = 20, W4 2D n = 16k D = 2 | α ∈ {0.25, 0.5, 1, 2, 4, ∞}, period ∈ {∞, 64, 256} | mmhm, drb-id-rb (α = period = ∞ is mmhm-norb resp. drb-id) |
| E8 | What does the Morse order buy? | W2, W3, W4 (E1/E3/E4 runs, one size each) + W1 torus 256² | — | footprint and chain-length distributions, nnz(V)+nnz(R) over time: mmhm, mmhm-norb, drb-id, drb-id-rb |

Figures (in `figures/`):
- F1 method schematic (TikZ, in the paper source): DRB insert, delete Case A/B; collapse order ⇒ apparent pairs.
- F2 latency vs \|K\| (E1, E3, E4 panels), log–log, median with IQR band.
- F3 latency vs s (E2).
- F4 latency time series with rebuild markers + nnz(V)+nnz(R) (E1 one size, E3 one size).
- F5 footprint CCDF, Morse vs insertion order (E8).
- F6 non-locality: cost vs L and vs n (E6), with fitted slopes.
- F7 rebuild sensitivity: amortized vs p99 latency per α (E7).
Tables: T1 correctness (E0), T2 summary of medians/amortized across workloads (E1–E5).

## Changes made when the sweep was run (and why)

* **`drb-id-rb` added wherever `mmhm` runs** (E1–E8). The engine found that an
  `mmhm` rebuild in a state with holes can make later updates worse; `drb-id-rb`
  (same rebuild policy, rebuild in the current insertion order; SPEC §5)
  separates "rebuilding at all" from "rebuilding in Morse order".
* **T and T′.** The pilot (`configs/pilot.json`, one mid size per workload, all
  methods, T = 200; `results/pilot/`) showed that every engine method,
  including `full-morse` at 1.5e6 simplices, affords T = 2000; only `gudhi`
  does not (≈ 0.3 s per update at 1e6). So every method runs T = 2000, except
  `gudhi` on instances with |K₀| > 3e5, which runs the prefix T′ = 200. The
  GUDHI oracle thereby covers all updates up to 3e5 simplices and the first
  200 above (E0 requirement). `full-id` runs all T updates everywhere, so every
  exact run is compared with it on every state.
* **E1, E3, E4, E5 time `gudhi` at all sizes** (on T′ above 3e5) instead of
  only ≤ 3e5, since the oracle has to run there anyway; the prefix is stated
  per run (`T` column of `results/summary.csv`).
* **E2** also runs `full-id` (cheap; gives the full-id reference Betti file)
  and replays GUDHI on all updates as an untimed oracle (all E2 instances have
  |K| ≤ 3e5).
* **E4** includes the D = 3 variants at n ∈ {1k, 4k} in both 2D and 3D ambient
  space (both exist as generator presets; 3D is the less truncation-dominated).
* **E6** uses 7 cycle lengths L ∈ {1e3, 3e3, 1e4, 3e4, 1e5, 3e5, 1e6} and 6
  sphere levels 3..8 so that both families span 3 decades with enough points
  for a slope fit. W5a's generator ignores the seed (the instance is fully
  determined by L), so its 3 "seeds" are 3 repetitions of the same instance.
  `gudhi`, `drb-id-rb` and `mmhm-norb` were added (cheap; same baselines as the
  other experiments).
* **E7** sweeps W2, W3 and W4 (not only W2, W4) and both `mmhm` and
  `drb-id-rb`, 3 seeds each, to answer whether rebuilding helps or hurts and
  whether the Morse order at rebuild matters.
* **E8** needs no runs of its own: it reads the per-update `chain_adds`,
  `footprint_sum`, `nnz_R`, `nnz_V` columns of the E1/E3/E4/E5 runs. The
  per-deletion |occ| is not logged by the engine; E8 reports the per-update sum.
* **Noise and interference** (`noise.py`, `results/noise/`): `mmhm` and
  `full-id` on W2 N = 22, 5 identical runs alone, 3 with one other timed run, 3
  with one timed run + two GUDHI replays (4 busy cores). The change of the
  median latency under load was within the run-to-run spread (see
  `paper/generated/numbers.tex`, `\NumNoise…`), so untimed verification jobs
  (`lcr` error-rate runs, the E2 GUDHI oracle) were allowed to run on the two
  remaining cores alongside the ≤ 2 timed runs (`run.py --mixed`), never more
  than 4 processes at once.

## Review follow-up (referee M1, M3, M4)

* **`lcr-rc`** (`configs/E0rc.json`, untimed, `--verify-every 1`, E0 instances,
  3 seeds): `lcr` plus v1's periodic recompression with m = 32. It models v1's
  periodic trigger only (no Morse complex, no ρ trigger, no gates).
* **`full-sorted`** on every E1, E3, E4, E5 instance (3 seeds): the static
  baseline in a canonical, history-independent order, to separate the
  insertion order's drift from the workload's.
* **`drb-rand`** on one mid size per family (W1 torus 128², W2 N = 15, W3
  N = 14, W4 2D n = 4k D = 2; 3 seeds): the DRB in a random build order, to test
  whether any structured order matters.
