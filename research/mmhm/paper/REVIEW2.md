# Second-round verification of the MMHM v2 revision (response to REVIEW.md)

Date 2026-10-11. This is one verification pass over the revised sources (HEAD `58a1282`), the three
author responses in `paper/response/`, the new runs (`lcr-rc`, `full-sorted`, `drb-rand`, the
outlier rerun, the extra noise runs) and the rebuilt `main.pdf` (34 pages). No existing file was
modified.

## Verdict

**The revision resolves every BLOCKING item. Nothing BLOCKING remains, so the paper can be shared
as a preprint.**

- **Theory:** the changed parts (new Lemma 2(c) proof, Proposition 1.1, the two cost models of
  Proposition 3, the scope of Proposition 4) are correct.
- **Erratum:** the new E1/E2 instances do refute v1 under its own safeguards. I checked this by
  hand for E1 and the two-cycle E2 instance, and `check_props.py` reruns with 0 failures.
- **Numbers:** all 14 new or changed numbers I recomputed from raw CSVs match the macros.
  `verify.py` and `aggregate.py` reproduce every generated table and results CSV byte for byte.
- **MAJOR items:** 13 of 14 are resolved; M14 is partial (no public archive).
- **Remaining issues:** a few small overclaims, listed under (3). They can wait until submission.

## What I re-ran

All runs were on scratch copies.

- **`reference/check_props.py`:** 16.8 s, 0 failures. The new check (f) reproduces the E1 instance
  (ρ ≤ 0.15 / 0.24 / 0.27 / 0.26, v1 reports (19,1) against the true (18,0), 6 of 6 row orders) and
  both E2 instances (two 8-cycles: ρ ≤ 0.25; 5×5 torus with a cone: ρ ≤ 0.20). It also confirms
  that the old 4-cycle and 3×3-torus instances have ρ ≥ τ.
- **`check_props.py --write-tex`:** reproduces `reference/check_props_numbers.tex` exactly (full
  run; `--quick` gives smaller random-test counts, as expected).
- **`verify.py` then `aggregate.py`:** reproduce `E0_correctness.csv`, `E0_lcr.csv`, every
  `summary*.csv` and every `paper/generated/*.tex` byte for byte (1,344 runs, 11,748 macros).
- **`main.log`:** no warnings, no overfull boxes. The PDF contains no `??`, and no `PENDING`
  markers remain in the sources.

## (1) Status of each BLOCKING and MAJOR item

| item | status | evidence |
|---|---|---|
| B1 "could not reveal" | **resolved** | `intro.tex:44-52`, `erratum.tex` §"What the experiments of version 1 checked": "did not detect"; W2 `lcr` 5,999 of 6,000 wrong, `lcr-rc` 168 of 6,000, first errors from update 1 |
| B2 "three independent oracles" | **resolved** | `abstract.tex:18-21`, `intro.tex:111-113`, `conclusion.tex:15-17`; new coverage table; recomputed below |
| B3 L=4 E2 instance | **resolved** | `erratum.tex` §"What counts as a counterexample" plus two new instances with ρ < τ; old instances relabelled "illustrations only" |
| M1 83.1% is an ablation | **resolved** | `lcr` called an ablation everywhere; time to first error reported; `lcr-rc` added (periodic trigger only) |
| M2 90× owes nothing to Morse | **resolved** | abstract, intro and conclusion give the 90.2–91.5× range "with or without the Morse order" |
| M3 no build-time sparsity | **resolved** | contribution (ii) narrowed; `tab:build`; `drb-rand` ablation (structured vs random order) |
| M4 history-dependent baseline | **resolved** | `full-sorted` added; drift table; W3 speedup now 5.99× against `full-sorted` |
| M5 gudhi prefix bias | **resolved** | matched prefixes (948×, 160×); docstring corrected |
| M6 cost model vs engine | **resolved** | Proposition 3 in ordered-set and sorted-array models; logged counts called proxies |
| M7 unmeasured mechanisms | **resolved** | W1 mechanism now a conjecture, with block medians; one inference sentence remains (see (3)) |
| M8 noise | **resolved** | 3 more noise instances, p99 CVs, interference at 955k; "within noise" defined by per-seed range overlap |
| M9 rebuild effect | **resolved** | after-first ratios in additions and time reported; conclusion rewritten; W1 cited to `tab:rebuild-effect` |
| M10 W5b p99 | **resolved** | `experiments.tex:810-813, 831-836` (1.13× and 1.15×) |
| M11 outlier | **resolved** | accurate block medians; rerun identical apart from timing, amortised 114 µs |
| M12 erratum clauses | **resolved** | v1 quoted verbatim; row clause and "recompute r_k" readings handled per instance |
| M13 novelty | **resolved** | "not new in substance"; Bauer–Roll, Sköldberg and Jöllenbeck–Welker cited. Caveat: the Bauer–Roll full text was not read (theory response); check the cited claim against the paper before submission |
| M14 reproducibility | **partial** | `WORKLOADS_MANIFEST.csv` (SHA-256), `ENGINE.txt` and `experiments/README.md` added; `verify.py` fails loudly; still no public archive (`conclusion.tex:50-52`, TODO) |

