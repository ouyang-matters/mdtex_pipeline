# Response to REVIEW.md: text (abstract, introduction, experiments, discussion, conclusion, appendix)

Scope: `main.tex`, `sections/{abstract,intro,overview,experiments,discussion,conclusion,appendix}.tex`,
`figures/f1_method.tex`. Line numbers refer to the files after this revision.

Two rules hold for everything added in this round:
- Every number is a `\Num` macro or comes from a generated table; none was computed by hand.
- "Within noise" means that the per-seed ranges of the two methods overlap, per `experiments/results/summary_pairs.csv`.

Build: `latexmk -pdf main.tex` gives 33 pages (the v2 draft had 30, before the new appendix tables). The log has no warnings, no undefined references or citations, no "??" and no overfull boxes.

## BLOCKING

**B1 (v1's experiments "could not reveal" the defects).** Fixed.
- `intro.tex:44-50` now says that v1's experiments *did not* detect the defects:
  - two of its workloads are surfaces whose Betti numbers the gates give without algebra;
  - for the third, v1 reports no Betti numbers and runs no independent comparison.
- Such a comparison would have sufficed. On the W2 analogue, `lcr` is wrong after `\NumLcrWTwoNFifteenSEightWrong` of `\NumLcrWTwoNFifteenSEightUpdates` updates. E0 gives the same figure (`experiments.tex:420`).

**B2 ("agree with three independent oracles").** Fixed.
- The coverage claim is now the one the reviewer proposed: every vector was compared with at least one reference, `\NumCoverageExternalPct`% with an external one, and none disagreed. It appears in:
  - the abstract, `abstract.tex:18-21`;
  - the introduction, `intro.tex:106-108`;
  - the conclusion, `conclusion.tex:15-17`;
  - E0, `experiments.tex:404-416`.
- New Table `tab:coverage` (generated, `experiments.tex:463-467`) gives the coverage per workload: at least one, at least two, all three and at least one external reference.
- The correctness protocol (`experiments.tex:355-382`) says which oracle covers which runs.

**B3 (E2 L=4 example).** The example is in the erratum, which the theory author owns. My files cite the erratum only by `\cref{sec:erratum}` and restate no example.

## MAJOR

**M1 (the 83.1% describes an ablation).** Fixed.
- The abstract (`abstract.tex:32-35`) and the conclusion (`conclusion.tex:18-20`) now name "an ablation that applies version 1's re-reduction rule without basis tracking (and without its recompression and gates)". They report time to first error (`\NumLcrFirstWrongMaxAll`), not an aggregate rate.
- `experiments.tex:128-136` defines `lcr` as an ablation that isolates E1, not a reimplementation of v1: it forms no Morse complex, never recompresses and has no gates.
- E0 (`experiments.tex:418-441`) gives the error rate per instance range and the first wrong update. It says that errors are absorbing, so the percentages mainly measure how early the first error comes. It also says that gates would be correct on W1 and that W5a is correct by construction.
- The pooled rate appears once, in E0 (`experiments.tex:438-441`). It is qualified as depending on the instance mix and as not an error rate of version 1.

**M2 (the 90x owes nothing to Morse/rebuilds).** Fixed.
- The speedup is now attributed to the dynamic reduced basis in the abstract (`abstract.tex:21-26`), the introduction (`intro.tex:110-114`) and the conclusion (`conclusion.tex:20-25`). All four DRB variants are `\NumWTwoNThirtyThreeSEightDrbSpeedupFullIdMin`-`Max` times faster, with or without the Morse order and rebuilds.
- E1 (`experiments.tex:484-489`) says that the four variants are within noise of each other and that on W2 the gain is that of the basis.
- Where `mmhm` or `mmhm-norb` is best beyond noise is stated per workload:
  - E3: `experiments.tex:617-622`
  - E4: `experiments.tex:670-671`
  - E5: `experiments.tex:702-709`
  - E8: `experiments.tex:909-936`
- The same is summarised for the reader in `discussion.tex:108-116` ("Edit-local updates").

**M3 (no build-time sparsity; Morse costs more on W4).** Fixed; drb-rand is pending.
- Contribution (ii) (`intro.tex:86-95`) is narrowed to "The Morse order, evaluated". It says:
  - Lemma 2 is "not new in substance" (`intro.tex:87`);
  - the order saves nothing at build and costs more additions on W4;
  - its effect between rebuilds depends on the workload.
- E8 (`experiments.tex:883-886`; "At build time", `experiments.tex:888-904`) reports additions and nnz under both orders.
- New appendix Table `tab:build` (`appendix.tex:25-27`) compares build additions and nnz, insertion against Morse, for every instance.
- The abstract (`abstract.tex:27-28`) says that the order "saves nothing at build time ... and helps between rebuilds only on some" workloads.
- Discussion: `discussion.tex:41-51`.

**M4 (history-dependent insertion order; full-id drift).** Fixed; full-sorted is pending.
- The history dependence is disclosed at `experiments.tex:96-102`.
- New paragraph "Drift of the static baseline" (`experiments.tex:306-314`) lists the instances with more than 25% drift.
- Matched-window speedups over the first and the last 200 updates are given for:
  - E1: `experiments.tex:496-502`
  - E3: `experiments.tex:609-617`
  - E4: `experiments.tex:661-666`
- New appendix Table `tab:drift`: `appendix.tex:31-35`.
- Discussion, "Baselines": `discussion.tex:53-61`.

**M5 (gudhi prefix vs full-run means).** Fixed.
- Speedups over gudhi are now taken over the same first T' updates:
  - defined in the timing protocol, `experiments.tex:299-301`;
  - used in E1 (`experiments.tex:494-496`) and E3 (`experiments.tex:609-617`), with the matched `…SpeedupGudhi` macros.
- The `tab:summary` caption (`experiments.tex:554-555`) says that gudhi rows with T = `\NumPrefix` cover only the prefix.
- The measured drift paragraph (`experiments.tex:306-314`) replaces the claim that the baseline "does not drift".

**M6 (Proposition 3 model vs engine; proxies).** The text part is fixed.
- "Counters" (`experiments.tex:346-353`) calls the logged counts proxies for the cost terms of Prop. 3: they count terms, not chain sizes, and need not move with time. The sentence "These are the quantities of Proposition 3" is removed.
- `discussion.tex:31-39` ("No locality theorem, and proxies for cost") says that proxies and time can disagree (E7).
- Engine logging is not in my files.

**M7 (mechanisms stated as fact).** Fixed.
- The W1 mechanism is now "We conjecture that ...; we have not measured chain sizes" (`experiments.tex:744-747`).
- `discussion.tex:5-15`: "we have not measured why (E5)".
- The index cost of `mmhm` is "we attribute this, without having profiled it" (`experiments.tex:685`) and "we believe" (`discussion.tex:43-44`).
- The E6 Morse-order effect is "we have not identified why" (`experiments.tex:774-787`).
- The W1 additions/time disagreement is "we have not identified the mechanism" (`experiments.tex:848-867`).

**M8 (comparisons within noise).** Fixed.
- The noise paragraph (`experiments.tex:316-344`) adds:
  - the W1 torus 256, W3 N=20 and W5a L=1e5;
  - the p99 CVs;
  - the interference test at the largest W2 size.
- It defines "within noise" by overlap of the per-seed ranges (`experiments.tex:342-344`).
- The comparisons the reviewer listed are now marked within or beyond noise:
  - E1: `experiments.tex:484-489`
  - E3: `experiments.tex:593-622`
  - E4: `experiments.tex:666-668`, `experiments.tex:670-671`
  - E5: `experiments.tex:702-709`
  - E6: `experiments.tex:774-787`
  - E7 W1: `experiments.tex:848-867`
  - E8: `experiments.tex:909-936`

**M9 (rebuild effect; "pays off when the basis grows").** Fixed.
- E7 reports the effect after the first rebuild (`…AfterFirst`, `…AfterFirstTime`) alongside the 100-update window:
  - intro: `experiments.tex:804-809`
  - W3: `experiments.tex:827-846`
  - W1: `experiments.tex:848-867`
- On W1, rebuilds help the smaller surfaces and not the largest. The text cites `tab:rebuild-effect` for W1.
- The `fig:rebuild` caption (`experiments.tex:876-877`) says that E7 has no W1 instance and points to that table.
- New appendix Table `tab:rebuild-effect`: `appendix.tex:37-44`.
- The conclusion (`conclusion.tex:28-32`) replaces "pays off when the basis grows" with: rebuilding paid off on cavities, did not trigger on refinement and flag complexes, and on surfaces helped the smaller instances but not the largest.
- Discussion: `discussion.tex:41-51`.

**M10 (W5b level-8 p99).** Fixed. `experiments.tex:778-783` gives the p99 of `mmhm` and `mmhm-norb` at W5b level 8 as `\NumWFiveSphereLEightMmhm{,Norb}PNinetyNineOverFullId` times that of `full-id`, and the ratios for the insertion-order variants.

**M11 (E1 outlier).** Fixed with the rerun macros.
- `experiments.tex:508-520`: the run was slow only in its first 400 updates (per-block medians of the three seeds) and was not slower after update 800.
- The rerun produced identical Betti numbers, additions, nnz and footprints and was not slow. The pooled figures with the rerun are `…WithRerun`.
- The `fig:latency-s` caption (`experiments.tex:588`) marks the hollow `mmhm-norb` point at s = 8 as including the outlier.
- The `tab:full-amort` and `tab:full-p99` captions (`appendix.tex:46-50`, `appendix.tex:57-59`) note the same.
- Discussion: `discussion.tex:67`.

**M12 (erratum).** Owned by the theory author.

**M13 (novelty of Lemma 2).** The text part is fixed: "not new in substance" (`intro.tex:87`). Related work is the theory author's.

**M14 (reproducibility).** The text part is fixed.
- `conclusion.tex:43-48` keeps `% TODO(author): replace with repository URL` and points to:
  - `experiments/README.md`;
  - `experiments/results/WORKLOADS_MANIFEST.csv`, which holds the generator command and the SHA-256 of every workload instance.
- See also `experiments.tex:15-18`.
- Publishing the archive is for the author.

## MINOR (items in my files)

1. Fixed. `intro.tex:96-100` now reads "on which every toggle of one simplex costs ... Ω(n)"; see also `experiments.tex:240`.
8. Fixed. The Table 1 caption (`experiments.tex:61-67`) explains "Rebuilds" ("policy" is the rebuild policy) and "Exact".
9. Fixed. p99 claims cite `tab:summary,tab:full-p99`: `experiments.tex:494`, `experiments.tex:666-668`, `experiments.tex:722-728`, `experiments.tex:774-787`.
10. Generated tables (data side).
11. Fixed. E7 gives the number of settings at which `mmhm` beats `drb-id-rb` separately for W2 and W4 (`experiments.tex:811-825`) and for W3 (`experiments.tex:827-846`), as macros.
12. Fixed.
    - The first wrong update is the maximum over runs (`experiments.tex:421-423`).
    - W2 is quoted as `\NumLcrWTwoNFifteenSEightWrong` of `\NumLcrWTwoNFifteenSEightUpdates` (`experiments.tex:420`).
13. Fixed. `experiments.tex:626-627` reads "The basis grows over a W3 run (...; it also grows on W1, E5)", and E7 says "On the surfaces of W1, where the basis also grows" (`experiments.tex:804-809`).
14. Fixed.
    - `experiments.tex:522-533`: on W2 there is little to save, and on W4 `full-morse` performs more additions.
    - The extrapolation to v1's coreduction-only baseline is hedged ("a different implementation, we cannot say").
    - `discussion.tex:49`.
15. Fixed. `experiments.tex:346-353` says that only the per-update sum of footprints is logged and that a rebuild row sums the additions of the rebuild and of the edits. E8 uses the updates without a rebuild (`tab:e8` caption, `appendix.tex:52-55`).
16. Fixed. `experiments.tex:96-102` now says: "differences reflect mostly the algorithms; the remaining implementation differences are this history dependence and the index that `mmhm` maintains (E4)".
17. Fixed with the new data. `experiments.tex:331-341` reports interference at the largest W2 size and states that two concurrent timed runs at about 10^6 simplices were not measured.
18. Fixed. `nnz(R)+nnz(V)` per simplex is reported as a memory proxy: `discussion.tex:63-76`, `experiments.tex:505-506`.
19. Fixed. E5 (`experiments.tex:722-728`): the median of `mmhm` is `\NumWOneSphereLSevenMmhmSpeedupFullIdMed` times below `full-id`, its p99 is higher, and a heavy tail sets the average.
20. Partly done.
    - The erratum is its own section, listed in the outline (`intro.tex:134-140`).
    - Detail moved to the appendix.
    - Medians, the E7 grid, noise and per-seed ranges are no longer typeset. They stay in `paper/generated/` and `experiments/results/` (`appendix.tex:8-12`).
    - The title is unchanged: `intro.tex:53-54` says "It keeps the title because discrete Morse theory still has a role, though a smaller one". A new title is the author's call.
    - The abstract is rewritten around the claims.
21. Fixed. The F2 caption (`experiments.tex:543`) says that panel (d) omits the overlapping DRB bands. The F7 caption (`experiments.tex:947-948`) says that the W1 torus is not shown. `figures/README.md` is not mine.
22. The SPEC belongs to the theory side. The Case A tie rule is stated at `experiments.tex:35-36`.
23. `experiments.tex:15-18` is scoped to "Every measured number". The literals in `aggregate.py` and the erratum's counts are outside my files.
25. Fixed. `discussion.tex:5-15`: "Five workload families do not settle which properties of a workload decide the regime"; the W1 cost is marked as unexplained.
26. Fixed. `abstract.tex:15-16`: "in the order given by a collapse that declares critical cells of the highest dimension".

Items 2-7 and 24 are in the theory and erratum files.

## PENDING-ABLATION comments (for the follow-up pass)

The data for all three ablations landed (generated files, 08:17 UTC) while this round was running. The generated tables already show the new rows and columns:
- Table 3 (`tab:correctness`): an `lcr-rc` column, and `full-sorted` and `drb-rand` rows.
- `tab:summary`, `tab:full-amort` and `tab:full-p99`: `full-sorted` rows.
- `tab:drift`: `f-sorted` and `mmhm × full-sorted` columns.
- `tab_rand.tex` is not typeset.

The text does not yet define or report any of them. The comments mark where they go:
- **(a) lcr-rc:**
  - `abstract.tex:36-37`
  - `experiments.tex:137-139` (methods)
  - `experiments.tex:442-444` (E0)
  - `experiments.tex:454-455` (Table 3 caption)
- **(b) full-sorted:**
  - `experiments.tex:103-105` (methods)
  - `experiments.tex:534-535` (E1)
  - `experiments.tex:558-559` (`tab:summary` caption)
  - `experiments.tex:623-624` (E3)
  - `discussion.tex:57-58` (Baselines)
  - `appendix.tex:29-30` (`tab:drift` caption)
- **(c) drb-rand:**
  - `experiments.tex:905-907` (E8 build)
  - `discussion.tex:50-51` (Morse order discussion)
