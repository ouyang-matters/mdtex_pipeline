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
| `tab_summary.tex` | T2: per workload × method at the largest size of each family: T (or T′), median, p95, p99 and amortized per-update latency (µs), amortized speedup vs `full-id` |
| `tab_summary_full.tex` | same for every instance of E1–E6 (long; appendix) |
| `tab_e7.tex` | E7: rebuilds per run, amortized and p99 latency (µs) for `mmhm` and `drb-id-rb` over α × period |
| `tab_e8.tex` | E8: median and p99 of per-update column additions and footprints, nnz(R)+nnz(V) after INIT and at the end, for the four DRB methods |
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
* **Speedups** are ratios of amortized latencies (`SpeedupFullId` =
  amortized of `full-id` / amortized of the method; `…Med` variants use
  medians). For `gudhi` above 3e5 simplices the reference is its own prefix
  T′ = 200 (`\Num<inst>GudhiT`).
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

**Method tags** `<m>`: `FullId`, `FullMorse`, `Gudhi`, `DrbId`, `DrbIdRb`,
`Mmhm`, `MmhmNorb`, `Euler`, `Lcr`.

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
`\NumComputeHours` (sum of per-run wall times; single-threaded processes).
