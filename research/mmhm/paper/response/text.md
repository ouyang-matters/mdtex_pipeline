# Response to REVIEW.md: text (abstract, introduction, experiments, discussion, conclusion, appendix)

Scope: `main.tex`, `sections/{abstract,intro,overview,experiments,discussion,conclusion,appendix}.tex`,
`figures/f1_method.tex`. Line numbers refer to the files after this revision.

Two rules hold for everything added in this round:
- Every number is a `\Num` macro or comes from a generated table; none was computed by hand.
- "Within noise" means that the per-seed ranges of the two methods overlap, per `experiments/results/summary_pairs.csv`.

Build after the follow-up pass: `latexmk -pdf main.tex` gives 34 pages (the v2 draft had 30, before the new appendix tables). The log has no warnings, no undefined references or citations, no "??" and no overfull boxes.

## BLOCKING

**B1 (v1's experiments "could not reveal" the defects).** Fixed.
- `intro.tex:44-52` now says that v1's experiments *did not* detect the defects:
  - two of its workloads are surfaces whose Betti numbers the gates give without algebra;
  - for the third, v1 reports no Betti numbers and runs no independent comparison.
- Such a comparison would have sufficed. On the W2 analogue, `lcr` is wrong after `\NumLcrWTwoNFifteenSEightWrong` of `\NumLcrWTwoNFifteenSEightUpdates` updates. E0 gives the same figure (`experiments.tex:439`).

**B2 ("agree with three independent oracles").** Fixed.
- The coverage claim is now the one the reviewer proposed: every vector was compared with at least one reference, `\NumCoverageExternalPct`% with an external one, and none disagreed. It appears in:
  - the abstract, `abstract.tex:18-21`;
  - the introduction, `intro.tex:111-113`;
  - the conclusion, `conclusion.tex:15-17`;
  - E0, `experiments.tex:423-435`.
- New Table `tab:coverage` (generated, `experiments.tex:493-497`) gives the coverage per workload: at least one, at least two, all three and at least one external reference.
- The correctness protocol (`experiments.tex:373-400`) says which oracle covers which runs.

**B3 (E2 L=4 example).** The example is in the erratum, which the theory author owns. My files cite the erratum only by `\cref{sec:erratum}` and restate no example.

## MAJOR

**M1 (the 83.1% describes an ablation).** Fixed.
- The abstract (`abstract.tex:33-38`) and the conclusion (`conclusion.tex:18-21`) now name "an ablation that applies version 1's re-reduction rule without basis tracking (and without its recompression and gates)". They report time to first error (`\NumLcrFirstWrongMaxAll`), not an aggregate rate.
- `experiments.tex:136-148` defines `lcr` as an ablation that isolates E1, not a reimplementation of v1: it forms no Morse complex, never recompresses and has no gates.
- E0 (`experiments.tex:437-460`) gives the error rate per instance range and the first wrong update. It says that errors are absorbing, so the percentages mainly measure how early the first error comes. It also says that gates would be correct on W1 and that W5a is correct by construction.
- The pooled rate appears once, in E0 (`experiments.tex:457-460`). It is qualified as depending on the instance mix and as not an error rate of version 1.

**M2 (the 90x owes nothing to Morse/rebuilds).** Fixed.
- The speedup is now attributed to the dynamic reduced basis in the abstract (`abstract.tex:21-26`), the introduction (`intro.tex:115-119`) and the conclusion (`conclusion.tex:21-26`). All four DRB variants are `\NumWTwoNThirtyThreeSEightDrbSpeedupFullIdMin`-`Max` times faster, with or without the Morse order and rebuilds.
- E1 (`experiments.tex:514-519`) says that the four variants are within noise of each other and that on W2 the gain is that of the basis.
- Where `mmhm` or `mmhm-norb` is best beyond noise is stated per workload:
  - E3: `experiments.tex:659-661`
  - E4: `experiments.tex:719-720`
  - E5: `experiments.tex:751-762`
  - E8: `experiments.tex:981-1008`
- The same is summarised for the reader in `discussion.tex:115-123` ("Edit-local updates").

**M3 (no build-time sparsity; Morse costs more on W4).** Fixed. The drb-rand ablation is covered in the follow-up section below.
- Contribution (ii) (`intro.tex:88-99`) is narrowed to "The Morse order, evaluated". It says:
  - Lemma 2 is "not new in substance" (`intro.tex:89`);
  - the order saves nothing at build and costs more additions on W4;
  - its effect between rebuilds depends on the workload.
- E8 (`experiments.tex:936-941`; "At build time", `experiments.tex:943-959`) reports additions and nnz under both orders.
- New appendix Table `tab:build` (`appendix.tex:25-27`) compares build additions and nnz, insertion against Morse, for every instance.
- The abstract (`abstract.tex:27-29`) says that the order "saves nothing at build time ... and helps between rebuilds only on some" workloads.
- Discussion: `discussion.tex:41-54`.

**M4 (history-dependent insertion order; full-id drift).** Fixed. The full-sorted baseline is covered in the follow-up section below.
- The history dependence is disclosed at `experiments.tex:101-110`.
- New paragraph "Drift of the static baseline" (`experiments.tex:315-332`) lists the instances with more than 25% drift.
- Matched-window speedups over the first and the last 200 updates are given for:
  - E1: `experiments.tex:526-532`
  - E3: `experiments.tex:643-654`
  - E4: `experiments.tex:692-714`
- New appendix Table `tab:drift`: `appendix.tex:29-34`.
- Discussion, "Baselines": `discussion.tex:56-67`.

**M5 (gudhi prefix vs full-run means).** Fixed.
- Speedups over gudhi are now taken over the same first T' updates:
  - defined in the timing protocol, `experiments.tex:308-310`;
  - used in E1 (`experiments.tex:524-526`) and E3 (`experiments.tex:643-654`), with the matched `…SpeedupGudhi` macros.
- The `tab:summary` caption (`experiments.tex:587-588`) says that gudhi rows with T = `\NumPrefix` cover only the prefix.
- The measured drift paragraph (`experiments.tex:315-332`) replaces the claim that the baseline "does not drift".

**M6 (Proposition 3 model vs engine; proxies).** The text part is fixed.
- "Counters" (`experiments.tex:364-371`) calls the logged counts proxies for the cost terms of Prop. 3: they count terms, not chain sizes, and need not move with time. The sentence "These are the quantities of Proposition 3" is removed.
- `discussion.tex:31-39` ("No locality theorem, and proxies for cost") says that proxies and time can disagree (E7).
- Engine logging is not in my files.

**M7 (mechanisms stated as fact).** Fixed.
- The W1 mechanism is now "We conjecture that ...; we have not measured chain sizes" (`experiments.tex:797-800`).
- `discussion.tex:5-15`: "we have not measured why (E5)".
- The index cost of `mmhm` is "we attribute this, without having profiled it" (`experiments.tex:734`) and "we believe" (`discussion.tex:43-44`).
- The E6 Morse-order effect is "we have not identified why" (`experiments.tex:827-840`).
- The W1 additions/time disagreement is "we have not identified the mechanism" (`experiments.tex:901-920`).

**M8 (comparisons within noise).** Fixed.
- The noise paragraph (`experiments.tex:334-362`) adds:
  - the W1 torus 256, W3 N=20 and W5a L=1e5;
  - the p99 CVs;
  - the interference test at the largest W2 size.
- It defines "within noise" by overlap of the per-seed ranges (`experiments.tex:360-362`).
- The comparisons the reviewer listed are now marked within or beyond noise:
  - E1: `experiments.tex:514-519`
  - E3: `experiments.tex:624-661`
  - E4: `experiments.tex:715-717`, `experiments.tex:719-720`
  - E5: `experiments.tex:751-762`
  - E6: `experiments.tex:827-840`
  - E7 W1: `experiments.tex:901-920`
  - E8: `experiments.tex:981-1008`

**M9 (rebuild effect; "pays off when the basis grows").** Fixed.
- E7 reports the effect after the first rebuild (`…AfterFirst`, `…AfterFirstTime`) alongside the 100-update window:
  - intro: `experiments.tex:857-862`
  - W3: `experiments.tex:880-899`
  - W1: `experiments.tex:901-920`
- On W1, rebuilds help the smaller surfaces and not the largest. The text cites `tab:rebuild-effect` for W1.
- The `fig:rebuild` caption (`experiments.tex:929-930`) says that E7 has no W1 instance and points to that table.
- New appendix Table `tab:rebuild-effect`: `appendix.tex:36-43`.
- The conclusion (`conclusion.tex:29-39`) replaces "pays off when the basis grows" with: rebuilding paid off on cavities, did not trigger on refinement and flag complexes, and on surfaces helped the smaller instances but not the largest.
- Discussion: `discussion.tex:41-54`.

**M10 (W5b level-8 p99).** Fixed. `experiments.tex:831-836` gives the p99 of `mmhm` and `mmhm-norb` at W5b level 8 as `\NumWFiveSphereLEightMmhm{,Norb}PNinetyNineOverFullId` times that of `full-id`, and the ratios for the insertion-order variants.

**M11 (E1 outlier).** Fixed with the rerun macros.
- `experiments.tex:543-555`: the run was slow only in its first 400 updates (per-block medians of the three seeds) and was not slower after update 800.
- The rerun produced identical Betti numbers, additions, nnz and footprints and was not slow. The pooled figures with the rerun are `…WithRerun`.
- The `fig:latency-s` caption (`experiments.tex:619`) marks the hollow `mmhm-norb` point at s = 8 as including the outlier.
- The `tab:full-amort` and `tab:full-p99` captions (`appendix.tex:45-49`, `appendix.tex:56-58`) note the same.
- Discussion: `discussion.tex:73`.

**M12 (erratum).** Owned by the theory author.

**M13 (novelty of Lemma 2).** The text part is fixed: "not new in substance" (`intro.tex:89`). Related work is the theory author's.

**M14 (reproducibility).** The text part is fixed.
- `conclusion.tex:50-55` keeps `% TODO(author): replace with repository URL` and points to:
  - `experiments/README.md`;
  - `experiments/results/WORKLOADS_MANIFEST.csv`, which holds the generator command and the SHA-256 of every workload instance.
- See also `experiments.tex:15-18`.
- Publishing the archive is for the author.

## MINOR (items in my files)

1. Fixed. `intro.tex:100-104` now reads "on which every toggle of one simplex costs ... Ω(n)"; see also `experiments.tex:249`.
8. Fixed. The Table 1 caption (`experiments.tex:61-68`) explains "Rebuilds" ("policy" is the rebuild policy) and "Exact".
9. Fixed. p99 claims cite `tab:summary,tab:full-p99`: `experiments.tex:524`, `experiments.tex:715-717`, `experiments.tex:775-781`, `experiments.tex:827-840`.
10. Generated tables (data side).
11. Fixed. E7 gives the number of settings at which `mmhm` beats `drb-id-rb` separately for W2 and W4 (`experiments.tex:864-878`) and for W3 (`experiments.tex:880-899`), as macros.
12. Fixed.
    - The first wrong update is the maximum over runs (`experiments.tex:440-442`).
    - W2 is quoted as `\NumLcrWTwoNFifteenSEightWrong` of `\NumLcrWTwoNFifteenSEightUpdates` (`experiments.tex:439`).
13. Fixed. `experiments.tex:663-664` reads "The basis grows over a W3 run (...; it also grows on W1, E5)", and E7 says "On the surfaces of W1, where the basis also grows" (`experiments.tex:857-862`).
14. Fixed.
    - `experiments.tex:557-568`: on W2 there is little to save, and on W4 `full-morse` performs more additions.
    - The extrapolation to v1's coreduction-only baseline is hedged ("a different implementation, we cannot say").
    - `discussion.tex:49`.
15. Fixed. `experiments.tex:364-371` says that only the per-update sum of footprints is logged and that a rebuild row sums the additions of the rebuild and of the edits. E8 uses the updates without a rebuild (`tab:e8` caption, `appendix.tex:51-54`).
16. Fixed. `experiments.tex:101-110` now says: "differences reflect mostly the algorithms; the remaining implementation differences are this history dependence and the index that `mmhm` maintains (E4)".
17. Fixed with the new data. `experiments.tex:349-359` reports interference at the largest W2 size and states that two concurrent timed runs at about 10^6 simplices were not measured.
18. Fixed. `nnz(R)+nnz(V)` per simplex is reported as a memory proxy: `discussion.tex:69-82`, `experiments.tex:540-541`.
19. Fixed. E5 (`experiments.tex:775-781`): the median of `mmhm` is `\NumWOneSphereLSevenMmhmSpeedupFullIdMed` times below `full-id`, its p99 is higher, and a heavy tail sets the average.
20. Partly done.
    - The erratum is its own section, listed in the outline (`intro.tex:139-145`).
    - Detail moved to the appendix.
    - Medians, the E7 grid, noise and per-seed ranges are no longer typeset. They stay in `paper/generated/` and `experiments/results/` (`appendix.tex:8-12`).
    - The title is unchanged: `intro.tex:55-56` says "It keeps the title because discrete Morse theory still has a role, though a smaller one". A new title is the author's call.
    - The abstract is rewritten around the claims.
21. Fixed. The F2 caption (`experiments.tex:576`) says that panel (d) omits the overlapping DRB bands. The F7 caption (`experiments.tex:1019-1020`) says that the W1 torus is not shown. `figures/README.md` is not mine.
22. The SPEC belongs to the theory side. The Case A tie rule is stated at `experiments.tex:35-36`.
23. `experiments.tex:15-18` is scoped to "Every measured number". The literals in `aggregate.py` and the erratum's counts are outside my files.
25. Fixed. `discussion.tex:5-15`: "Five workload families do not settle which properties of a workload decide the regime"; the W1 cost is marked as unexplained.
26. Fixed. `abstract.tex:15-16`: "in the order given by a collapse that declares critical cells of the highest dimension".

Items 2-7 and 24 are in the theory and erratum files.

## Follow-up pass: lcr-rc, full-sorted, drb-rand

The data are from the data agent's follow-up in `response/data.md` (macros `\NumLcrRc…`, `\Num…SpeedupFullSorted{,FirstBlock,LastBlock}`, `\Num…FullSortedDriftMed`, `\Num…DrbRand…`, `\Num…NnzInitRandOver…`) and from `tab_rand`, `tab_drift` and `tab_correctness`. Each qualitative statement was checked against `experiments/results/summary_pairs.csv`. All 12 `% PENDING-ABLATION` comments are removed.

**Definitions.**
- Table 1 has rows for `full-sorted`, `drb-rand` and `lcr-rc`, and the caption defines "canonical": by dimension, then lexicographically by vertex tuple (`experiments.tex:61-85`).
- Static baselines (`experiments.tex:92-110`): `full-sorted` recomputes in the canonical order. Its order depends only on the current complex, so it cannot drift with the history. It is called the history-independent reference. It keeps the tuple index, as `mmhm` does.
- Dynamic methods (`experiments.tex:131-134`): `drb-rand` is built in a seeded uniformly random order per dimension and never rebuilt.
- Ablations (`experiments.tex:143-148`): `lcr-rc` is `lcr` plus v1's periodic recompression (m = `\NumLcrRcPeriod`). It rebuilds all reduced columns from scratch in the current key order, with no Morse complex, ρ trigger or gates.
- The sweeps table lists the new methods (`experiments.tex:262-281`).

**M1, lcr-rc.**
- E0 lead: `experiments.tex:420-421`.
- New E0 paragraph (`experiments.tex:462-475`):
  - `lcr-rc` coincides with `lcr` until its first recompression, so its first-wrong updates are the same; the `FirstWrongList` macros are identical for all nine instances.
  - It is wrong after `\NumLcrRcErrAll`% of updates overall, against `\NumLcrErrAll`% for `lcr`.
  - By workload: W2 `\NumLcrRcWTwoNFifteenSEightErrPct`% (168 of 6,000), W5b `\NumLcrRcWFiveSphereLFiveErrPct`%, W5a 0.0%, and W1/W3/W4 `\NumLcrRcWFourPlaneNFourThousandDTwoErrPct`–`\NumLcrRcErrMax`%.
  - On W2, the P2 analogue, recompression hides most errors, but a comparison still finds them from the first updates on.
- The Table 3 caption describes the `lcr-rc` column (`experiments.tex:482-485`).
- Abstract (`abstract.tex:36-38`), introduction (B1 sentence, `intro.tex:50-52`) and conclusion (`conclusion.tex:20-21`) add the recompressed variant.

**M4, full-sorted.**
- Drift paragraph (`experiments.tex:321-332`):
  - W1 and W2: at most `\NumWOneSphereLFourFullSortedDriftMed`.
  - W4: `\NumWFourSpaceNOneThousandDThreeFullSortedDriftMed`–`\NumWFourPlaneNFourThousandDThreeFullSortedDriftMed`, against full-id's `\NumWFourPlaneNSixteenThousandDTwoFullIdDriftMed`–`\NumWFourPlaneNOneThousandDTwoFullIdDriftMed`.
  - W3: `\NumWThreeNFourteenFullSortedDriftMed`–`\NumWThreeNTwentyFullSortedDriftMed`. Part of the W3 drift therefore comes from the complex, not from the order.
- E1 (`experiments.tex:532-537`): full-sorted is within noise of full-id at N=33. `mmhm` is `\NumWTwoNThirtyThreeSEightMmhmSpeedupFullSorted`× faster (windows 44.2×/100×), so the early-update cost is the DRB's own. `full-morse` is slower than both baselines everywhere (`experiments.tex:558-559`).
- E3 is rewritten with full-sorted as the stated reference (`experiments.tex:626-661`):
  - At N=27, `mmhm` is `\NumWThreeNTwentySevenMmhmSpeedupFullSorted`× faster than full-sorted (windows 7.45×/8.44×), against `\NumWThreeNTwentySevenMmhmSpeedupFullId`× over full-id.
  - The two baselines cost the same over the first 200 updates (full-id runs at 0.957× full-sorted's speed) and diverge as full-id drifts (0.564× over the last 200).
  - New finding: against full-sorted, `drb-id` and `mmhm-norb` are slower at N=14, and `drb-id` also at N=20 (speedup 0.794). Only the rebuilding variants are faster at every size.
  - p99 against full-sorted: only `mmhm` is within noise at N=14. At N=27, `mmhm` and `drb-id-rb` are lower, `mmhm-norb` is within noise and `drb-id` is higher.
- E4 is rewritten with full-sorted as the stated reference (`experiments.tex:686-717`):
  - Speedups are `\NumWFourSpaceNOneThousandDThreeDrbIdRbSpeedupFullSorted`–`\NumWFourPlaneNOneThousandDTwoMmhmNorbSpeedupFullSorted` at n=1000 and `\NumWFourPlaneNFourThousandDThreeDrbIdSpeedupFullSorted`–`\NumWFourPlaneNSixteenThousandDTwoMmhmNorbSpeedupFullSorted` at n≥4000. Full-id figures are kept alongside.
  - At 16k, full-sorted is slower than full-id. `mmhm` is `\NumWFourPlaneNSixteenThousandDTwoMmhmSpeedupFullSorted`× faster than full-sorted (windows 81.2×/120×).
  - The p99 statement now covers both baselines.
- E5 (`experiments.tex:755-759`): against full-sorted, `drb-id` is slower on every W1 instance (within noise on torus 256) and `mmhm-norb` on the four smallest. No DRB method is more than `\NumWOneSphereLSevenMmhmNorbSpeedupFullSorted`× faster.
- Discussion: "Baselines" (`discussion.tex:56-67`) and "Small complexes" (`discussion.tex:106-113`).
- Introduction (iv) names the canonical-order baseline (`intro.tex:107-109`). The conclusion adds that on cavities the gain is smaller against the canonical order (`conclusion.tex:30-37`).
- The `tab:drift` caption covers the full-sorted columns (`appendix.tex:29-34`).

**M3, drb-rand.**
- E8 lead (`experiments.tex:936-938`) and new paragraph "Against a random order" (`experiments.tex:961-979`):
  - After INIT, nnz is `\NumWFourPlaneNFourThousandDTwoNnzInitRandOverId`–`\NumWThreeNFourteenNnzInitRandOverId`× that of either structured order.
  - The build needs more additions on every instance. On W2: 72,361 against 192 and 0.
  - On W1–W3, updates are slower beyond noise by `\NumWThreeNFourteenDrbRandOverDrbIdAmort`–`\NumWTwoNFifteenSEightDrbRandOverDrbIdAmort`× (W2: 348 against 88.4 and 91.1 µs).
- New appendix Table `tab:rand` (`tab_rand`): `appendix.tex:64-67`.
- Discussion (`discussion.tex:49-54`), introduction contribution (ii) (`intro.tex:94-96`), abstract (`abstract.tex:27-29`) and conclusion (`conclusion.tex:30-37`).

**Where the data contradicted the brief.**
- *drb-rand on W4.* `drb-rand` is within noise of `drb-id` (ratio 1.19, seed ranges overlap). So "1.2–3.9× slower than either structured order" holds beyond noise only on W1–W3 and against `mmhm-norb` on W4 (1.48×). The text says so. On W3 the gap between the two structured orders (Morse 1.22× faster) is not small next to the random order's 1.50×, so the text says only that the choice of structured order "matters less" than using one.
- *full-sorted on W3.* full-sorted drifts by 1.44 at N=14, the same as full-id, so the text says that it drifts less "on the larger instances".
- *lcr-rc first errors.* The data agent wrote "update 1–16" as a range. The per-instance minima are 1–5, and the maximum over runs is 16, the same as for `lcr`. The text cites Table 3 and the identity with `lcr`.
