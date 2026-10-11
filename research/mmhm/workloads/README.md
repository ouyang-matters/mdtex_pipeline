# MMHM workloads

Generators for the five workload families of SPEC §6, an independent `.seq`
validator, and the committed samples. The GUDHI oracle and a brute-force Z2
reference live in `../oracle/`.

```
gen.py            CLI: one subcommand per workload (w1 w2 w3 w4 w5a w5b)
w1_surfaces.py    W1 punctured sphere / torus
w2_refine.py      W2 refine/coarsen (stellar 1->4 moves) in a 3-ball
w3_cavities.py    W3 cavities and dents in a 3-ball
w4_pointcloud.py  W4 moving point cloud, flag complex
w5_witness.py     W5a cycle toggle, W5b sphere puncture toggle
common.py         SeqWriter (.seq + .meta.json + .expected.betti), IndexedSet
meshes.py         icosphere, torus grid, Freudenthal cube, disk/sphere checks
validate_seq.py   independent closure validator (no generator imports)
make_samples.py   regenerates samples/ and cross-checks three ways
test_workloads.py tests (plain runner; pytest-compatible)
samples/          small committed instances (+ GUDHI .betti)
data/             large generated instances (gitignored)
```

## Quick start

```sh
cd research/mmhm/workloads
python3 gen.py w2 --N 22 --s 8 -T 2000 --seed 0        # -> data/w2_N22_s8_T2000_seed0.{seq,meta.json,expected.betti}
python3 validate_seq.py data/w2_N22_s8_T2000_seed0.seq
python3 ../oracle/gudhi_oracle.py data/w2_N22_s8_T2000_seed0.seq \
        -o data/w2_N22_s8_T2000_seed0.betti --csv data/w2_N22_s8_T2000_seed0.gudhi.csv \
        --expected data/w2_N22_s8_T2000_seed0.expected.betti
python3 test_workloads.py                                # 20 tests, ~35 s
python3 make_samples.py                                  # regenerate samples/ (~20 s)
```

Every subcommand takes `-T/--updates`, `--seed`, `--out STEM` (default
`data/<auto-name>`) and `--check` (validate every edit while generating; ~2.5x
slower). Output is a deterministic function of the arguments: the RNG is
Python's `random.Random(seed)` (stable across Python versions); numpy and
scipy only compute, never draw. Only `gen_time_s` in the meta varies.

## Outputs

* `<stem>.seq` — SPEC §6.1. INIT lists vertices, edges, triangles, tets (each
  sorted); vertex lists are sorted; deletions top-down, insertions bottom-up.
  One or two `#` comment lines after `dim` record the parameters.
* `<stem>.meta.json` — `workload`, `generator_version`, `params`, `dim`,
  `n_updates`, `ops` (init, total, min/mean/max per update), `sizes`
  (`n0..n3` and total at start and end, min/max over all states, and a
  downsampled `total_series`), `expected_betti` (file name, source, distinct
  values), `seq_sha256`, `seq_bytes`, `gen_time_s`, and workload `stats`
  (W1 hole counts, W2 refine/coarsen counts and live subdivisions, W3
  cavity/dent counts and rejection reasons, W4 `eps` and mean degree).
* `<stem>.expected.betti` — SPEC §6.2 format, one line per state, written
  when the Betti numbers are analytic for every state (W1, W2, W3, W5).

## Generators

Exact rules are normative in SPEC §6.3; summary and parameters:

| workload | subcommand / parameters (defaults) | update | edits per update | Betti |
|---|---|---|---|---|
| W1 sphere | `w1 --surface sphere --level L` or `--freq f`; `--k 2 --sep 1 --target 3` | open a disk patch `P(v,k)` (triangles at distance ≤ k−1 from v) or close a hole (exact reverse) | 59–61 (k=2), 11–13 (k=1) | `(1, max(h−1,0), [h=0], 0)` |
| W1 torus | `w1 --surface torus --n n --m m` (n,m ≥ 3); same | same | 61 (k=2) | `(1, 2+max(h−1,0), [h=0], 0)` |
| W2 | `w2 --N N --s 8 [--warmup 8s --spread warmup]` | `s` stellar 1→4 subdivisions of a BFS face-adjacent cluster, or `s` inverses of nearest leaf subdivisions | exactly `16 s` | `(1,0,0,0)` |
| W3 | `w3 --N N --k 2 --sep 1 --target 4` | carve the k-ring ball of a random interior vertex (cavity or dent) or refill one | ~600–760 (k=2), 75–82 (k=1) | `(1, 0, #cavities, 0)` |
| W4 | `w4 --n n --ambient 2|3 --degree 10 --D 2 --step 0.25` | move one point by ±step·ε per coordinate; delete closed star, reinsert | mean 80 (2D, D=2), 120–180 (D=3); max ~1300 | not analytic |
| W5a | `w5a --L L --edge 0` | toggle edge {e, e+1} | 1 | `(1, [present], 0, 0)` |
| W5b | `w5b --level L` or `--freq f` | toggle one seed-chosen triangle | 1 | `(1, 0, [present], 0)` |