## (2) New errors introduced by the revision

None of substance.

- **Lemma 2(c).** The new proof argues that the pair is adjacent in the order, so it is an apparent
  pair. It is correct and simpler than before.
- **Proposition 1.1.** It now covers the reduction without clearing, which closes my old minor 24.
- **Proposition 3.** The sorted-array bounds (insertion Σ(|R⁽ⁱ⁾|+|V⁽ⁱ⁾|+|R_p|+|V_p|); Case A
  Σ_{j∈O}(1+|V_j|+|V_z|); Case B Σ(…+|R_p|+|V_p|)) follow from merge cost, and the proof sketch
  covers the target. One omission: the engine's filtering of the lazy footprint list,
  O(raw list · log|V|), is outside both models. Mention it in the "hybrid" paragraph. This can wait.
- **Proposition 4.** Its upper bound is now correctly restricted to the ordered-set model, and its
  scope is "every toggle of σ".
- **Erratum ρ argument.** For E1, the numerator (critical cells before or after the update, in the
  closed stars of the edited vertices) is 3, 5, 6 and 6, over 20, 21, 22 and 23 critical cells. For
  E2 on two 8-cycles it is {2} over 4 critical cells. Both match the paper.
- **Gates.** The erratum now states explicitly that the instances use v1 without gates, because the
  gate preconditions fail and the validity trigger would otherwise fire. This is the configuration
  v1 itself used for P2, so the argument is sound and honestly scoped.

## (3) Remaining overclaims in the abstract, introduction, conclusion and discussion (non-blocking)

1. **`abstract.tex:36-38` and `conclusion.tex:20-21`.** "with version 1's periodic recompression it
   is still wrong after 84.5–93.8% of the updates on surfaces, cavities and flag complexes".
   - `lcr-rc` models only the periodic trigger. On surfaces, v1's gates, or its locality trigger
     on a small critical complex, would likely intervene.
   - The intro's "What we do not claim" covers this, but the abstract does not.
   - **Fix:** after "periodic recompression" add "(the periodic trigger only, without the locality
     trigger or gates)".
2. **`discussion.tex:13`.** "on W1 and W5a its tail latency is worse" omits W5b level 8 for the
   Morse variants, which E6 now reports. **Fix:** add "and, for the Morse-ordered variants, at the
   largest W5b size".
3. **`experiments.tex:790-791`.** "so a typical W1 update works on chains whose size grows with the
   complex" is an inference stated as fact, two lines before "we have not measured chain sizes".
   **Fix:** "presumably works on chains …".
4. **"Within noise".** It is defined by the overlap of 3 per-seed ranges. On W1–W4 the seeds are
   different instances, so this conflates instance variation with timing noise. That is
   conservative but should be said once in the noise paragraph.

## (4) Must fix before sharing vs can wait

