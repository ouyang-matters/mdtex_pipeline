# Referee report: MMHM v2 ("Morse-based Modular Homology for Evolving Simplicial Complexes", draft v2 of arXiv:2508.14429)

Reviewer role: adversarial referee and reproducibility auditor. Date: 2026-10-11.
Material reviewed: `paper/` (sources, the built `main.pdf` of 30 pages, `generated/`, `refs.bib`,
`REFERENCES_VERIFICATION.md`), `SPEC.md`, `engine/`, `reference/`, `workloads/`, `oracle/`,
`experiments/` (configs, scripts, raw per-run `*.csv.gz` / `*.betti.gz`), `figures/`, and the v1 PDF.
References below are `file:line` (sections are under `paper/sections/`) or PDF page `p.N`.

## Verdict

The mathematics holds up. I read Theorem 1, Corollary 1.1, Lemma 2, Corollaries 2.1–2.2,
Propositions 3–4 and Remark 5 line by line and found no error in the proofs. They have no hidden
dependence on the order, on which dimension's keys are used, on rows versus columns, on vertices,
on empty chains, on the clearing argument or on Case B's choice of the minimal low. I reran
`reference/check_props.py` and it reports 0 failures. The numbers are also sound: about 35
quantitative claims recomputed from the raw CSVs by an independent script all match the generated
macros. `aggregate.py` is deterministic and regenerates `numbers.tex`, every table and every
summary CSV byte for byte. The three figure scripts I ran regenerate byte-identical PDFs, and an
engine rerun reproduces every non-timing column exactly.

The paper is not ready, though. Three statements are false as written:

- **B1.** v1's experiments "could not reveal" its defects. The paper's own E0 data contradicts this.
- **B2.** "All 2,370,609 Betti vectors agree with three independent oracles." Only 52% were
  compared with three references, and the paper's third oracle covered only 8 samples.
- **B3.** The smallest E2 counterexample ($L=4$) triggers v1's own locality recompression under the
  paper's counting, so it is not a counterexample to v1 as v1 specified it.

Several framing problems also have to be fixed:

- The 83.1% error rate is attributed to "the rule of version 1", but it was measured on an ablation
  without v1's recompression, gates or Morse complex.
- The headline 90× speedup owes nothing to Morse theory or to rebuilds: insertion-order `drb-id`
  achieves the same.
- The Morse order buys no sparsity at build on W1, W2 and W4, and costs more additions on W4. This
  is unreported, and it undercuts contribution (ii).
- The static baseline's insertion order degrades over a W3 run.
- The comparison with gudhi mixes a 200-update prefix with full 2,000-update means (1,860× against
  948× on a matched prefix).
- Several mechanisms are stated as fact without measurement.
- Several method comparisons fall within the measured timing noise.

To its credit, the paper reports negative results unusually candidly and has excellent provenance.
**Recommendation: major revision.** Every BLOCKING item can be fixed with text changes or small
additional runs; none invalidates the core method.

## What I ran (reproducibility log)

All runs were done on scratch copies; no committed file was modified.

| check | result |
|---|---|
| `reference/check_props.py --write …` (copy) | 17.8 s, **0 failures**; E1/E2/Prop. 4 instances reproduced exactly as in `reference/README.md` |
| `experiments/aggregate.py` on a copy of `experiments/` + `paper/generated/` | `numbers.tex`, all 10 `tab_*.tex`, all `summary*.csv`, `NOT_RUN.csv` **byte-identical** |
| `experiments/verify.py` on the copy (needs the git-ignored `workloads/data/`; local copy symlinked) | `E0_correctness.csv`, `E0_lcr.csv` **byte-identical** |
| `figures/f2_*.py`, `f4_*.py`, `f6_*.py` on the copy | `F2`, `F4`, `F6` PDFs **byte-identical** |
| engine rerun `mmhm run --method {mmhm,drb-id}` on `w2_N7_s8_T2000_seed0.seq` | all non-timing columns (Betti, sizes, `chain_adds`, `nnz_*`, `footprint_sum`) identical over 2,001 rows; `.seq` SHA-256 matches its `meta.json`; timings differ (see M8) |
| own recomputation from raw `*.csv.gz` / `*.betti.gz` (numpy + csv only, no `aggregate.py`/`verify.py` code) | table at the end |
| `paper/main.log` | no warnings, no overfull boxes |
| WebSearch spot checks of the main attributions | see M13 and the related-work notes |

### How the paper defines its statistics, and whether `aggregate.py` implements them

- **Amortised latency** (`experiments.tex:274-276`): total processing time of all updates,
  rebuilds included, divided by their number. `aggregate.py:216-228` (`run_stats`) takes the mean of `time_ns`
  over rows with `t >= 1`, pooled over seeds. All runs have the same $T$, so this equals total
  divided by count. `time_ns` includes the rebuild: in `engine/src/main.cpp:250-256` the timer
  spans the edits plus `end_update(t)`, which performs the rebuild (`methods.cpp:86-104`).
  **Exact.** Note that v1's "amortized" included initialisation and v2's does not; say so once.
- **Median, p95, p99**: numpy median and percentiles (linear interpolation) of the per-update
  latencies, pooled over the three seeds (`aggregate.py:248-262`, `pooled`). **Exact.**