Notes.
* **W1/W3 acceptance.** A candidate patch/ball is redrawn (up to 200 tries,
  then the update closes a hole instead) unless it is a disk (W1) / 3-ball whose
  contact with the cube boundary is empty or one disk (W3), and is separated by
  more than `sep` rings from every existing hole. On small meshes many centres
  are rejected; on the sweep sizes rejections are rare (meta `stats`).
* **W2 bounded size.** `K_0` already contains `warmup = 8s` live subdivisions;
  refine/coarsen is a mean-reverting walk on the live count `x`, and
  `|K| = |K_base| + 14x`. Measured over 2000 updates at N=34: s=8 stays within
  ±0.08 % of `|K_0|`, s=64 within ±0.6 %; no drift (tested in
  `test_w2_size_is_bounded`).
* **W4 top dimension.** In a flag complex truncated at dimension `D` the
  boundary of every `(D+2)`-clique is a `D`-cycle that is never filled, so
  `β_D` is large: at mean degree 10, INIT has β = (1, 68, 6148, 0) for 2D n=1k
  D=2, (3, 1363, 95563, 0) for 2D n=16k D=2, (1, 68, 0, 6184) for 2D n=1k D=3,
  (4, 679, 12, 11360) for 3D n=4k D=3. All Betti numbers do vary, but `β_D` is
  dominated by this truncation effect.

## Sizes and generation times

Formulas: W1 sphere `n = (10f²+2, 30f², 20f²)`, `|K| = 60f²+2`, `f = 2^L`;
W1 torus `(nm, 3nm, 2nm)`, `|K| = 6nm`; Freudenthal base (W2, W3)
`|K| = (N+1)³ + [3N(N+1)² + 3N²(N+1) + N³] + [12N³ + 6N²] + 6N³ ≈ 26N³`
(W2 adds `14·8s` warm-up simplices); W4 `n1 = deg·n/2`, `n2 ≈ 10n` (2D) /
`8n` (3D), `n3 ≈ 12n` (2D) / `7–8n` (3D) at deg 10; W5a `|K| = 2L`.

Measured with `T = 2000`, seed 0 (`|K|` range = min–max over all states; time =
`gen_time_s`, single-threaded Python with up to three generators running
concurrently on the 4-core host of `experiments/ENVIRONMENT.md`):

