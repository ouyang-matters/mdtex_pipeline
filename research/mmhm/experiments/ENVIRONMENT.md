# Experimental environment

All timings in the paper were measured on this host unless a section says otherwise.

| item | value |
|---|---|
| CPU | Intel Xeon @ 2.10 GHz, 4 cores, 1 thread/core (cloud VM) |
| Caches | L1d 48 KiB/core, L2 2 MiB/core, L3 260 MiB shared |
| Memory | 15 GiB |
| OS / kernel | Ubuntu 24.04.5 LTS, Linux 6.18 |
| Compiler | g++ 13.3.0, CMake 3.28.3, Release flags `-O2 -DNDEBUG` |
| Python | 3.13.16, numpy 2.5.3, GUDHI 3.13.0, pandas 3.0.5, matplotlib 3.11.2 |
| TeX | TeX Live 2023 (Debian), pdfTeX 1.40.25 |

All methods are single-threaded. At most two timed runs execute concurrently.
Seeds and repetition counts are recorded per configuration in `experiments/configs/`.

## How the runs were scheduled

* `run.py` executes every run as its own single-threaded process: the engine
  (`engine/build-release/mmhm`, Release `-O2 -DNDEBUG`) or the GUDHI replay
  (`oracle/gudhi_oracle.py`, timing `time.perf_counter_ns` around edits +
  persistence per update).
* At most **2 timed runs** at once. Untimed runs (the `lcr` error-rate runs of
  E0 with `--verify-every 1`, and the E2 GUDHI oracle replays) used the other 2
  cores alongside them (`--mixed`); never more than 4 processes on the 4 cores.
* Interference check before the sweep (`noise.py`, `results/noise/`): the
  median per-update latency of `mmhm` and `full-id` on W2 N = 22 changed by
  −2.3 % / +0.3 % with one other timed run and by −3.6 % / +1.5 % with three
  other busy processes, against a run-to-run CV of 7.1 % / 4.1 % over 5
  identical runs alone. Exact figures: `\NumNoise…` in `paper/generated/`.
* Seeds 0, 1, 2 for every configuration (`configs/E*.json`); T = 2000 updates,
  except `gudhi` above 3e5 simplices (prefix T′ = 200). Timed exact runs use
  `--verify-every 50` (verification is not timed).
* Hard limits (set while the sweep ran): per-run wall-clock limit 30 min
  (killed, recorded as `timeout`, never retried) and no launches after 09:00
  UTC (`run.py --timeout 1800 --no-launch-after 2026-10-11T09:00`), with the
  remaining runs reordered small/mid sizes and seed 0 first, the largest
  instances and the E7 grid last. The runner was restarted once to apply them
  (two in-flight runs were discarded and re-run from scratch). No run hit
  either limit: the sweep (1,236 runs) ran 04:04–06:37 UTC, and
  `results/NOT_RUN.csv` is empty. The longest single run took 6.6 min
  (`full-id` on W5b level 8).
