# paper/generated/ — machine-written inputs of the paper

Everything in this directory is written by `experiments/aggregate.py` from the
committed results in `experiments/results/` (which `experiments/run.py`,
`experiments/verify.py`, `experiments/noise.py` and
`experiments/crosscheck_samples.py` produce). Do not edit by hand; rerun

```sh
cd research/mmhm/experiments
python3 verify.py && python3 aggregate.py
```

| file | content |
|---|---|
| `numbers.tex` | `\newcommand{\Num…}{…}` for every number the text may quote; each macro is preceded by a comment saying what it is and which config/script produced it |
| `tab_correctness.tex` | T1: correctness (E0). Upper block: per exact method, runs, reported Betti vectors, states compared with the engine `full-id` Betti file, with the analytic Betti numbers, with the GUDHI oracle, mismatches. Lower block: `lcr` (v1's rule) per E0 instance: runs, verified updates, wrong updates, % wrong, first wrong update |
| `tab_summary.tex` | T2 (fits one page at `\small`): per workload × method at the largest size of each family of E1, E3, E4, E5 (W1 sphere L7, torus 500², W2 N=33, W3 N=27, W4 2D 16k D=2, W4 3D 4k D=3; W5 is in F6 and the full tables): \|K₀\|, T (2,000 or the prefix T′ = 200), median, p95 and amortized per-update latency (µs), amortized speedup vs `full-id` |
| `tab_summary_full.tex`, `tab_summary_full_med.tex`, `tab_summary_full_p99.tex` | every instance of E1–E6 (rows) × method (columns): amortized / median / p99 per-update latency (µs). `′` marks the prefix T′ = 200; an empty cell means the method is not part of that experiment, `n/r` a configured run without results. Use `\footnotesize` and `\setlength{\tabcolsep}{3pt}` to fit 6.5 in |
| `tab_e7.tex` | E7: rebuilds per run, amortized and p99 latency (µs) for `mmhm` and `drb-id-rb` over α × period |
| `tab_rebuild_effect.tex` | does a rebuild help? Per instance where rebuilds fired (default policy α = 1, period off): rebuilds per run (rb = `drb-id-rb`, m = `mmhm`); amortized latency ratios rb/`drb-id` and m/`mmhm-norb`; additions of the rebuilding method in the 100 updates after each of its rebuilds / its never-rebuilding twin on the same updates; and over all non-rebuild updates after the first rebuild, the ratios of additions and of time (> 1: costlier than never rebuilding). W1 rows are here; E7 (F7, `tab_e7`) has no W1 instance |
| `tab_e8.tex` | E8: median and p99 of per-update column additions and footprints, nnz(R)+nnz(V) after INIT and at the end, for the four DRB methods |
| `tab_coverage.tex` | review B2: Betti vectors of exact runs checked against ≥ 1, ≥ 2 and all 3 references (engine `full-id` file, closed form, GUDHI) and against ≥ 1 external one (closed form or GUDHI), per workload family; last line: what the Python reference covered (samples only) |
| `tab_build.tex` | review M3: nnz(R)+nnz(V) after INIT and additions of the INIT build, insertion order (`drb-id`) vs Morse order (`mmhm-norb`), every instance |
| `tab_drift.tex` | review M4: `full-id` median over updates 1–200 vs 1801–2000, last/first ratio for `full-id`, `full-morse`, `drb-id`, `mmhm`, and `mmhm`'s speedup over `full-id` on those two windows |
| `tab_seed_ranges.tex`, `tab_seed_ranges_p99.tex` | review M8: per-seed min–max of amortized latency / p99 for `full-id` and the 4 DRB variants, every instance (pairwise overlaps for all methods: `experiments/results/summary_pairs.csv`) |
| `tab_noise.tex` | review M8: CV of median, amortized and p99 latency over identical runs (noise.py: W2 N=22, W5a L=1e5, W3 N=20, W1 torus 256², W2 N=33; plus the 3 identical-instance seeds of every W5a size) |
| `tab_rand.tex` | review M3 follow-up: insertion vs Morse vs **random** build order (`drb-id`, `mmhm-norb`, `drb-rand`) on one mid size per family: nnz(R)+nnz(V) after INIT, INIT build additions, amortized latency |
| `tab_w4_betti.tex` | W4: ranges of β₀..β₃ over all states of the 3 seeds, and β_D / n at INIT |

Each `tab_*.tex` is a complete `tabular` (booktabs rules, no float, no
caption): wrap it in `table` + `\caption` in the paper (`\generatedtable{…}`
in `main.tex` does this). Method names use `\method{…}` from `macros.tex`.
Latencies in tables are in µs.

## Units and conventions of the `\Num…` macros

* **Latencies are in µs** (per update, `time_ns` of the engine CSV / GUDHI CSV,
  update rows t ≥ 1), formatted to 3 significant digits with `{,}` thousands
  separators, e.g. `3{,}590`. INIT build times (`…InitMs`) are in ms.
* **Pooled over seeds.** Per (instance, method) the updates of the 3 seeds are
  pooled; `Med`, `QOne`, `QThree`, `PNinetyFive`, `PNinetyNine`, `Max` are
  percentiles of the pooled per-update latencies; `Amort` = total update time
  (including rebuilds, which are charged to the update that triggers them) /
  number of updates.
* **Speedups** are ratios of amortized latencies over the same updates
  (`SpeedupFullId` = amortized of `full-id` / amortized of the method, both
  over all T updates; `…Med` variants use medians). `SpeedupGudhi` compares
  both methods over the same first updates: all T when gudhi ran all T,
  otherwise gudhi's prefix T′ = 200 (`\Num<inst>GudhiT`).
  `SpeedupGudhiUnmatched` is the earlier prefix-vs-full-run ratio, kept only for
  traceability.
* Percentages are plain numbers without `\%`.

## Macro names

Letters only. Numbers inside names are spelled in English words
(22 → `TwentyTwo`, 16000 → `SixteenThousand`, 1000000 → `OneMillion`).

**Instance tags** `<inst>` (one per workload instance; results/ name → tag):

| results/ workload | tag | example |
|---|---|---|
| `w1_sphere_L<L>` | `WOneSphereL<L>` | `w1_sphere_L7` → `WOneSphereLSeven` |
| `w1_torus_<n>` | `WOneTorus<n>` | `w1_torus_256` → `WOneTorusTwoHundredFiftySix` |
| `w2_N<N>_s<s>` | `WTwoN<N>S<s>` | `w2_N22_s8` → `WTwoNTwentyTwoSEight` |
| `w3_N<N>_k2` | `WThreeN<N>` | `w3_N27_k2` → `WThreeNTwentySeven` |
| `w4_<2d/3d>_n<n>_D<D>` | `WFour<Plane/Space>N<n>D<D>` | `w4_2d_n16000_D2` → `WFourPlaneNSixteenThousandDTwo` |
| `w5a_L<L>` | `WFiveCycleL<L>` | `w5a_L1000000` → `WFiveCycleLOneMillion` |
| `w5b_L<L>` (icosphere level) | `WFiveSphereL<L>` | `w5b_L8` → `WFiveSphereLEight` |

**Method tags** `<m>`: `FullId`, `FullMorse`, `FullSorted`, `Gudhi`, `DrbId`,
`DrbIdRb`, `DrbRand`, `Mmhm`, `MmhmNorb`, `Euler`, `Lcr`, `LcrRc`.

**Per instance and method** (E1–E6; configs/E*.json): `\Num<inst><m><stat>`
with `<stat>` ∈

| stat | meaning |
|---|---|
| `Med`, `QOne`, `QThree`, `PNinetyFive`, `PNinetyNine`, `Max` | pooled per-update latency percentiles (µs) |
| `Amort` | amortized per-update latency (µs) |
| `InitMs` | INIT build time (ms, median of seeds) |
| `T` | updates timed per run (2,000, or the prefix T′ = 200 for `gudhi` above 3e5) |
| `SpeedupFullId`, `SpeedupFullIdMed`, `SpeedupGudhi` | ratios, see above |
| `Adds`, `Footprint` | DRB methods: mean column additions / mean footprint sum per non-rebuild update |
| `NnzStart`, `NnzEnd`, `NnzMax`, `NnzGrowth` | DRB methods: nnz(R)+nnz(V) after INIT, after the last update, max over the run (means of seeds), and end/start |
| `Rebuilds` | `mmhm`, `drb-id-rb` (default α = 1, period off): rebuilds per run, mean of seeds |

Per instance: `\Num<inst>Size` (|K₀|, mean of seeds), `\Num<inst>Ops` (mean
atomic edits per update), `\Num<inst>FullMorseOverFullId` (amortized ratio),
W1 only `\Num<inst>ClosedStates` (updates after which all holes are closed,
β₂ = 1, mean of seeds), W4 only `\Num<inst>Beta<k>Min/Max` (k = `Zero`…`Three`,
over all states of 3 seeds) and `\Num<inst>BetaDRatio` (β_D / n at INIT).

**Slopes** (log–log least squares; aggregate.py, `results/summary_slopes.csv`):
`\NumSlope<exp><family><m><Med|Amort>` = slope of log₁₀(median resp. amortized
latency) against log₁₀ of the size variable, with `…N` (number of points =
sizes; each point pools 3 seeds) and `…RSq` (R²). Families:

| exp | family | x variable | points |
|---|---|---|---|
| `EOne` | `WTwoSEight` | \|K₀\| | 5 |
| `ETwo` | `WTwoNTwentyTwo` | s (stellar moves per update) | 7 |
| `EThree` | `WThree` | \|K₀\| | 3 |
| `EFour` | `WFourPlaneDTwo` | \|K₀\| | 3 |
| `EFive` | `WOneSphere`, `WOneTorus` | \|K₀\| | 4 each |
| `ESix` | `WFiveCycle` (x = L), `WFiveSphere` (x = n₂) | | 7, 6 |

Fits on 3 points (E3, E4) are indicative only.

**E7** (configs/E7.json): `\NumESeven<inst><m><alpha><period><stat>` with
`<m>` ∈ {`Mmhm`, `DrbIdRb`}, `<alpha>` ∈ {`AQuarter`, `AHalf`, `AOne`, `ATwo`,
`AFour`, `AOff`}, `<period>` ∈ {`POff`, `PSixtyFour`, `PTwoHundredFiftySix`},
`<stat>` ∈ {`Amort`, `Med`, `PNinetyNine`, `Rebuilds`, `Adds`}.
`AOff POff` never rebuilds (= `mmhm-norb` resp. `drb-id` behaviour).

**Review round (paper/response/data.md maps each referee item to macros).**
Per instance and method (E1–E6), in addition to the stats above:
`AmortSeedMin/Max`, `MedSeedMin/Max`, `PNinetyNineSeedMin/Max` (per-seed
ranges, µs), `PNinetyNineOverFullId` (pooled p99 / `full-id` p99),
`FirstBlockMed`, `LastBlockMed` (median over updates 1–200 / 1801–2000),
`DriftMed`, `DriftMean` (last/first block), `SpeedupFullIdFirstBlock`,
`SpeedupFullIdLastBlock` (amortized speedup over `full-id` on those windows),
`SpeedupGudhi` (now matched: both methods over the same first T′ updates) and
`SpeedupGudhiUnmatched` (the old definition; do not use for claims),
`NnzPerSimplex` (DRB: max nnz / |K₀|, memory proxy), `Adds` also for
`full-id`/`full-morse` (additions per recomputation). Per instance:
`\Num<inst>DrbSpeedupFullIdMin/Max` (range over the 4 DRB variants),
`\Num<inst>BestDrb` (typeset method name), `\Num<inst>BestDrbWithinNoise`
(yes/no: seed ranges of best and second-best DRB overlap),
`\Num<inst>DrbIdBuildAdds`, `\Num<inst>MmhmNorbBuildAdds`,
`\Num<inst>BuildAddsMorseOverId`, `\Num<inst>NnzInitMorseOverId`.
Coverage: `\NumCoverage[<fam>]{GeOne,GeTwo,AllThree,External,EngineOnly}[Pct]`
and `\NumCoverage[<fam>]Vectors`, `<fam>` ∈ {`WOne`…`WFive`} or empty for all;
`\NumReferenceChecks`, `\NumReferenceSamples`, `\NumReferenceMethods`,
`\NumReferenceMismatches`. Drift: `\NumDriftFullIdInstances`,
`\NumDriftFullIdList`. lcr: `\NumLcr<inst>{Wrong,Updates,FirstWrongMax,FirstWrongList}`,
`\NumLcrFirstWrongMaxAll`, `\NumLcrRunsWrong`, `\NumLcrRuns`. E7:
`\NumESeven<inst>MmhmBelowDrbIdRb` (of `\NumESeven<inst>Settings`). Noise:
`\NumNoiseCV<inst><m>{Med,Amort,PNinetyNine}` for the noise.py instances,
`\NumNoiseCVSeeds<inst><m>{Amort,PNinetyNine}` for W5a (seeds = repetitions),
`\NumNoiseCVAmortMax`, `\NumNoiseCVPNinetyNineMax`,
`\NumNoise<m>LargeFourBusyPct` (interference at 955k simplices),
`\NumTimedRunsWithUntimed`, `\NumTimedRunsWithUntimedEngine`,
`\NumUntimedEnd`. Outlier: `\NumOutlierSeed<k>Block<j>Med` (k = Zero..Two,
j = One..Five, blocks of 400 updates), `\NumOutlierOrig{Amort,PNinetyNine}`,
`\NumOutlierRerun{Amort,Med,PNinetyNine,Block<j>Med,Identical}`,
`\NumWTwoNTwentyTwoSEightMmhmNorb{Amort,PNinetyNine}WithRerun`. Rebuild
effect: also `…WindowTime`, `…AfterFirstTime`, `…AfterFirstTimeInclRebuilds`.

**Review follow-up.** `lcr-rc`: `\NumLcrRc<inst>{ErrPct,Wrong,Updates,FirstWrong,FirstWrongList}`,
`\NumLcrRc{ErrAll,ErrMax,ErrMin,WorkloadsWrong,Period}`, `\NumSampleLcrRcWrong`;
the lower block of `tab_correctness.tex` has `lcr` and `lcr-rc` side by side.
`full-sorted`: the usual per-instance stats (`\Num<inst>FullSorted…`, incl.
`DriftMed`, `FirstBlockMed`, `LastBlockMed`, `Adds`), and for every other method
`\Num<inst><m>SpeedupFullSorted`, `…SpeedupFullSortedFirstBlock`,
`…SpeedupFullSortedLastBlock`; `tab_drift.tex` has `full-sorted`'s drift and
`mmhm` × `full-sorted` on both windows (set it in `\scriptsize` with
`\tabcolsep` 2.5pt). `drb-rand`: `\Num<inst>DrbRand…` stats,
`\Num<inst>DrbRandBuildAdds`, `\Num<inst>NnzInitRandOverId`,
`\Num<inst>NnzInitRandOverMorse`, `\Num<inst>DrbRandOverDrbIdAmort`,
`\Num<inst>DrbRandOverMmhmNorbAmort`; table `tab_rand.tex`.

**Rebuild effect** (aggregate.py, `results/summary_rebuild_effect.csv`):
`\NumRebuildEffect<inst><m>Window` (`<m>` ∈ {`Mmhm`, `DrbIdRb`}) = additions
in the 100 non-rebuild updates after each rebuild / additions of the twin
(`mmhm-norb` resp. `drb-id`) on the same updates, 3 seeds pooled;
`…AfterFirst` = same over all updates after the first rebuild. Defined only
for instances where the default policy rebuilt (W3, W1, one W4 run).

**E8** (aggregate.py, from E1/E3/E4/E5 runs): `\NumEEight<inst><m><stat>`,
`<stat>` ∈ {`AddsMed`, `AddsPNinetyNine`, `FootprintMed`,
`FootprintPNinetyNine`, `ZeroAddsPct`} over non-rebuild updates of 3 seeds.

**Correctness (E0)** (verify.py, crosscheck_samples.py):

| macro | meaning |
|---|---|
| `\NumExactRuns` | runs of exact methods checked |
| `\NumReportedStates` | Betti vectors reported by those runs |
| `\NumVerifiedStates` | (run, state) pairs compared with the engine `full-id` Betti file of the same instance |
| `\NumVerifiedStatesExpected`, `\NumVerifiedStatesGudhi` | same against the analytic Betti numbers / the GUDHI oracle |
| `\NumInternalChecks` | internal full-id verifications (`--verify-every 50`) |
| `\NumExactMismatches` | mismatching states of exact methods, all oracles |
| `\NumLcr<inst>ErrPct`, `\NumLcr<inst>FirstWrong` | `lcr`: % of wrong updates (3 seeds), first wrong update (min over seeds) |
| `\NumLcrErrMax`, `\NumLcrErrMin`, `\NumLcrErrAll` | max / min over E0 instances, and overall % |
| `\NumLcrWorkloadsWrong`, `\NumLcrWorkloads` | instances where `lcr` is ever wrong / all E0 instances |
| `\NumSamples`, `\NumSampleChecks`, `\NumSampleMismatches`, `\NumSampleLcrWrong` | sample cross-check (all exact engine configurations incl. aggressive rebuilds, the Python reference, GUDHI, analytic) |

**Noise** (noise.py): `\NumNoiseCV<m>Med`, `\NumNoiseCV<m>Amort` (CV in % over
`\NumNoiseReps` identical runs, `<m>` ∈ {`Mmhm`, `FullId`}),
`\NumNoise<m>TwoTimedPct`, `\NumNoise<m>FourBusyPct` (signed % change of the
median latency with one other timed run / with one timed run + two GUDHI
replays running concurrently).

**Protocol**: `\NumUpdates` (T), `\NumPrefix` (T′), `\NumSeeds`,
`\NumGudhiFullLimit` (gudhi runs all T updates iff |K₀| ≤ this),
`\NumGudhiSizeMax` (largest |K₀| at which gudhi is timed, on T′),
`\NumGudhiFullSizeMax` (largest |K₀| at which gudhi is timed on all T),
`\NumSizeMax`, `\NumSizeMin` (|K₀| range of timed runs), `\NumTimedRuns`,
`\NumComputeHours` (sum of per-run wall times; single-threaded processes),
`\NumConfiguredRuns`, `\NumNotRun` (configured runs without results; listed
with the reason in `experiments/results/NOT_RUN.csv`).

The macros `\NumUpdates`, `\NumPrefix`, `\NumGudhiSizeMax`, `\NumSizeMax`,
`\NumVerifiedStates`, `\NumExactMismatches`, `\NumLcrErrMax`,
`\NumWFourBetaDRatioMin`, `\NumWFourBetaDRatioMax` are the ones `main.tex`
already declares fallbacks for. Note `\NumGudhiSizeMax` is the largest |K₀|
at which `gudhi` was timed at all (on the prefix T′); the largest with all T
updates is `\NumGudhiFullSizeMax`.

## Written by `experiments/main_tables.py`

These are written from `results/summary.csv` and `results/summary_pairs.csv`. No new runs.

- `tab_main_summary.tex`: one representative instance per family. It shows:
  - the static reference, which is the faster (amortised) of `full-id` and `full-sorted`, marked i or s;
  - the amortised latency and p99 of the static reference, of `drb-id` and of `mmhm`, in ms;
  - the speedups over the static reference (° = within noise);
  - p99 in bold where it is above the static reference beyond noise.
- `tab_ablation.tex`: the amortised latency of the four DRB variants. The best variant is in bold, and ° marks a variant within noise of the best. It also gives rebuilds per run.
- `numbers_main.tex`: `\NumMain<Family><Quantity>{Min,Max}` macros. Each gives the range, over the DRB variants and instances of a family, of the amortised speedup over the faster static reference (`...Speedup`) or of the p99 ratio to it (`...ProbNinetyNineRatio`). `WThreeMmhm...` is `mmhm` only.
- `tab_correctness_exact.tex` (written by `aggregate.py`): the exact-method part of `tab_correctness.tex`. The full table, with the `lcr` rows, is used only by `MMHM_v1_erratum.tex`.