| workload | parameters | n0 | n1 | n2 | n3 | \|K_0\| | \|K\| range | edits/update mean / max | .seq MB | gen s |
|---|---|---|---|---|---|---|---|---|---|---|
| W1 | sphere L=4 | 2562 | 7680 | 5120 | 0 | 15362 | 14874–15362 | 61 / 61 | 1.7 | 0.3 |
| W1 | sphere L=5 | 10242 | 30720 | 20480 | 0 | 61442 | 60954–61442 | 61 / 61 | 2.4 | 0.4 |
| W1 | sphere L=6 | 40962 | 122880 | 81920 | 0 | 245762 | 245274–245762 | 61 / 61 | 5.4 | 0.7 |
| W1 | sphere L=7 | 163842 | 491520 | 327680 | 0 | 983042 | 982554–983042 | 61 / 61 | 17.4 | 2.4 |
| W1 | torus 64x64 | 4096 | 12288 | 8192 | 0 | 24576 | 23966–24576 | 61 / 61 | 1.9 | 0.5 |
| W1 | torus 128x128 | 16384 | 49152 | 32768 | 0 | 98304 | 97755–98304 | 61 / 61 | 3.1 | 0.5 |
| W1 | torus 256x256 | 65536 | 196608 | 131072 | 0 | 393216 | 392667–393216 | 61 / 61 | 7.6 | 1.2 |
| W1 | torus 500x500 | 250000 | 750000 | 500000 | 0 | 1500000 | 1499512–1500000 | 61 / 61 | 26.4 | 3.8 |
| W2 | N=7 s=8 | 576 | 3119 | 4794 | 2250 | 10739 | 9955–11411 | 128 / 128 | 3.8 | 0.4 |
| W2 | N=10 s=8 | 1395 | 8186 | 12984 | 6192 | 28757 | 27973–29429 | 128 / 128 | 4.3 | 0.4 |
| W2 | N=15 s=8 | 4160 | 25951 | 42234 | 20442 | 92787 | 92115–93459 | 128 / 128 | 5.7 | 0.6 |
| W2 | N=22 s=8 | 12231 | 79214 | 131064 | 64080 | 286589 | 285917–287261 | 128 / 128 | 9.3 | 1.1 |
| W2 | N=33 s=8 | 39368 | 261715 | 438162 | 215814 | 955059 | 954275–955843 | 128 / 128 | 22.5 | 2.6 |
| W2 | N=34 s=8 | 42939 | 285890 | 478968 | 236016 | 1043813 | 1043029–1044597 | 128 / 128 | 24.3 | 2.9 |
| W2 | N=22 s=1 | 12175 | 78990 | 130728 | 63912 | 285805 | 285721–285889 | 16 / 16 | 5.3 | 0.6 |
| W2 | N=22 s=2 | 12183 | 79022 | 130776 | 63936 | 285917 | 285749–286085 | 32 / 32 | 5.9 | 0.6 |
| W2 | N=22 s=4 | 12199 | 79086 | 130872 | 63984 | 286141 | 285805–286477 | 64 / 64 | 7.0 | 0.8 |
| W2 | N=22 s=16 | 12295 | 79470 | 131448 | 64272 | 287485 | 286141–288829 | 256 / 256 | 13.9 | 1.4 |
| W2 | N=22 s=32 | 12423 | 79982 | 132216 | 64656 | 289277 | 286589–291965 | 512 / 512 | 23.1 | 2.3 |
| W2 | N=22 s=64 | 12679 | 81006 | 133752 | 65424 | 292861 | 287485–298237 | 1024 / 1024 | 41.3 | 4.2 |
| W2 | N=34 s=64 | 43387 | 287682 | 481656 | 237360 | 1050085 | 1044709–1056357 | 1024 / 1024 | 58.9 | 7.1 |
| W3 | N=10 k=2 | 1331 | 7930 | 12600 | 6000 | 27861 | 23115–27861 | 599 / 764 | 17.6 | 4.2 |
| W3 | N=14 k=2 | 3375 | 21014 | 34104 | 16464 | 74957 | 69588–74957 | 653 / 740 | 22.1 | 3.7 |
| W3 | N=20 k=2 | 9261 | 59660 | 98400 | 48000 | 215321 | 209232–215321 | 671 / 764 | 26.0 | 4.3 |
| W3 | N=27 k=2 | 21952 | 144423 | 240570 | 118098 | 525043 | 518905–525043 | 680 / 740 | 34.5 | 5.4 |
| W3 | N=27 k=1 | 21952 | 144423 | 240570 | 118098 | 525043 | 524434–525043 | 76 / 82 | 12.3 | 1.8 |
| W4 | 2D n=1000 D=2 | 1000 | 5000 | 10081 | 0 | 16081 | 15862–16315 | 82 / 340 | 2.3 | 0.3 |
| W4 | 2D n=4000 D=2 | 4000 | 20000 | 39911 | 0 | 63911 | 63323–64077 | 83 / 292 | 3.4 | 0.3 |
| W4 | 2D n=16000 D=2 | 16000 | 80000 | 158203 | 0 | 254203 | 253972–254768 | 80 / 315 | 6.6 | 0.4 |
| W4 | 2D n=1000 D=3 | 1000 | 5000 | 10081 | 12332 | 28413 | 27787–29493 | 180 / 1336 | 5.9 | 0.4 |
| W4 | 2D n=4000 D=3 | 4000 | 20000 | 39911 | 47852 | 111763 | 110485–112455 | 181 / 1024 | 8.5 | 0.6 |
| W4 | 3D n=1000 D=3 | 1000 | 5000 | 8615 | 8188 | 22803 | 22293–23947 | 139 / 805 | 4.4 | 0.6 |
| W4 | 3D n=4000 D=3 | 4000 | 20000 | 32592 | 28615 | 85207 | 84243–85463 | 122 / 846 | 5.6 | 0.5 |
| W5a | L=1000 | 1000 | 1000 | 0 | 0 | 2000 | 1999–2000 | 1 / 1 | 0.0 | 0.0 |
| W5a | L=10000 | 10000 | 10000 | 0 | 0 | 20000 | 19999–20000 | 1 / 1 | 0.2 | 0.0 |
| W5a | L=100000 | 100000 | 100000 | 0 | 0 | 200000 | 199999–200000 | 1 / 1 | 2.2 | 0.2 |
| W5b | L=3 | 642 | 1920 | 1280 | 0 | 3842 | 3841–3842 | 1 / 1 | 0.1 | 0.0 |
| W5b | L=5 | 10242 | 30720 | 20480 | 0 | 61442 | 61441–61442 | 1 / 1 | 0.8 | 0.1 |
| W5b | L=7 | 163842 | 491520 | 327680 | 0 | 983042 | 983041–983042 | 1 / 1 | 15.5 | 1.7 |

