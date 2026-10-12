# Version history of arXiv:2508.14429

**v1 (August 2025).** The paper proposed a localized update of a discrete-Morse
reduced boundary matrix and stated that the update maintains exact Betti
numbers.

**v2 (this source).** The exactness claim of v1's localized update is
withdrawn. That rule is not exact: it does not correct reduced columns that
absorbed a replaced or deleted column, and its affected set misses critical
columns whose Morse boundary changes through gradient paths. v2 uses a
different algorithm, the dynamic reduced basis, whose exactness is proved in
the paper. It also replaces v1's analysis and experiments.

The detailed erratum is kept as a separate document,
[`MMHM_v1_erratum.tex`](MMHM_v1_erratum.tex). It contains:

- the rule as v1 specified it;
- counterexamples that satisfy all of v1's safeguards;
- the inconsistency in v1's experiment P2;
- measured error rates of an ablation that isolates the first defect.

Build it with `latexmk -pdf main.tex && latexmk -pdf MMHM_v1_erratum.tex`.

Suggested arXiv "Comments" field for v2:

> v2: new algorithm (dynamic reduced basis) with proofs and new experiments.
> The exactness claim for the localized update of v1 is withdrawn; a detailed
> erratum is available from the author.
