# Response to REVIEW.md: theory, erratum, related work, references, reference/

The scope is the files owned by the theory author: `sections/theory.tex`,
`sections/erratum.tex`, `sections/related.tex`, `macros.tex`, `refs.bib`,
`REFERENCES_VERIFICATION.md`, `reference/` and SPEC notes. Line numbers refer
to the files after this revision. `reference/check_props.py` reports 0
failures (18.5 s). The full `main.tex` builds in a scratch copy with no
warnings, undefined references or overfull boxes.

## BLOCKING

**B3 (the E2 counterexample must refute v1 as specified).** Fixed.
- `erratum.tex:69` adds the paragraph "What counts as a counterexample". Each instance must pass every safeguard of v1:
  - at most 4 updates, so the periodic trigger (m = 32) does not fire;
  - ρ_t below τ = 0.30 at every update, with ρ_t defined as in v1 §2.2. The numerator is bounded from above by the most generous local reading: every cell that is critical before *or* after the update and lies in the closed star of an edited vertex, before or after the update. The denominator is the number of critical cells before the update.
  - gates disabled, as in v1's P2, because the gate preconditions fail on these complexes;
  - the row-set and rank clauses discussed for each instance.
- `erratum.tex:162`, Example "E2 on a graph", replaces L = 4. It uses two disjoint 8-cycles and deletes the matched edge {2,3} at t = 1.
  - ∂ᴹ{0,1} changes from 0 to {2}+{5}.
  - ρ₁ ≤ 1/4.
  - v1 reports (3,2); the truth is (2,1).
  - The general C_L statement now requires y to avoid both c and r. It notes that a second component (or padding) is needed only for ρ_t.
- `erratum.tex:187`, Example "E2 with a critical triangle", replaces the 3×3 torus. The 3×3 torus fails the standard: its ρ₁ bound is 0.80. The new instance is a 5×5 grid torus with a cone over the meridian.
  - Deleting {8,13,14} changes ∂ᴹ{1,2,7} from 0 to {8,13}.
  - ρ₁ ≤ 1/5.
  - v1 reports (1,2,1); the truth is (1,1,0).
- `erratum.tex:208` states that the 4-cycle and the 3×3 torus have ρ₁ ≥ τ and are illustrations only.
- `erratum.tex:101`, Example "E1 for version 1 as specified", makes E1 meet the same standard.
  - K₀ is 20 isolated vertices, followed by the updates +01, +02, +12, −01.
  - ρ_t ≤ 0.15, 0.24, 0.27, 0.26.
  - v1 reports (19,1); the truth is (18,0).
  - It fails for all 6 row orders.
- Checks are in `reference/check_props.py`, new check (f):
  - `v1_rho` (l.728), `v1_e1_instance` (l.744), `v1_e2_instance` (l.788) and `v1_rho_of_deletion` (l.817), which asserts that the old small instances have ρ ≥ τ;
  - the run section is at l.994.
- Recorded in `reference/README.md:134` (section (f)) and `reference/README.md:129` (old instances marked as illustrations), and in `reference/counterexamples.json` under `v1_faithful`.

**B1 (erratum part: "could not reveal").** Fixed.
- `erratum.tex:238`, the paragraph is now "What the experiments of version 1 checked".
- P1 and P3 have Betti traces in v1. These are connected surfaces that gate-type formulas answer without algebra, and v1 does not say whether its gates were enabled.
- For P2, v1 reports no Betti numbers and compares with no independent computation.
- Such a comparison would have exposed E1 despite constant Betti numbers. The paragraph shows this with `\NumLcrWTwoNFifteenSEightFirstWrong`, `\cref{sec:e0}` and `\cref{tab:correctness}`.
- The "could not reveal" claim is removed. The writer still has to delete it in `intro.tex`.

## MAJOR

**M1 (`lcr` is an ablation).**
- `erratum.tex:214`, new paragraph "The ablation lcr".
  - `lcr` isolates E1. It forms no Morse complex, never recompresses and has no gates.
  - Its error rates measure E1, not v1.
  - On W1, gates of v1's kind would be exact.
  - Recompression would restore correctness every m updates.
  - No quantitative claim is made about v1 itself.
- The abstract, introduction and conclusion wording is the writer's job.

**M6 (cost model versus the engine).**
- `theory.tex:494–557` is rewritten. Proposition 3 (`theory.tex:507`) now gives the cost in two models:
  - the ordered-set model (as before);
  - the sorted-array model the engine implements. Each merge pays for the target too: Case A costs Θ(Σ_{j∈O}(1+|V_j|+|V_z|)), Case B costs Θ(Σ_{j∈O}(1+|R_j|+|V_j|+|R_p|+|V_p|)), and an insertion costs Θ(Σ(|R^{(i)}|+|V^{(i)}|+|R_p|+|V_p|)).
- `theory.tex:543` states the engine's hybrid: its heap mode brings insertions to the ordered-set bound up to a log factor, while its deletions pay merge cost.
- The same paragraph states what is logged: the number of column additions, the sum of the footprints, and nnz. It calls these proxies (counts of terms, not chain sizes) that need not track time.
- The upper bound in Proposition 4(c) is restricted to the ordered-set model (`theory.tex:577`).
- SPEC §2 cost line (`SPEC.md:113`) is updated to match.
- The writer should change `experiments.tex:297–298` ("These are the quantities of Proposition 3").