- **Must fix before sharing:** nothing.
- **Before journal submission:**
  - publish the code and data archive and replace the TODO (`conclusion.tex:50-52`);
  - verify the Bauer–Roll attribution against the full text;
  - apply items 1–4 of (3);
  - mention the lazy footprint-list filtering cost alongside Proposition 3.

## Recomputed new or changed numbers (raw CSVs and my own script; no `aggregate.py` code)

| claim | macro | paper | recomputed | ok |
|---|---|---|---|---|
| matched-prefix gudhi speedup, W2 N=33 (mmhm) | `\NumWTwoNThirtyThreeSEightMmhmSpeedupGudhi` | 948 | 948.5 | ✓ |
| matched-prefix gudhi speedup, W3 N=27 (mmhm) | `\NumWThreeNTwentySevenMmhmSpeedupGudhi` | 160 | 159.6 | ✓ |
| full-sorted speedup, W3 N=27 (mmhm): overall / first 200 / last 200 | `…MmhmSpeedupFullSorted{,FirstBlock,LastBlock}` | 5.99 / 7.45 / 8.44 | 5.989 / 7.451 / 8.443 | ✓ |
| W3 vs full-sorted: drb-id at N=20; full-id speed ratio, first and last 200 | various | 0.794; 0.957 / 0.564 | 0.794; 0.957 / 0.564 | ✓ |
| lcr-rc error rate, overall; W2; W5b; W1/W3/W4 range | `\NumLcrRcErrAll`, … | 60.2%; 2.8% (168); 0.8%; 84.5–93.8% | 60.23% (32,525/54,000); 2.80% (168); 0.80%; 84.45–93.77% | ✓ |
| coverage: all three; ≥1 external; total | `\NumCoverageAllThree{,Pct}`, `…External…`, `…Vectors` | 1,327,401 (52.4%); 2,490,669 (98.3%); 2,532,690 | 1,327,401 (52.41%); 2,490,669 (98.34%); 2,532,690; 0 mismatches | ✓ |
| drb-rand on W2 N=15, amortised: rand / id / norb | `\NumWTwoNFifteenSEightDrbRandOverDrbIdAmort` | 348 / 88.4 / 91.1 µs (3.94×) | 348.5 / 88.4 / 91.1 (3.94×); per-seed ranges disjoint | ✓ |
| drb-rand on W4 2D n=4k against drb-id | text: "within noise" | 1.19× | 1.19×; per-seed ranges overlap (152–188 vs 128–154) | ✓ |
| outlier rerun: amortised; pooled with rerun (amortised, p99) | `\NumOutlierRerunAmort`, `…WithRerun` | 114; 124 / 245 µs | 114.0; 124.4 / 244.5; all non-timing columns identical to the original over 2,001 rows | ✓ |
| W5b level-8 p99 / full-id: mmhm, mmhm-norb, drb-id, drb-id-rb | `…PNinetyNineOverFullId` | 1.13, 1.15, 0.849, 0.859 | 1.127, 1.153, 0.849, 0.859 | ✓ |
| rebuild effect after first rebuild, mmhm / mmhm-norb, W1 sphere L=7: additions, time | `\NumRebuildEffectWOneSphereLSevenMmhmAfterFirst{,Time}` | 0.92, 1.09 | 0.92, 1.09 | ✓ |
| same for W3 N=20 | `\NumRebuildEffectWThreeNTwentyMmhmAfterFirst{,Time}` | 0.85, 0.33 | 0.85, 0.33 | ✓ |
| full-sorted vs mmhm, W2 N=33 and W4 16k: overall / first 200 / last 200 | `…MmhmSpeedupFullSorted…` | 88.6 / 44.2 / 100; 114 / 81.2 / 120 | 88.6 / 44.2 / 100.3; 113.8 / 81.2 / 120.3 | ✓ |
| full-id and full-sorted median drift, W3 N=14 / 20 / 27 | `…{FullId,FullSorted}DriftMed` | 1.44, 2.22, 2.86; 1.44, 1.84, 1.72 | identical | ✓ |
| max DRB speedup over full-sorted on W1 | `\NumWOneSphereLSevenMmhmNorbSpeedupFullSorted` | 2.00 | 2.003 | ✓ |
