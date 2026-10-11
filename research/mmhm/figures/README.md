# figures/ — result figures of the paper

Each `fN_*.py` reads only committed files under `experiments/results/`
(written by `experiments/run.py` + `experiments/aggregate.py`) and writes
`FN_*.pdf` (vector, fonts embedded, 6.3 in wide). Regenerate all:

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

F1 (method schematic) is TikZ in the paper source (`paper/figures/`), not here.

| figure | data source | takeaway (true for the committed data) |
|---|---|---|
| `F2_latency_vs_size.pdf` — median per-update latency (IQR band) vs \|K₀\|, log–log; (a) W2 s = 8 (E1), (b) W3 (E3), (c) W4 2D D = 2 (E4), (d) W1 sphere (E5) | `results/summary.csv`, `summary_slopes.csv` | On W2 and W4 the four DRB methods stay near-flat in \|K₀\| while the static baselines grow linearly. W2: slope 0.24–0.27 vs 1.04 (`full-id`), 1.14 (`full-morse`), 1.06 (`gudhi`), 5 sizes; at 9.6e5 simplices `mmhm` takes 165 µs amortized, 90× less than `full-id` and 1,860× less than `gudhi`. W3: the DRB costs 0.9–3.5 ms median and grows slowly (3 sizes, indicative). On W1 the DRB median grows about linearly, like `full-id` (slope 0.80–1.01). The mechanism is not measured: closing events are only about 2% of updates, so they do not by themselves set the median. Panel (d) omits the DRB IQR bands, which overlap into one band; their p95/p99 are in the tables. In amortized terms at L = 7 (9.8e5 simplices), the insertion-order DRB (`drb-id` 37 ms, `drb-id-rb` 39 ms) is slower than `full-id` (31 ms), and the Morse-order DRB is 1.8–2.0× faster (`mmhm-norb` 15.5 ms, `mmhm` 16.6 ms). `euler` takes 9–32 µs. `full-morse` is 1.1–4.2× slower than `full-id` everywhere: the collapse costs more than the additions it saves. |
| `F3_latency_vs_edit_size.pdf` — E2 (W2, N = 22, s = 1…64): (a) median per-update latency vs s, (b) amortized latency per atomic edit. The hollow `mmhm-norb` point at s = 8 in (b) includes the seed-1 timing outlier of E1; × is the same point with seed 1 replaced by its single rerun | `results/summary.csv`, `results/rerun/` | At fixed \|K\| ≈ 2.9e5 the DRB cost grows roughly linearly with the edit size: median slope 0.88–0.90 (7 values of s), from ≈ 20 µs at s = 1 (16 edits) to 0.72–0.88 ms at s = 64 (1,024 edits). Per atomic edit it stays at 0.8–1.8 µs amortized. The static baselines barely depend on s (slope 0.06–0.07): `full-id` 3.5–4.7 ms and `full-morse` 10.7–14.8 ms amortized. |
| `F4_time_series.pdf` — seed 0 only: latency (mean of the last 50 updates) with rebuild rugs (top), nnz(R)+nnz(V) (bottom); W2 N = 22, W3 N = 20, W1 torus 256² | `results/E1,E3,E5/*__seed0.csv.gz`, W1 `full-id` Betti file | Seed-0 values throughout. W2: nnz stays at 1.08 M and latency stays flat for all four DRB methods; no rebuild fires. W3: without rebuilds nnz grows from 0.81 M to 4.16 M (`drb-id`) and 3.64 M (`mmhm-norb`) over 2,000 updates, and latency rises with it. The rebuilding variants follow a sawtooth (6 rebuilds for `mmhm`, 10 for `drb-id-rb`) and end at 1.49 M and 1.65 M. W1: nnz of the never-rebuilt methods grows steadily (1.25 M → 4.41 M `drb-id`, 3.11 M `mmhm-norb`) while holes repeatedly close and reopen (grey rug). Why typical W1 updates are Θ(n) is not measured here (the engine does not log chain sizes); the figure shows only that nnz grows. |
| `F5_footprint_ccdf.pdf` — E8: CCDF of per-update footprint (Σ\|occ\| over deletions) and column additions, non-rebuild updates, 3 seeds | `results/E1,E3,E4/*.csv.gz` (`summary_e8.csv`) | The Morse order shortens the tails against insertion order. W4: p99 additions 1,131 vs 2,134 and median footprint 60 vs 204. W2: p99 additions 1,047 vs 1,422 and median footprint 89 vs 118, although the median additions are slightly higher (167 vs 156). W3 without rebuilds: median additions 4,570 vs 5,913. With rebuilds on W3, `drb-id-rb` has the lighter p99 tails (additions 19,037 vs 21,059; footprint 13,429 vs 17,301) but more median additions (4,989 vs 4,201). On W2 and W4 no rebuild fired, so `mmhm` = `mmhm-norb` and `drb-id-rb` = `drb-id` (marked in the panels). |
| `F6_nonlocality.pdf` — E6: amortized latency per toggle vs cycle length L (W5a) and triangles n₂ (W5b), with least-squares slopes | `results/summary.csv`, `summary_slopes.csv` | As Proposition 4 predicts, every DRB method is linear in the size of the toggled cycle: slope 1.06–1.10 on W5a (7 sizes, 1e3–1e6) and 1.10–1.16 on W5b (6 sizes, n₂ = 1.3e3–1.3e6). It stays below `full-id` by a constant factor (W5a at L = 1e6: `drb-id` 14 ms, `mmhm` 20 ms, `full-id` 36 ms; W5b at n₂ = 1.3e6: 21–29 ms vs 178 ms). Its p99 is worse than `full-id`'s on W5a (100 ms vs 48 ms at L = 1e6, `mmhm`). Only `euler` is size-independent (≤ 0.3 µs, slope 0.14). |
| `F7_rebuild_sensitivity.pdf` — E7: amortized (top) and p99 (bottom) latency vs growth trigger α, per period, `mmhm` vs `drb-id-rb` | `results/summary_e7.csv` | Rebuilding helps only where the basis actually grows. On W2 and W4 the α trigger essentially never fired: one rebuild in one seed (W4, `mmhm`, α = 0.25) over all α ≥ 0.25. Periodic rebuilds only added cost there: period 64 raised amortized latency from ≈ 120 µs to 0.41–1.5 ms, and the Morse rebuild (collapse included) costs more than the insertion-order one. On W3, rebuilding by the growth trigger cut amortized latency 2.4× for `mmhm` (1.58 ms at α = 1 vs 3.83 ms never) and 2.9× for `drb-id-rb` (2.22 vs 6.44 ms), and p99 from 26.6 ms to 6.7 ms (`mmhm`). On W3, `mmhm` beats `drb-id-rb` in amortized latency at all 18 (α, period) settings; on W2 at 2 of 18 and on W4 at 8 of 18. E7 has no W1 instance; rebuild effects on W1 under the default policy are in `tab_rebuild_effect.tex`. |

Related tables (`paper/generated/`): `tab_e7.tex` (the E7 grid with rebuild
counts), `tab_e8.tex` (E8 quantiles), `tab_rebuild_effect.tex` (whether a
rebuild makes the following updates cheaper or costlier, per instance).
