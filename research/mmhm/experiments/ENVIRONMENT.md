# Experimental environment

All timings in the paper were measured on this host unless a section says otherwise.

| item | value |
|---|---|
| CPU | Intel Xeon @ 2.10 GHz, 4 cores, 1 thread/core (cloud VM) |
| Caches | L1d 48 KiB/core, L2 2 MiB/core, L3 260 MiB shared |
| Memory | 15 GiB |
| OS / kernel | Ubuntu 24.04.5 LTS, Linux 6.18 |
| Compiler | g++ 13.3.0, CMake 3.28.3, Release flags `-O2 -DNDEBUG` |
| Python | 3.13.16, numpy 2.5.3, GUDHI 3.13.0 |
| TeX | TeX Live 2023 (Debian), pdfTeX 1.40.25 |

All methods are single-threaded. At most two timed runs execute concurrently.
Seeds and repetition counts are recorded per configuration in `experiments/configs/`.