Peak memory of the largest runs: W1 torus 500x500 530 MB, W2 N=34 370 MB,
W1 sphere L=7 350 MB, W3 N=27 180 MB.

Suggested sweeps for `experiments/PLAN.md`: E1 W2 `s=8`, `N ∈ {7, 10, 15, 22,
33}` (|K| ≈ 1.1e4 … 9.6e5); E2 W2 `N=22`, `s ∈ {1, …, 64}` (|K| ≈ 2.9e5);
E3 W3 `N ∈ {14, 20, 27}`; E4 W4 as tabulated; E5 W1 sphere `L ∈ {4,…,7}`,
torus `64²…500²`; E6 W5a `L ∈ {1e3, 1e4, 1e5}`, W5b `L ∈ {3, 5, 7}`.

## Validator and oracles

* `validate_seq.py FILE...` replays with a dict simplex → present-coface count
  and checks every edit (insert: absent, all facets present; delete: present,
  no coface present; distinct vertices in `[0, 2^32)`; dimension ≤ D) plus the
  block structure. ~3 µs per line: 3.1 M lines (W2 N=34 s=64) in 9.6 s.
* `../oracle/gudhi_oracle.py SEQ [-o BETTI] [--csv CSV] [--max-updates T]
  [--expected BETTI]` replays on a `gudhi.SimplexTree` and calls
  `compute_persistence(homology_coeff_field=2, persistence_dim_max=True)` +
  `betti_numbers()` after INIT and every UPDATE. `persistence_dim_max=True` is
  required (otherwise the top dimension is dropped and a vertex-only complex
  returns `[]`); field 2 matters (RP² is (1,1,1) over Z2, (1,0,0) over Z11);
  output is zero-padded to 4 numbers. CSV `t,ops,time_ns,b0,b1,b2,b3` times
  edits + persistence + betti per update (parsing excluded; row t=0 = INIT).
  Measured GUDHI time per update: W1 torus 60x50 3.3 ms, W2 N=10 8.3 ms, W1
  sphere L=5 16 ms, W3 N=14 27 ms, W3 N=27 151 ms, W4 2D n=16k 194 ms, W1
  sphere L=7 277 ms, W2 N=34 376 ms — a full 2000-update pass at |K| ≈ 1e6
  takes ~13 min.
* `../oracle/bruteforce_z2.py SEQ [-o BETTI]` — dense GF(2) elimination on
  bit-packed numpy rows; small complexes only (≲ 10⁴ simplices).

Verification done so far: GUDHI = analytic on every state of all samples and
of W1 sphere L=5, W1 torus 60x50, W2 N=10 s=8, W3 N=14 k=2, W3 N=10 k=1 (2000
updates each), and on the first 5–10 updates of W1 L=7, W2 N=34 s=64, W3 N=27;
brute force = GUDHI on every state of every sample, on 25 random edit
sequences (dims 1–3, with deletions) and on an S³ deletion/reinsertion script.

## Samples (`samples/`, regenerated by `make_samples.py`)

Each has `.seq`, `.meta.json` (without `gen_time_s`, so regeneration is
byte-identical), `.betti` (GUDHI) and, where analytic, `.expected.betti`.

| sample | parameters | \|K_0\| | T | edits/update | Betti values seen | .seq KB |
|---|---|---|---|---|---|---|
| `w1_sphere_L3` | level 3, k=2, target 3, seed 1 | 3842 | 120 | 61 | h = 0…5 | 119 |
| `w1_torus_16x16` | 16x16, k=2, target 3, seed 1 | 1536 | 120 | 61 | h = 0…6 | 91 |
| `w2_N4_s4` | N=4, s=4, seed 1 | 2425 | 120 | 64 | (1,0,0,0) | 119 |
| `w3_N7_k1` | N=7, k=1, target 3, seed 9 | 9843 | 60 | 78 | β2 = 0…3 | 191 |
| `w4_2d_n200` | n=200, 2D, deg 8, D=2, seed 1 | 2352 | 150 | 66 | 78 distinct | 139 |
| `w4_3d_n120_D3` | n=120, 3D, deg 8, D=3, seed 1 | 1915 | 60 | 108 | 37 distinct | 101 |
| `w5a_cycle_L200` | L=200, seed 1 | 400 | 100 | 1 | 2 | 5 |
| `w5b_sphere_L2` | level 2, seed 1 | 962 | 100 | 1 | 2 | 11 |

`test_committed_samples_are_current` fails if a generator change alters any
sample: rerun `make_samples.py` and commit the result together with the change.
