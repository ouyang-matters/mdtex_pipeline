# figures/ — result figures of the paper

Each `fN_*.py` and `fm_*.py` reads only committed files under
`experiments/results/` (written by `experiments/run.py` +
`experiments/aggregate.py`) and writes `FN_*.pdf` or `FMN_*.pdf` (vector, fonts
embedded, 6.3 in wide). Regenerate all:

```sh
cd research/mmhm/figures
for f in f*.py; do python3 "$f"; done
```

`style.py` fixes one colour and one marker per method in every figure: `mmhm`
blue ●, `drb-id` orange ▲, `mmhm-norb` aqua ⬢, `drb-id-rb` yellow ▼, `full-id`
magenta ■, `full-morse` green ◆, `gudhi` violet ✚, `euler` red ✖ (the 8-slot
categorical palette, checked for colour-vision deficiency; markers are the
secondary encoding). Latencies are per update in µs, pooled over seeds 0–2
unless a caption says otherwise. A hollow marker means the baseline ran the
prefix T′ = 200 instead of T = 2000 (only `gudhi` above 3e5 simplices). If any
configured run is missing, the figure prints a footnote naming it from
`experiments/results/NOT_RUN.csv`. In this sweep all 1,236 configured runs
finished, so there are no footnotes.

The three schematic figures are TikZ in the paper source (`paper/figures/`),
not here: Figure 1 `f1_method.tex` (the five parts of the method), Figure 2
`f2_deletion.tex` (the two deletion cases worked on graphs) and Figure 3
`f3_morse.tex` (collapse, Morse order, apparent pairs, reduction of the
critical column). Every entry of Figures 2 and 3 is recomputed and checked by
`reference/figure_examples.py`.

| figure | data source | takeaway (true for the committed data) |
|---|---|---|
| `F2_latency_vs_size.pdf` — median per-update latency (IQR band) vs \|K₀\|, log–log; (a) W2 s = 8 (E1), (b) W3 (E3), (c) W4 2D D = 2 (E4), (d) W1 sphere (E5). `full-sorted` (static, canonical order) is the dashed line with hollow squares in `full-id`'s colour | `results/summary.csv`, `summary_slopes.csv` | On W2 and W4 the four DRB methods stay near-flat in \|K₀\| while the static baselines grow linearly. W2: slope 0.24–0.27 vs 1.04 (`full-id`), 1.14 (`full-morse`), 1.06 (`gudhi`), 5 sizes; at 9.6e5 simplices `mmhm` takes 165 µs amortized, 90× less than `full-id` and 1,860× less than `gudhi`. W3: the DRB costs 0.9–3.5 ms median and grows slowly (3 sizes, indicative). On W1 the DRB median grows about linearly, like `full-id` (slope 0.80–1.01). The mechanism is not measured: closing events are only about 2% of updates, so they do not by themselves set the median. Panel (d) omits the DRB IQR bands, which overlap into one band; their p95/p99 are in the tables. In amortized terms at L = 7 (9.8e5 simplices), the insertion-order DRB (`drb-id` 37 ms, `drb-id-rb` 39 ms) is slower than `full-id` (31 ms), and the Morse-order DRB is 1.8–2.0× faster (`mmhm-norb` 15.5 ms, `mmhm` 16.6 ms). `euler` takes 9–32 µs. `full-morse` is 1.1–4.2× slower than `full-id` everywhere: the collapse costs more than the additions it saves. `full-sorted` (canonical order, no history) is within ±30% of `full-id` (amortized) on every W1, W2 and W4 instance. On W3 it is faster than `full-id` at N = 20 and 27 (5.2 vs 7.2 ms and 10.8 vs 17.1 ms amortized), because part of `full-id`'s growth there comes from its degrading insertion order; `full-sorted` still drifts ×1.44–1.84 over a W3 run as the cavities change the complex. |
| `F3_latency_vs_edit_size.pdf` — E2 (W2, N = 22, s = 1…64): (a) median per-update latency vs s, (b) amortized latency per atomic edit. The hollow `mmhm-norb` point at s = 8 in (b) includes the seed-1 timing outlier of E1; × is the same point with seed 1 replaced by its single rerun | `results/summary.csv`, `results/rerun/` | At fixed \|K\| ≈ 2.9e5 the DRB cost grows roughly linearly with the edit size: median slope 0.88–0.90 (7 values of s), from ≈ 20 µs at s = 1 (16 edits) to 0.72–0.88 ms at s = 64 (1,024 edits). Per atomic edit it stays at 0.8–1.8 µs amortized. The static baselines barely depend on s (slope 0.06–0.07): `full-id` 3.5–4.7 ms and `full-morse` 10.7–14.8 ms amortized. |
| `F4_time_series.pdf` — seed 0 only: latency (mean of the last 50 updates, top), nnz(R)+nnz(V) (bottom), rebuilds of `mmhm` and `drb-id-rb` as thin vertical lines through both rows; W2 N = 22, W3 N = 20, W1 torus 256² | `results/E1,E3,E5/*__seed0.csv.gz`, W1 `full-id` Betti file | Seed-0 values throughout. W2: nnz stays at 1.08 M and latency stays flat for all four DRB methods; no rebuild fires. W3: without rebuilds nnz grows from 0.81 M to 4.16 M (`drb-id`) and 3.64 M (`mmhm-norb`) over 2,000 updates, and latency rises with it. The rebuilding variants follow a sawtooth (6 rebuilds for `mmhm`, 10 for `drb-id-rb`) and end at 1.49 M and 1.65 M. W1: nnz of the never-rebuilt methods grows steadily (1.25 M → 4.41 M `drb-id`, 3.11 M `mmhm-norb`) while holes repeatedly close and reopen (grey rug). Why typical W1 updates are Θ(n) is not measured here (the engine does not log chain sizes); the figure shows only that nnz grows. |
| `F6_nonlocality.pdf` — E6: amortised latency per toggle vs cycle length L (W5a) and triangles n₂ (W5b), with least-squares slopes and a dotted guide of slope 1 | `results/summary.csv`, `summary_slopes.csv` | As Proposition 4 predicts, every DRB method is linear in the size of the toggled cycle: slope 1.06–1.10 on W5a (7 sizes, 1e3–1e6) and 1.10–1.16 on W5b (6 sizes, n₂ = 1.3e3–1.3e6). It stays below `full-id` by a constant factor (W5a at L = 1e6: `drb-id` 14 ms, `mmhm` 20 ms, `full-id` 36 ms; W5b at n₂ = 1.3e6: 21–29 ms vs 178 ms). Its p99 is worse than `full-id`'s on W5a (100 ms vs 48 ms at L = 1e6, `mmhm`). Only `euler` is size-independent (≤ 0.3 µs, slope 0.14). |
| `F7_rebuild_sensitivity.pdf` — E7: amortized (top) and p99 (bottom) latency vs growth trigger α, per period, `mmhm` vs `drb-id-rb` | `results/summary_e7.csv` | Rebuilding helps only where the basis actually grows. On W2 and W4 the α trigger essentially never fired: one rebuild in one seed (W4, `mmhm`, α = 0.25) over all α ≥ 0.25. Periodic rebuilds only added cost there: period 64 raised amortized latency from ≈ 120 µs to 0.41–1.5 ms, and the Morse rebuild (collapse included) costs more than the insertion-order one. On W3, rebuilding by the growth trigger cut amortized latency 2.4× for `mmhm` (1.58 ms at α = 1 vs 3.83 ms never) and 2.9× for `drb-id-rb` (2.22 vs 6.44 ms), and p99 from 26.6 ms to 6.7 ms (`mmhm`). On W3, `mmhm` beats `drb-id-rb` in amortized latency at all 18 (α, period) settings; on W2 at 2 of 18 and on W4 at 8 of 18. E7 has no W1 instance; rebuild effects on W1 under the default policy are in `tab_rebuild_effect.tex`. |