- **Speedup**: a ratio of pooled amortised latencies (`aggregate.py:318-326`). **Exact as
  documented**, but for `gudhi` the prefix mean ($T'=200$) is divided by the other method's mean
  over 2,000 updates. This is documented ("its own prefix"), but it is biased (see M5).
- **Slope**: `np.linalg.lstsq` of $\log_{10}$(pooled median, or amortised for E6) against
  $\log_{10} x$. Here $x$ is the mean $|K_0|$ for E1, E3, E4 and E5; $s$ for E2, which reuses E1's
  $s=8$ group; $L$ for W5a; and $n_2=20\cdot4^L$ for W5b (`aggregate.py:396-424`). The paper says
  "least-squares fits of log latency against log size". **Exact.** $R^2$ is generated but never
  reported.

---

## BLOCKING (false claims, wrong numbers, wrong mathematics)

**B1. "v1's experiments could not reveal either defect" is contradicted by the paper's own data.**
`intro.tex:43-45`, `erratum.tex:144-150` (p.2, p.12).
- **What is wrong.** The paper says: "P2 has the constant Betti numbers (1,0,0). None of the three
  experiments can therefore distinguish a correct update from an incorrect one." A workload with
  constant, known Betti numbers distinguishes a correct update from an incorrect one as soon as
  the outputs are compared with (1,0,0).
- **Evidence.** E0 runs `lcr` on W2, which is the P2 analogue: refinement and coarsening in a
  3-ball, Betti numbers constant (1,0,0,0). It is wrong after 5,999 of 6,000 updates, first at
  update 1, 1 and 2 (`results/E0_lcr.csv`; Table 3, p.17). The paper itself says
  (`experiments.tex:362-363`): "The Betti numbers of W2 are constant, so the errors there come from
  the algebra alone."
- **Further caveat.** For P1, v1 does not state that its gates were enabled. "Could not reveal"
  therefore also needs a source for P1.
- **Fix.** Replace the claim with what is true. P1 and P3 can be answered by v1's gates without any
  algebra. For P2, v1 never compared the reported Betti numbers with the known (1,0,0); v1 shows no
  Betti trace for P2. Delete the "because … constant" clause in the introduction.

**B2. "All 2,370,609 Betti vectors … agree with three independent oracles" is false.**
`intro.tex:97-98` (p.2); also implied by the "three independent oracles" wording in
`experiments.tex:302`.
- **The paper's three oracles** (Section 4.5) are the engine's `full-id`, GUDHI, and the
  pure-Python reference. The reference ran only on the 8 committed samples (9,218 checks).
- **Coverage, from my recount of the raw `.betti.gz` files:**
  - every one of the 2,370,609 vectors was compared with at least one reference, with 0 mismatches;
  - 2,118,483 were compared with engine `full-id`, 1,860,354 with the closed form and 1,870,083
    with GUDHI;
  - only **1,240,344 (52.3%)** were compared with all three of {`full-id`, closed form, GUDHI};
  - 42,021 (the W4 `gudhi` runs) were compared only with the engine's own `full-id`, which shares
    the parser and complex store.
- **Fix.** Say "each was compared with at least one, and 98.2% with at least one external (GUDHI or
  closed form)" and give the breakdown. The abstract (`abstract.tex:21-22`, "agreed with
  independent oracles") is acceptable only if `full-id` is called "engine-internal".

**B3. The "smallest case" of Example 8 (E2, $L=4$) is not a counterexample to v1 as v1 specified
it.** `erratum.tex:110-116` (p.12).
- **v1's trigger.** v1 recompresses whenever $\rho_t=\sum|R^C_k(t)|/\max(1,\sum|C^C_k(t)|)\ge\tau=0.3$
  (v1 §2.2).
- **The instance.** The collapse leaves exactly two critical cells, $c=\{0,1\}$ and $r=\{3\}$. The
  deleted matched edge $\{2,3\}$ contains $r$.
- **Under the paper's own counting it fails.** In the E1 example the paper counts the edited
  simplex and its facets (its bound $3/(6+N)$). The reference counts the same way
  (`check_props.py:656`: `modified = {y} | set(facets(y))`). Then $\rho_t=1/2\ge0.3$, v1 recompresses,
  and it returns the correct Betti numbers.
- **The general claim also needs a condition.** "When $y$ shares no vertex with $c$ … reports
  (2,1)" (`erratum.tex:110-112`) also needs $y\not\ni r$. For $L=4$ the only candidate edge always
  contains $r$, under either queue discipline.
- **The other examples survive.** The torus example (Example 9, $\rho_t=0$) and the cycle family
  with $y$ away from both $c$ and $r$ are not affected.
- **Unsure:** this depends on whether v1's $R^C_0$ includes a critical vertex whose row in $B_1$
  changes. v1's wording ("critical k-simplices whose column incidences change") admits both
  readings. The paper's own E1 arithmetic settles it against the $L=4$ instance.
- **Fix.** Use $L\ge6$ with $y$ disjoint from $c$ and $r$, or pad with $N\ge2$ isolated vertices
  ($\rho_t\le1/(2+N)<0.3$). State $\rho_t$ for every update of every example, as is already done
  (partly) for E1.

---

## MAJOR (overclaims, missing caveats, inconsistencies, under-reported results)

**M1. The 83.1% error rate describes an ablation, not "the rule of version 1".**
`abstract.tex:31-32`, `conclusion.tex:18-19`, `intro.tex:108-110`.
- **What `lcr` leaves out.** `lcr` is v1's column re-reduction applied to the full boundary
  matrices in the Morse order of $K_0$, with no Morse complex (so no E2), no recompression ($m=32$,
  $\rho_t\ge0.3$, validity trigger) and no gates (`experiments.tex:111-118`; `SPEC.md:206-209`).
- **Gates.** On W1 (2 of the 9 E0 instances, 22% of the E0 updates), v1's gates give correct Betti numbers by the paper's own
  Remark 5, so v1 as specified would be right there while `lcr` is wrong 99.3–99.5% of the time.
- **Errors are absorbing.** Once wrong, `lcr` stays wrong, so "% of updates wrong" mostly measures
  how early the first error comes (update 1–16).
- **The aggregate depends on the instance mix.** It includes W5a (0%, by construction:
  `experiments.tex:369-376`) and W5b (50%).