**M12 (v1's other clauses; empty matching).**
- `erratum.tex:57` quotes v1 verbatim: the §2.3 row clause ("If the update inserts or deletes (k−1)-simplices…") and the §2.5 "recompute r_k" and "localized reducer" sentences.
- Row clause:
  - E1 (`erratum.tex:120`): no vertex is inserted or deleted and no critical status changes, so neither the literal nor a broad reading applies.
  - E2 (`erratum.tex:156` and both examples): under the broad reading the new critical row re-initialises the pivot map, which leaves the stale stored column unchanged.
- "Recompute r_k": `erratum.tex:81` acknowledges that if r_k is recomputed from scratch, E1 does not occur. That turns the step into a full rank computation, which v1 does not present as its localized reducer. E2 fails under all three readings because the stale column is never replaced.
- Empty matching (`erratum.tex:101`): justified as asked. K₀ is isolated vertices, so every matching on it is empty, and inserted cells stay critical because v1 gives no rule for matching them.

**M13 (novelty; Bauer–Roll; algebraic Morse theory).**
- New `refs.bib` entries were verified by WebSearch and logged in `REFERENCES_VERIFICATION.md` (extra-entries table and "Searched for" notes):
  - `bauer2024wrapping` (SoCG 2024, LIPIcs 293, 15:1–15:16, DOI checked), `refs.bib:272`;
  - `skoldberg2006morse` (Trans. AMS 358(1) 115–129), `refs.bib:284`;
  - `jollenbeck2009minimal` (Mem. AMS 197(923)), `refs.bib:294`.
  - The Bauer–Roll full text could not be fetched because arxiv.org and dagstuhl are unreachable from here. It is cited only for the claim the search results support, with no proposition number.
- `theory.tex:330`: the proof of Lemma 2(c) is now the one-line folklore argument: τ and σ are adjacent in a filtration order, hence an apparent pair.
- `theory.tex:459`: the remark "Relation to known results" now says Lemma 2 "is not new in substance". It cites Ripser (apparent pairs form a gradient) and Bauer–Roll, and presents Lemma 2 as a self-contained version in the form needed for Corollaries 2.1–2.2.
- `theory.tex:476`: Sköldberg and Jöllenbeck–Welker are cited where algebraic Morse theory is invoked.
- `related.tex:32`: algebraic Morse theory sentence added. `related.tex:54`: "the converse of Ripser's observation" is replaced by the accurate statement, and the contribution is located in Corollaries 2.1–2.2.
- `related.tex:135`: "the stored basis stays sparse" is softened to "chosen in the hope of a sparser stored basis; its measured effect is mixed (§E8)". This also bears on M3.

## MINOR (theory and erratum files)

1. **Every toggle of σ.** `theory.tex:581`: "every toggle of σ … Other updates of size one, such as inserting a pendant edge, can of course be cheap".
2. **Vertex claims; "Corollary 1.1".** The vertex claims are moved out of Theorem 1(d) into the text at `theory.tex:206`. Corollary 1.1 is now Proposition 1.1 (`theory.tex:223`), a new `subproposition` environment numbered after Theorem 1 (`macros.tex:22`, with cleveref names). The label `cor:rebuild` is unchanged.
3. **"Hash sets with a separately maintained maximum".** Removed; the storage models are now explicit (`theory.tex:494`).
4. **Notation and counters.**
   - The gradient partner is now μ(x), not V(x) (`theory.tex:285` and all uses; `erratum.tex` E2 example).
   - Observations, definitions, examples and remarks now share one counter numbered within the section (Remark 3.5, Example 4.3; `macros.tex:24–29`). They no longer collide with Theorem 1, Lemma 2 and Propositions 3–4.
5. **ρ_t for every update.** `erratum.tex:120` states ρ_t for every update (t is v1's index, not a dimension).
6. **P2 sizes.** `erratum.tex:230`: "|K_t| is bounded and returns to |K_0| after every coarsening".
7. **"Equivalent formulas".** `theory.tex:637`: v1's gates "use equivalent formulas (for β₁, the number of boundary components or a tree–cotree test instead of χ)".
8. **Erratum as its own section.** It is now `\section` (`erratum.tex:19`).
9. **SPEC drift.**
   - Keys: 32-bit in the engine (`SPEC.md:63`).
   - Case A tie rule: smallest slot id, in SPEC (`SPEC.md:95`) and paper (`theory.tex:109`).
   - Case A cost: both models (`SPEC.md:113`).
   - A SPEC note on the new Lemma 2(c) proof is at `SPEC.md:167`.
10. **Typed-by-hand numbers.** `check_props.py --write-tex` (`write_tex`, l.897) writes `reference/check_props_numbers.tex`. The erratum `\input`s it, with visible `??` fallbacks, and uses its macros for the enumeration counts and the ρ bounds. The ρ values of the individual E1 updates and the small Betti vectors are still typed in the example text; they are recorded in `counterexamples.json`.
11. **Lemma 2(e) without clearing.** `theory.tex:242`: Proposition 1.1 now covers the reduction without clearing.

## Not handled here (other owners)
- B1 in `intro.tex:43–45` (delete the "because … constant" clause).
- B2, M2–M5, M7–M11 and M14.
- The abstract, introduction and conclusion parts of M1.
- `experiments.tex:297–298` for M6.
- Minor items 8–21, 23 (aggregate macros) and 26.
- `engine/README.md` and `figures/README.md` refer to "Lemma 2", "Corollary 2.1/2.2" and "Proposition 4". These numbers are unchanged, so no edit is needed. "Corollary 1.1" became Proposition 1.1, but no other file cites it by number.