Related tables (`paper/generated/`): `tab_e7.tex` (the E7 grid with rebuild
counts), `tab_e8.tex` (E8 quantiles), `tab_rebuild_effect.tex` (whether a
rebuild makes the following updates cheaper or costlier, per instance).

## Main-text figures (paper revision of 2026-10-12)

Figure numbers are those of `paper/main.pdf`.

| figure | file | script | data | takeaway |
|---|---|---|---|---|
| 4 | `FM1_scaling.pdf` | `fm_scaling.py` | `results/summary.csv` (E1, E2, E3, E4) | On W2, W3 and W4 the median latency of every DRB variant grows far more slowly with $|K_0|$ than static recomputation. On W2 it grows linearly with the edit size $s$, and at $s=64$ it is still below recomputation. |
| 5 | `FM2_basis_and_rebuilds.pdf` | `fm_mechanism.py` (the first two columns of `f4_time_series.py`) | `results/E1`, `results/E3`, seed 0 | On W2, nnz(R)+nnz(V) is flat and no rebuild fires. On W3 it grows without rebuilds, and every growth-triggered rebuild (vertical line) coincides with a drop of nnz. |
| 6 | `FM3_cost_proxies.pdf` | `fm_cost_proxies.py` | `results/E1,E3,E4/*.csv.gz` (non-rebuild updates, seeds 0–2) | Top two rows: CCDFs of the footprint and of the column additions per update (formerly F5 in the supplement). Without rebuilds the Morse order shortens the tail of the additions on W2, W3 and W4 (p99 1,047 vs 1,422; 30,887 vs 34,006; 1,131 vs 2,134) and of the footprints on W3 and W4; with rebuilds on W3 `drb-id-rb` has the lighter tails. Bottom row: latency against additions (binned median and IQR). Spearman ρ over the four variants: W4 0.90–0.95, W2 0.63–0.85, W3 0.46–0.53 (also `\NumMainRhoAdds…`, written by `experiments/main_tables.py`). On W3, at equal additions, each rebuilding variant is faster than its counterpart without rebuilds in every common bin (median ratio 0.32–0.81). |
| 7 | `FM4_rebuild_policy.pdf` | `fm_rebuild_policy.py` | `results/summary_e7.csv` (W3 N = 20), `summary.csv` (E3 `full-sorted`) | Amortised and p99 latency against rebuilds per run, growth trigger α = never…0.25 and periodic-only points. The first few rebuilds remove most of the excess (`mmhm` 3.83 → 1.58 ms at α = 1, 6 rebuilds; `drb-id-rb` 6.44 → 2.22 ms, 10 rebuilds). Beyond about ten per run the amortised latency changes little (`mmhm` rises to 1.96 ms with period 64). Above 20 rebuilds per run (1% of the updates) the p99 is the cost of a rebuild: 40.3 ms for `mmhm` at α = 0.25 against 6.7 ms at the default and 9.7 ms for `full-sorted`. The full sweep is F7. |
| 8 | `F6_nonlocality.pdf` | `f6_nonlocality.py` | `results/summary.csv` (E6) | see the F6 row above |

F2, F3, F4 and F7 are in the supplementary material (`paper/supplement.tex`).
F5 (footprint CCDFs) was folded into FM3, of which it forms the top two rows.