- **Fix.** In the abstract and conclusion, say "an ablation that applies v1's re-reduction rule
  without basis tracking (and without v1's recompression and gates)". Report the time to first
  error rather than a pooled percentage. If a v1-faithful rate is wanted, run `lcr` with periodic
  rebuilds ($m=32$); the engine currently ignores `--period` for `lcr`.

**M2. The headline speedup does not depend on Morse theory or on rebuilds; the framing credits
"the method".**
- **Where.** `abstract.tex:23-26`, `intro.tex:99-101`, `discussion.tex:8-10, 92-99`,
  `conclusion.tex:20-22`.
- **Evidence.** On W2 $N=33$ (Table 4, p.18) the four DRB variants are equal: speedups `drb-id`
  90.25, `drb-id-rb` 91.48, `mmhm-norb` 91.45, `mmhm` 90.17. No rebuild fired, and the
  insertion-order variant matches. On the largest W4, `mmhm-norb` (109×) beats `mmhm` (94.5×). On
  W5a $L=10^6$, `drb-id` (14.2 ms) beats `mmhm` (20.1 ms). On spheres with $L\ge6$, `mmhm-norb`
  beats `mmhm`. The named method `mmhm` is the best DRB variant only on W3 and on the smaller W1
  instances.
- **Fix.** Attribute the 90× to the dynamic reduced basis. State in the abstract that the Morse
  order and rebuilds matter measurably only on W3 (and small W1). Revisit the "When to use what"
  recommendation (`discussion.tex:92-99`), which recommends `mmhm` for workloads on which
  `mmhm-norb` or `drb-id` measured faster.

**M3. The Morse order produces no sparsity at build on W1, W2 and W4, and more additions on W4.
This is unreported and undercuts contribution (ii).**
- **Where.** `intro.tex:81-87` ("The Morse order as a sparsifier"), `discussion.tex:41-48`,
  `conclusion.tex:29-30`.
- **Evidence.** From the INIT rows ($t=0$) of seed 0, comparing `drb-id` with `mmhm-norb`:

  | instance | `nnz(R)+nnz(V)` after INIT | build additions |
  |---|---|---|
  | W2 $N=22$ | 1,082,490 vs 1,082,298 | 192 vs 0 |
  | W1 torus 256 | 1,246,451 vs 1,245,856 | 131,581 vs 131,751 |
  | W4 2D $n=16$k | 1,057,689 vs 1,038,963 | 397,030 vs **426,246** |
  | W4 3D $n=4$k $D=3$ | 380,392 vs 367,339 | 69,127 vs **77,624** |
  | W3 $N=20$ | 812,580 vs 812,580 | 0 vs 0 |
- **What this means.** Lemma 2 and Corollaries 2.1–2.2 are exactly about this build state.
  Empirically they buy nothing at build relative to the generators' (structured) insertion order,
  and on W4 the Morse order costs about 7–12% more additions. The only benefit shown is between
  rebuilds (E8), and it is mixed.
- **Fix.** Report the build-time additions and `nnz` under both orders (the data are already in the
  CSVs). Temper "sparsifier". Add a randomly permuted insertion order as an ablation, so that the
  insertion order is not a near-optimal, generator-supplied order (see M4).

**M4. The "insertion order" baselines are history-dependent, and `full-id` degrades during W3 runs.**
- **Where.** `experiments.tex:79-88`, `tab:methods`. The degradation is undisclosed.
- **Evidence.** On W3 $N=27$ seed 0, $|K|$ stays at about 524k, yet over 400-update blocks:
  - `full-id` additions per recomputation rise 14.9k → 35.7k → 46.9k → 51.5k → 56.3k;
  - its latency rises 9.4 → 14.6 → 18.2 → 20.7 → 22.9 ms;
  - `full-morse` stays at about 3.7–4.2k additions.

  Refilled cells receive late keys, so the static baseline's order gets worse over time. On W1, W2
  and W4 the `full-id` cost does not drift. The reported W3 speedups (1.9–9.5×) therefore partly
  measure order degradation in the baseline. A static recomputation in a canonical order (sorted by
  dimension and vertex tuple, as at INIT) would presumably run at the first-block cost.
  **Unsure** of the exact effect; a `full-sorted` baseline on W3 would settle it.
- **Fix.** Add a canonical-order static baseline, or at least disclose the drift and report W3
  speedups against the first-block cost.

**M5. The gudhi comparison mixes a 200-update prefix with full-run means; the "does not drift"
premise is false.**
- **Where.** `experiments.tex:405-407` (1,860×), `aggregate.py:20-23` (docstring: static baselines
  "do not drift"), Tables 4/6/8/10.
- **Evidence.**
  - W2 $N=33$: `mmhm` averages 324 µs over the first 200 updates but 165 µs over all 2,000 (warm-up),
    so gudhi/`mmhm` on matched prefixes is **948×**, not 1,860×.
  - W3 $N=27$: `full-id` averages 8.2 ms over the first 200 updates but 17.1 ms over 2,000. The
    `gudhi` entries for W3 (168,000 µs) therefore come from the cheap early part, and the
    `mmhm`/gudhi ratio is 160× on matched prefixes against 93× mismatched.
- **Fix.** Compare every method with gudhi on the same prefix, and say so in Section 4.4. Correct
  the docstring.

**M6. The cost model in Proposition 3 is not what the engine implements, and the recorded proxies
are not Proposition 3's quantities.**
- **Where.** `theory.tex:482-501`, `experiments.tex:25-29, 295-298`.
- **Model versus engine.** Proposition 3(b) charges Case A $\Theta(|O|(1+|V_z|))$ (chains as ordered
  sets). The engine stores chains as sorted arrays, so each $V_j\mathrel{\hat{}}=V_z$ is a merge
  costing $|V_j|+|V_z|$. `engine/README.md:163-166` says so: "Case A
  $\Sigma_{j\in O}(|V_j|+|V_z|)$ … merges, so the size of the target column counts too". Section
  4.1 claims Proposition 3's per-step cost only for the insertion heap mode.
- **Proxies.** The run logs record counts (`chain_adds`, $\sum|\mathrm{occ}|$, total `nnz`). Section
  4.4 says "These are the quantities of Proposition 3", but Proposition 3's cost is in terms of chain
  sizes ($|V_z|$, $|R_p|+|V_p|$), which are not logged.
- **Consequence.** Additions and time disagree in direction. On W1 torus 500, `drb-id-rb` performs
  fewer non-rebuild additions than `drb-id` (5.6M against 7.0M per run) but needs 27% more
  non-rebuild time (114.9 s against 90.2 s per run).
- **Fix.**
  - State the engine's actual deletion cost.
  - Either use ordered sets or restate Proposition 3 for sorted-array merges.
  - Log the summed sizes of the chains added.
  - Drop "these are the quantities of Proposition 3".

**M7. Mechanisms are stated as fact without measurement, especially on W1.**
- **W1 claim.** `experiments.tex:602-606` states: "the cost follows the fundamental 2-cycle, not the
  edit". The same claim is in `figures/README.md` (F2, F4), and a related one in
  `discussion.tex:97-98` ("Its cost follows the cycles that the edits create or destroy, not the
  size of the complex").
- **Evidence against it.**
  - Closing and reopening events are 38 of 2,000 updates (1.9%) and cannot drive the median.
  - On sphere $L=7$, seed 0, the `mmhm-norb` median per 250-update block is flat at 6.6–8.2 ms from
    the start. It does not grow with the closed-surface events.
  - The median update (about 61 edits, 838 additions, footprint 56) costs about 25% of a full
    recomputation, and the median slope is 0.80–1.01.
  - Something makes typical chains $\Theta(n)$ long (for example, the dense slots left by the first
    Case A deletion with $|V_z|=n_2$, or dense $V$ from the Morse build: `nnz_V` is 1.8M at $t=1$
    for $|K_0|=983$k). That is not shown.
- **Other unmeasured explanations.**
  - The E4 tuple index (`experiments.tex:556-561`). It is consistent with E7's `mmhm` "off/off"
    run on W4 (121 µs against `mmhm-norb` 110 µs); cite that run or a profile.
  - The E6 sentence "the complex has a single cycle, which every basis must store"
    (`experiments.tex:641-643`) does not explain why `mmhm` is 41% slower than `drb-id`. Your own
    `check_props` (e) measures 5.6–7.0·n elementary operations per toggle in the Morse order
    against 4.0·n in insertion order.
  - The E1 machine-outlier attribution (see M11).
- **Fix.** Measure the chain-size distribution per update on W1, or soften to "we conjecture".
  Remove "not the size of the complex" from `discussion.tex:97-98`.

**M8. Several comparisons fall within the timing noise, which is characterised on one instance only.**
- **The noise test.** The paper's noise test is 5 repetitions on W2 $N=22$ only (CV 7.1% / 4.1%,
  `experiments.tex:282-293`). It warns that smaller differences "should not be read as differences"
  and then reads several.
- **Evidence.**
  - W5a seeds are pure repetitions of one instance. Their amortised CV is 1.6–24% at $L=1000$
    (`full-id` 22%, `drb-id` 24%) and up to 7.7% at $L=10^4$; the median CV reaches 32%.
  - The p99 noise is never quantified, yet p99 comparisons carry several conclusions.
- **Comparisons within noise:**
  - "`mmhm` slower than `mmhm-norb` on spheres $L\ge6$" (+12% and +7%; at $L=7$ driven by seed 0:
    18.1 / 15.8 / 15.9 ms against 15.9 / 15.4 / 15.3 ms);
  - "every DRB method also has the lower p99" at W3 $N=27$ (`drb-id` 29.6k against 30.8k pooled;
    per seed `drb-id` 33.8k, 26.4k, 31.1k against `full-id` 30.0k, 27.8k, 32.4k, so seed 0 is
    reversed);
  - "`mmhm-norb` at least as fast as `drb-id` on every W4 instance" (W4 3D $n=1$k: 4.39 against
    4.33, 1.4%);
  - "the four DRB methods are indistinguishable on W2" while at $N=7$ the committed amortised
    values span 46.8–59.0 µs. My rerun of seed 0 gave `mmhm` 50.0 µs and `drb-id` 48.4 µs against
    the committed 56.1 and 40.4 µs. My rerun is in this review environment; I did not verify that it
    is the same hardware.
- **Fix.** Report seed-level ranges or bootstrap intervals for amortised latency and p99. Use the
  W5a repetitions to estimate noise across sizes. Drop or qualify claims whose differences are
  within that noise.

**M9. Rebuild-effect reporting is selective, and the conclusion contradicts the W1 results.**
- **Where.** `experiments.tex:659-664` (E7 intro: "On the large surfaces, rebuilds make the
  following updates more expensive"), `experiments.tex:693-707`, `conclusion.tex:28-29` ("pays off
  when the basis grows and costs time when it does not").
- **Evidence.**
  - The reported 100-update window ratio for `mmhm`/`mmhm-norb` exceeds 1 on 7 of 8 W1 instances
    (Table 7), including sphere $L=4$ (1.19) and tori 64 (1.07) and 128 (1.11). The text implies it
    does so only for $L\ge6$ and $n\ge256$.
  - Over all updates after the first rebuild, `aggregate.py` also computes `…AfterFirst`. For
    `mmhm` on spheres $L=6$ and $L=7$ it is 0.95 and 0.92: fewer additions than `mmhm-norb`.
  - On $L=7$, `mmhm`'s extra non-rebuild time over `mmhm-norb` is 1.7 s per run (5.6%). That is
    within noise and confounded by the tuple index `mmhm` always maintains (M7).
  - On W1 the basis grows (`nnz` grows ×1.8–2.5), yet Morse rebuilds lose on the largest
    instances. So "pays off when the basis grows" is contradicted by the paper's own data.
  - The sentence also cites Figure 6 and Table 11, which contain no W1 data.
- **Fix.**
  - Report both ratios.
  - Restrict the claims to what holds.
  - Fix the cross-references.
  - Rewrite the conclusion sentence.

**M10. A negative tail-latency result on W5b is under-reported.**
- **Where.** `experiments.tex:622-623` ("on the cycle graph their p99 is higher"),
  `discussion.tex:16`, `figures/README.md` (F6 row).
- **Evidence.** On W5b level 8 (the largest instance in the paper), the p99 of `mmhm` is 269,875 µs
  and of `mmhm-norb` 276,260 µs, against 239,549 µs for `full-id` (Table 10, p.29). At level 7 they
  are about equal (61–63k against 65k).
- **Fix.** State that at the largest W5b size the Morse-ordered variants also have a worse p99
  than recomputation.

**M11. The E1 outlier is described incorrectly and was not rerun.**
- **Where.** `experiments.tex:417-424`; Table 6, Table 10 and Figure 3(b) (p.20).
- **Evidence.** The claim is that the run "was slower throughout than the other two". The
  `mmhm-norb` $N=22$ seed-1 medians per 400-update block are 581, 157, 107, 112 and 115 µs, against
  about 117–126 µs for seeds 0 and 2. It was slow only during the first 400 updates and afterwards
  as fast or faster. The run takes 1.2 s of wall time. It also contaminates E2 (the bump at $s=8$
  for `mmhm-norb` in Figure 3(b)), and Figure 3's caption is silent about it.
- **Fix.** Rerun it (or all three seeds) and either replace it or keep it with an accurate
  description. Note it in the Figure 3 caption.

**M12. The erratum leaves v1's other clauses unaddressed and paraphrases v1 more broadly than v1
wrote.** `erratum.tex:36-38, 62-63, 89-117`.
- **Paraphrase.** The erratum writes "If the row set of $B^C_k$ changes, the pivot map is
  re-initialised". v1 wrote "If the update inserts or deletes (k−1)-simplices (thus changing the row
  set …)" (v1 §2.3). Under the erratum's own paraphrase the clause **fires** in E2: the partner $x$
  becomes a new critical row. The erratum argues the clause away only for E1. It should state that
  re-initialising the pivot map leaves the stale column $\partial^M c=0$ unchanged, so the error
  persists.
- **"Recompute r_k".** v1 §2.5 also says "recompute $r_k$ if … $R^C_k\ne\emptyset$". Read as a full
  rank recomputation of $B^C_k$, this avoids E1 (but not E2). Acknowledge that reading.
- **Empty matching.** "The empty matching is admissible in version 1" is weaker than needed. v1
  computes the matching by a Morse reduction at initialisation. The correct justification is that
  $K_0$ consists of isolated vertices (so any matching is empty) and, under the erratum's
  convention, inserted cells stay critical.

**M13. Novelty and related work: Lemma 2 is presented as "the converse" of Ripser's observation,
but closely related prior results are omitted.**
- **Where.** `theory.tex:455-457`, `related.tex:49-54`.
- **Prior results.** Bauer and Roll, "Wrapping Cycles in Delaunay Complexes" (SoCG 2024; arXiv
  2212.02345), show that for a (generalised) discrete Morse function the zero-persistence apparent
  pairs in the $f$-lexicographic order are exactly the gradient pairs of a refinement of the
  gradient. In other words, they give an order in which a given gradient's pairs are apparent. The
  Ripser paper also notes that special cases of the apparent-pairs construction appeared earlier.
  Your `REFERENCES_VERIFICATION.md` lists a Bauer–Roll paper as "verified but not needed".
- **Folklore.** Lemma 2 is close to folklore: a filtration built by elementary expansions has its
  expansion pairs as apparent pairs.
- **Algebraic Morse theory.** It is invoked (`theory.tex:463-467`) without citation (for example
  Sköldberg, Jöllenbeck–Welker, Kozlov).
- **Fix.** Cite these works and present Lemma 2 as a convenient, self-contained variant rather than
  "the converse".
- **Spot checks that passed.** Luo–Nelson (warm-start updates extend vineyards to insertions and
  deletions in a batch; cost in terms of the number of changes), Giunti–Lazovskis (SiRUP: updates
  $R$, $V$ and representatives under simplex removal, compatible with twist),
  Delfinado–Edelsbrunner ($O(n\alpha(n))$ incremental Betti numbers on $S^3$; positive/negative
  dichotomy), Ripser (apparent pairs: local condition; both persistence and gradient pairs) and
  Benedetti–Lutz (random free-face collapses, a critical facet when none is free; complexity of a
  triangulation measured by the resulting distribution) all match what the paper says. The
  Delfinado–Edelsbrunner complement and Euler mechanism rests on secondary sources, as your
  verification log itself notes.

**M14. Reproducibility outside this machine is not yet possible.**
- **No artifact.** `conclusion.tex:41-43` says "available from the author", with
  `% TODO(author): replace with repository URL`.
- **Workloads not committed.** The workloads (`workloads/data/`, 1.4 GB, including the
  `.expected.betti` closed forms) are git-ignored. The `.seq` SHA-256 values live only in the
  ignored `.meta.json`. The run manifests record neither the workload hash nor the engine commit.
- **Silent loss of checks.** `verify.py:129-137` silently records 0 closed-form comparisons when the
  data are missing. Following `generated/README.md` ("verify.py && aggregate.py") on a fresh clone
  therefore changes `\NumVerifiedStatesExpected` without failing.
- **Fix.**
  - Publish an archive.
  - Commit `seq_sha256` for every instance and the engine commit hash in the manifests.
  - Make `verify.py` fail when expected files are missing for W1, W2, W3 and W5.

---

## MINOR (presentation, precision, small inconsistencies)

1. `theory.tex:543-544`, `intro.tex:88-92`: "on these families every update of size $s_t=1$ costs
   … $\Omega(n)$". The proof covers toggles of $\sigma$ only. Other unit updates on $C_L$, such as
   inserting a new vertex or a pendant edge, cost $O(1)$. Say "every toggle of $\sigma$". The scope
   statement "this algorithm, not the problem" (`theory.tex:547-553`) is good.
2. `theory.tex:118-141`: Theorem 1 assumes $k\ge1$ but part (d) makes claims about vertices. Move
   the vertex statements to a remark. "Corollary 1.1" is proved independently of Theorem 1 apart
   from its last line; call it a Proposition or Lemma.
3. `theory.tex:484-485`: "hash sets with a separately maintained maximum … $O(\log n)$" is
   unjustified. Deleting the maximum needs a heap or ordered structure. Remove it or specify the
   structure.
4. Notation: $V(x)$ for the gradient partner (`theory.tex:279`) clashes with the chains $V_j$ and
   the matrix $V$. Definitions, Examples and Remarks share one counter, while Theorem, Lemma and
   Proposition share another, which yields "Remark 4" next to "Proposition 4" and "Remark 5". Use
   one counter or distinct names.
5. `erratum.tex:84`: $\rho_1$ is v1's $\rho_t$ at $t=1$, not the dimension-1 ratio. The bound
   $3/(6+N)$ covers only the final update; the edge insertions have $\rho_t\le2/(N+3)$. Both are
   below 0.3 for $N\ge5$; state both.
6. `erratum.tex:137`: "$|K_t|$ takes at most two values" holds only if every $R_t$ has the same size.
   v1 lets $s_t$ vary. Say "is bounded and returns to $|K_0|$ after each coarsening".
7. `theory.tex:597-598`: "The gates of version 1 are these formulas". v1's $\beta_1$ gate uses the
   number of boundary components or a tree–cotree test, not $\chi$. Say "equivalent formulas".
8. Table 1 (`experiments.tex:54-57`, p.13): the caption describes a "Policy" column, but the column
   is headed "Rebuilds", and the "Exact" column is not explained.
9. `experiments.tex:407-409`: the p99 values are attributed to Table 4, which lists p95. Cite
   Table 10.
10. Table 5 (`aggregate.py:605`) prints $|K_0|$ of seed 0 (for example 63,911), while every other
    table prints the mean over seeds (63,935).
11. `experiments.tex:686-688`: "`mmhm` has a lower amortised latency than `drb-id-rb` at every
    $(\alpha,m)$ of the grid" holds for W3 only. On W2 it holds at 2 of 18 grid points and on W4 at
    9 of 18. Say "on W3".
12. `experiments.tex:358-361`: "for the first time no later than update 5" is a minimum over runs.
    In 2 of the 21 W1–W4 runs (W4 2D, seed 2) the first wrong update is 16. Also, "100.0%" for W2
    is 5,999 of 6,000.
13. `experiments.tex:508`: "W3 is the workload on which the basis grows" conflicts with E5 (W1
    torus `nnz` ×2.46 for `drb-id`).
14. `experiments.tex:426-434` and `discussion.tex:47-48`: "the collapse … costs more than it saves".
    On W2 insertion order needs 192 additions per recomputation, so there is nothing to save; on W4
    `full-morse` performs more additions (427k against 397k). The extrapolation to v1's
    "coreduction-only" baseline concerns a different implementation; hedge it.
15. `experiments.tex:295-297`:
    - "records … the footprints $|\mathrm{occ}(\sigma)|$ of the deleted simplices": only the
      per-update sum is logged (as `PLAN.md` says).
    - "dynamic additions and those of rebuilds separately": in a rebuild row both are summed.
      `aggregate.py` drops those rows, losing that update's dynamic additions from E8.
16. `experiments.tex:86-88`: "differences reflect the algorithms rather than the implementations".
    `mmhm` maintains a tuple index that `mmhm-norb` does not (cost about 10–15% on W4), and
    `full-id`'s order is history-dependent (M4). Soften.
17. Interference (`experiments.tex:282-291`) was measured on a 286k-simplex instance while timed
    and untimed runs shared the machine. Instances of 1–4M simplices are more
    memory-bandwidth-bound; one repetition test at that size would close the gap.
18. Memory is not measured (`discussion.tex:58-60`), yet Section 5.2 recommends methods. You
    already log `nnz(R)+nnz(V)` (for example 3.6M entries against $|K|$ = 955k on W2 $N=33$);
    report it as a memory proxy. `engine/README.md` reports peak RSS.
19. Balance: on W1 the DRB medians are 4–5× below `full-id` (sphere $L=7$: 6,050 against
    29,100 µs, Table 8), while the amortised gain is at most 2.06×. The abstract and E5 give only the
    amortised figure; one sentence on the heavy tail would help the reader.
20. Length and structure:
    - 30 pages, 11 tables. Move Tables 6, 8, 10 and 11 to a supplement.
    - Make the erratum its own section instead of §3.6.
    - The abstract (about 330 words) is dense with numbers.
    - The title's "Modular" and the method name carry v1's framing; the Morse order is now a
      heuristic with a measured benefit only between rebuilds (M3). Consider a title that names the
      dynamic reduced basis.
    - The erratum's tone is factual and neutral; keep it.
21. Figures:
    - Figure 2(d): the IQR bands of four DRB methods overlap into one unreadable band; use a
      thinner band or omit it.
    - `figures/README.md` (F4 row) quotes seed means while Figure 4 plots seed 0.
    - Figure 7 omits the W1 torus that Table 9 includes; fine, but say so.
22. SPEC drift:
    - `SPEC.md:62` gives 64-bit keys; the engine and paper use 32-bit.
    - `SPEC.md:113-114` gives the Case A cost as $|O|\cdot|V_z|$, while `engine/README.md` gives
      merges $\sum(|V_j|+|V_z|)$.
    - Case A's tie rule (smallest slot id) is not stated in the paper.
23. "Every number … none is typed by hand" (`experiments.tex:14-16`):
    - `\NumUpdates`, `\NumPrefix`, `\NumSeeds` and `\NumGudhiFullLimit` are literals in
      `aggregate.py:723-728`, tagged `[configs/make_configs.py]`; read them from the configs.
    - The erratum's enumeration counts (1, 2, 5, 15, 61, 263, 1,250, 18) and the platform facts are
      typed by hand. That is acceptable, but have `check_props.py` emit them as macros.
24. `theory.tex:307-310` (Lemma 2(e), "without clearing") relies on $V$ being triangular for the
    plain reduction; Corollary 1.1 is stated with clearing. Add one line.
25. `discussion.tex:16-17`: "Which regime a workload is in is a property of its cycles, not of the
    size of its edits" generalises from five families; W1's typical updates create only small
    cycles yet cost $\Theta(n)$ (M7). Hedge.
26. `abstract.tex:14-18`: "if cells are ordered by reverse removal time in a collapse … it performs
    the reduction of the Morse complex". Corollary 2.2 needs the highest-dimension rule for critical
    cells; Definition 2 includes it, but the abstract's "in a collapse" is broader.

---

## Recomputed quantitative claims

All values below were recomputed from raw `experiments/results/E*/*.csv.gz` and `*.betti.gz`
(and `results/noise/*.csv.gz`) by my own script. It pools $t\ge1$ rows over the 3 seeds, computes
the amortised value as the mean, and fits slopes by numpy `polyfit` on $\log_{10}$. It shares no
code with `aggregate.py`. "✓" means the paper's value is reproduced to its printed precision.

| # | Claim (where) | Macro | Paper | Recomputed | Verdict |
|---|---|---|---|---|---|
| 1 | E1: `mmhm` speedup over `full-id`, W2 $N=33$ (abstract l.24–26; intro (iv); exp. l.402–405; disc.; concl.) | `\NumWTwoNThirtyThreeSEightMmhmSpeedupFullId` | 90.2 | 90.17 (14,894.5 / 165.17 µs) | ✓; but `drb-id` 90.25 (M2) |
| 2 | E1: `mmhm` and `full-id` amortised, W2 $N=33$ | `…MmhmAmort`, `…FullIdAmort` | 165 / 14,900 µs | 165.2 / 14,894.5 | ✓ |
| 3 | E1: speedup over gudhi "on its prefix" | `…MmhmSpeedupGudhi` | 1,860 | 1,858 as defined; **948** on matched first-200 prefix | ✓ as defined; biased (M5) |
| 4 | E1: p99 `mmhm` / `full-id` | `…MmhmPNinetyNine`, `…FullIdPNinetyNine` | 333 / 21,600 µs | 332.9 / 21,608.7 | ✓ (but cited to Table 4 = p95; minor 9) |
| 5 | E1: DRB median slopes vs $|K_0|$ (exp. l.394–399) | `\NumSlopeEOneWTwoSEight{Mmhm,DrbId}Med` | 0.24–0.27 | 0.240, 0.259, 0.265, 0.273 | ✓ |
| 6 | E1: `full-id` / gudhi / `full-morse` median slopes | `…{FullId,Gudhi,FullMorse}Med` | 1.04 / 1.06 / 1.14 | 1.039 / 1.057 / 1.142 | ✓ |
| 7 | E2: DRB median slope vs $s$ (exp. l.462–464) | `\NumSlopeETwoWTwoNTwentyTwo{DrbIdRb,Mmhm}Med` | 0.88–0.90 | 0.876 (drb-id-rb), 0.887, 0.901, 0.904 (mmhm) | ✓ |
| 8 | E2: `full-id` / `full-morse` slope | `…{FullId,FullMorse}Med` | 0.06 / 0.07 | 0.062 / 0.070 | ✓ |
| 9 | E2: speedups at $s=64$ | `\NumWTwoNTwentyTwoSSixtyFour{Mmhm,DrbIdRb}SpeedupFullId` | 4.80–5.85 | 4.800, 5.259, 5.461, 5.850 | ✓ |
| 10 | E3: `mmhm` speedup, W3 $N=27$ | `\NumWThreeNTwentySevenMmhmSpeedupFullId` | 9.46 | 9.463 | ✓; baseline drifts (M4) |
| 11 | E3 $N=14$: `mmhm` / `full-id` / `drb-id` / `mmhm-norb` amortised | `\NumWThreeNFourteen…Amort` | 1,230 / 2,320 / 3,180 / 2,600 | 1,235 / 2,316 / 3,180 / 2,601 | ✓ |
| 12 | E4: speedups at $n=16$k (`mmhm`, `mmhm-norb`) | `\NumWFourPlaneNSixteenThousandDTwo{Mmhm,MmhmNorb}SpeedupFullId` | 94.5 / 109 | 94.47 / 109.22 | ✓ |
| 13 | E4: median slopes, square $D=2$ | `\NumSlopeEFourWFourPlaneDTwo…Med` | 0.02–0.15 vs 0.97 | 0.022–0.150 vs 0.968 | ✓ |
| 14 | E4: speedup ranges at $n=1000$ / $n\ge4000$ | (4 macros) | 3.72–7.64 / 12.2–109 | 3.72–7.64 / 12.25–109.2 | ✓ |
| 15 | E5: max W1 speedup, surface (abstract l.27–28; exp. l.576–577) | `\NumWOneSphereLFiveMmhmSpeedupFullId` | 2.06 | 2.063 = max over 8 W1 instances × 4 DRB variants | ✓ |
| 16 | E5: sphere $L=7$: `full-id`, `drb-id`, `drb-id-rb` amortised; `mmhm-norb`, `mmhm` speedups | `\NumWOneSphereLSeven…` | 30,700 / 37,100 / 39,200; 1.98 / 1.85 | 30,669 / 37,100 / 39,224; 1.975 / 1.849 | ✓ |
| 17 | E5: torus 500 speedups `drb-id` / `drb-id-rb` / `mmhm` / `mmhm-norb` | `\NumWOneTorusFiveHundred…SpeedupFullId` | 0.848 / 0.663 / 1.13 / 1.14 | 0.848 / 0.663 / 1.125 / 1.144 | ✓ |
| 18 | E5: sphere median slopes (DRB vs `full-id`) | `\NumSlopeEFiveWOneSphere…Med` | 0.80–1.01 vs 1.02 | 0.801–1.007 vs 1.023 | ✓ |
| 19 | E5: `euler` amortised range; ×`full-id` at $L=7$ | `…EulerAmort`, `…EulerSpeedupFullId` | 10.5–30.1 µs; 1,040 | 10.5–30.1; 1,038 | ✓ |
| 20 | E5: `nnz` growth, torus 500 | `\NumWOneTorusFiveHundred{DrbId,MmhmNorb}NnzGrowth` | 2.46 / 1.84 | 2.464 / 1.837 | ✓ |
| 21 | E5: closed states on sphere $L=7$ | `\NumWOneSphereLSevenClosedStates` | 38.0 | 38.0 (29, 35, 50) | ✓ |
| 22 | E6: W5a amortised slopes (DRB; `full-id`) | `\NumSlopeESixWFiveCycle…Amort` | 1.06–1.10; 1.05 | 1.063–1.098; 1.054 | ✓ |
| 23 | E6: W5b amortised slopes (DRB; `full-id`; `euler`) | `\NumSlopeESixWFiveSphere…Amort` | 1.10–1.16; 1.05; 0.14 | 1.104–1.164; 1.048; 0.139 | ✓ |
| 24 | E6: $L=10^6$ amortised `drb-id` / `mmhm` / `full-id`; p99 `mmhm` vs `full-id` | `\NumWFiveCycleLOneMillion…` | 14,200 / 20,100 / 36,300; 101,000 vs 48,100 | 14,237 / 20,086 / 36,264; 100,518 vs 48,091 | ✓ |
| 25 | E7 (rebuild comparison) W3: `mmhm` $\alpha=1$ vs never; `drb-id-rb` likewise; `mmhm` p99 | `\NumESevenWThreeNTwenty…` | 1,580 vs 3,830; 2,220 vs 6,440; 26,600 → 6,710 | 1,582 vs 3,834; 2,218 vs 6,436; 26,649 → 6,707 | ✓ |
| 26 | E7 W2: `mmhm` 123 → 265 ($m=256$) → 654 ($m=64$); `drb-id-rb` 432 at $m=64$ | `\NumESevenWTwoNTwentyTwoSEight…` | as stated | 123 / 265 / 654; 432 | ✓ |
| 27 | E7 rebuild-effect window ratios (W3: `mmhm`, `drb-id-rb`; W1: `mmhm` range; spheres: `drb-id-rb`) | `\NumRebuildEffect…Window` | 0.82 / 0.72; 1.36–2.52; 1.31 / 2.44 | identical (own window computation) | ✓; the "after first" ratios (0.95, 0.92 on spheres) are omitted (M9) |
| 28 | E0: `lcr` overall error rate (abstract l.31–32; concl.) | `\NumLcrErrAll` | 83.1% | 83.09% (44,870 / 54,000, from raw `mismatch` flags) | ✓ number; misattributed (M1) |
| 29 | E0: `lcr` per-instance range on W1–W4; W5b; W5a | `\NumLcr…ErrPct` | 99.3–100.0; 50.0; 0.0 | 99.28–99.98; 50.00; 0.00 | ✓ |
| 30 | E0: first wrong update "no later than 5" | `\NumLcrWFourPlaneNFourThousandDTwoFirstWrong` | 5 | min over seeds 5; per run up to **16** | ✓ as min; misleading (minor 12) |
| 31 | E0: reported Betti vectors; mismatches | `\NumReportedStates`, `\NumExactMismatches` | 2,370,609; 0 | 2,370,609; 0 (own recount from `.betti.gz`) | ✓ |
| 32 | E0: vectors compared with `full-id` / closed form / GUDHI | `\NumVerifiedStates{,Expected,Gudhi}` | 2,118,483 / 1,860,354 / 1,870,083 | identical | ✓ |
| 33 | intro (iv): "agree with three independent oracles" | — | all 2,370,609 | all three: **1,240,344 (52.3%)**; at least one external: 2,328,588 (98.2%) | ✗ (B2) |
| 34 | Noise: CV of median, `mmhm` / `full-id` (exp. l.284–286; disc. l.52–54) | `\NumNoiseCV{Mmhm,FullId}Med` | 7.1% / 4.1% | 7.14% / 4.10% (5 repetitions, raw CSVs) | ✓ |
| 35 | Noise: CV of amortised; interference shifts | `\NumNoiseCV…Amort`, `\NumNoise…Pct` | 8.4 / 4.5; −2.3, +0.3, −3.6, +1.5 | 8.36 / 4.54; −2.32, +0.25, −3.56, +1.48 | ✓ |
| 36 | E3 $N=20$: `nnz` start / end (`drb-id`, `mmhm-norb`); rebuilds; end values | `\NumWThreeNTwenty…` | 812,580 → 4,505,833 / 3,734,680; 6.0 / 10; 1,483,381 / 1,667,205 | identical | ✓ |
| 37 | E8 W4: p99 additions; median footprint (`drb-id` → `mmhm-norb`) | `\NumEEightWFourPlane…` | 2,130 → 1,130; 204 → 60.0 | 2,134 → 1,131; 204 → 60 | ✓ |
| 38 | E8 W2: p99 additions; median footprint; median additions; p99 footprint | `\NumEEightWTwo…` | 1,420 → 1,050; 118 → 88.5; 156 → 166; 228 → 259 | 1,422 → 1,047; 117.5 → 88.5; 156 → 166.5 (printed 166 by round-half-even); 228 → 259 | ✓ |
| 39 | `full-morse` / `full-id` range | `…FullMorseOverFullId` | 1.09–4.22 | 1.089 (W1 $L=4$) – 4.218 (W2 $N=33$) | ✓ |
| 40 | W4 $\beta_D/n$ range | `\NumWFourBetaDRatio{Min,Max}` | 2.8–6.2 | 2.835–6.173 | ✓ |
| 41 | E1 outlier: `mmhm-norb` amortised / p99 vs `mmhm`, $N=22$ | `\NumWTwoNTwentyTwoSEight…` | 171 / 1,230 vs 128 / 253 | 170.6 / 1,229.6 vs 127.8 / 253.3 | ✓ numbers; "slower throughout" ✗ (M11) |

Bottom line on the numbers: no macro value is wrong. The errors are in what some numbers are said
to mean (rows 3, 28, 30, 33 and 41) and in comparisons that fall within noise (M8).
