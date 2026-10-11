"""Shared infrastructure for the MMHM workload generators (SPEC section 6).

`SeqWriter` writes a `.seq` file (SPEC 6.1) and its sidecars:

* `<stem>.seq`            the edit sequence
* `<stem>.meta.json`      parameters, counts, size statistics, provenance
* `<stem>.expected.betti` analytic Betti numbers per state (SPEC 6.2 format),
                          only when the generator knows them for every state

The writer tracks n_0..n_3 by counting edits; it does not validate closure
unless `check=True` (validation proper is `validate_seq.py`, kept independent).
"""

from __future__ import annotations

import hashlib
import json
import os
import time

GENERATOR_NAME = "mmhm-workloads"
GENERATOR_VERSION = "1.0.0"

# Number of points kept in the downsampled |K| time series stored in the meta.
SERIES_POINTS = 200


def fmt(s) -> str:
    return " ".join(map(str, s))


def betti_line(b) -> str:
    b = list(b) + [0] * (4 - len(b))
    return " ".join(str(int(x)) for x in b[:4])


class SeqWriter:
    """Streaming writer for one workload instance."""

    def __init__(self, stem: str, dim: int, comments=(), check: bool = False):
        if not 0 <= dim <= 3:
            raise ValueError("dim must be in 0..3")
        self.t_start = time.perf_counter()
        self.stem = stem
        self.seq_path = stem + ".seq"
        d = os.path.dirname(os.path.abspath(self.seq_path))
        os.makedirs(d, exist_ok=True)
        self.f = open(self.seq_path, "w", encoding="utf-8", newline="\n")
        self.f.write(f"MMHMSEQ 1\ndim {dim}\n")
        for c in comments:
            self.f.write(f"# {c}\n")
        self.dim = dim
        self.n = [0, 0, 0, 0]
        self.buf: list[str] = []
        self.block = None  # None | "INIT" | "UPDATE"
        self.ops = 0
        self.init_ops = 0
        self.update_ops: list[int] = []
        self.n_start = None
        self.n_min = None
        self.n_max = None
        self.total_min = None
        self.total_max = None
        self.totals: list[int] = []
        self.expected: list = []
        self.state = {} if check else None
        self.lines = 2 + len(comments)

    # ------------------------------------------------------------------ edits
    def ins(self, s) -> None:
        self.buf.append("+ " + fmt(s))
        self.n[len(s) - 1] += 1
        self.ops += 1
        if self.state is not None:
            self._check_ins(tuple(s))

    def dele(self, s) -> None:
        self.buf.append("- " + fmt(s))
        self.n[len(s) - 1] -= 1
        self.ops += 1
        if self.state is not None:
            self._check_del(tuple(s))

    def _check_ins(self, s):
        st = self.state
        assert len(set(s)) == len(s) and list(s) == sorted(s), s
        assert len(s) - 1 <= self.dim, s
        assert s not in st, f"insert of present simplex {s}"
        if len(s) > 1:
            for i in range(len(s)):
                f = s[:i] + s[i + 1:]
                assert f in st, f"insert {s}: facet {f} missing"
                st[f] += 1
        st[s] = 0

    def _check_del(self, s):
        st = self.state
        assert s in st, f"delete of absent simplex {s}"
        assert st[s] == 0, f"delete {s}: it still has {st[s]} cofaces"
        del st[s]
        if len(s) > 1:
            for i in range(len(s)):
                st[s[:i] + s[i + 1:]] -= 1

    # ----------------------------------------------------------------- blocks
    def _flush(self, force=False):
        if self.buf and (force or len(self.buf) >= 65536):
            self.f.write("\n".join(self.buf))
            self.f.write("\n")
            self.lines += len(self.buf)
            self.buf.clear()

    def begin_init(self):
        assert self.block is None and self.n_start is None
        self.block = "INIT"
        self.buf.append("INIT")
        self.ops = 0

    def init_complex(self, by_dim, expected=None):
        """Write the whole INIT block from simplices grouped by dimension
        (each group is inserted in the given order, lowest dimension first)."""
        self.begin_init()
        for group in by_dim:
            for s in group:
                self.ins(s)
            self._flush()
        self.end_block(expected)

    def begin_update(self):
        assert self.block is None and self.n_start is not None
        self.block = "UPDATE"
        self.buf.append("UPDATE")
        self.ops = 0

    def end_block(self, expected=None):
        assert self.block is not None
        self.buf.append("END")
        if self.block == "INIT":
            self.init_ops = self.ops
            self.n_start = list(self.n)
            self.n_min = list(self.n)
            self.n_max = list(self.n)
        else:
            if self.ops == 0:
                raise RuntimeError("empty UPDATE block")
            self.update_ops.append(self.ops)
            for k in range(4):
                self.n_min[k] = min(self.n_min[k], self.n[k])
                self.n_max[k] = max(self.n_max[k], self.n[k])
        tot = sum(self.n)
        self.totals.append(tot)
        self.total_min = tot if self.total_min is None else min(self.total_min, tot)
        self.total_max = tot if self.total_max is None else max(self.total_max, tot)
        self.expected.append(None if expected is None else tuple(expected))
        self.block = None
        self._flush()

    # ------------------------------------------------------------------ close
    def close(self, workload: str, params: dict, extra: dict | None = None,
              expected_source: str | None = None) -> dict:
        assert self.block is None
        self._flush(force=True)
        self.f.close()
        gen_time = time.perf_counter() - self.t_start
        h = hashlib.sha256()
        with open(self.seq_path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 22), b""):
                h.update(chunk)
        size_bytes = os.path.getsize(self.seq_path)

        files = {"seq": os.path.basename(self.seq_path)}
        expected_info = None
        if self.expected and all(e is not None for e in self.expected):
            exp_path = self.stem + ".expected.betti"
            with open(exp_path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write("\n".join(betti_line(e) for e in self.expected))
                fh.write("\n")
            files["expected_betti"] = os.path.basename(exp_path)
            distinct = sorted(set(self.expected))
            expected_info = {
                "file": files["expected_betti"],
                "source": expected_source or "analytic",
                "distinct_values": [list(e) for e in distinct],
                "initial": list(self.expected[0]),
            }

        T = len(self.update_ops)
        stride = max(1, -(-len(self.totals) // SERIES_POINTS))
        names = ["n0", "n1", "n2", "n3"]

        def kv(v):
            d = {names[k]: v[k] for k in range(4)}
            d["total"] = sum(v)
            return d

        meta = {
            "workload": workload,
            "generator": GENERATOR_NAME,
            "generator_version": GENERATOR_VERSION,
            "format": "MMHMSEQ 1",
            "dim": self.dim,
            "params": params,
            "files": files,
            "seq_sha256": h.hexdigest(),
            "seq_bytes": size_bytes,
            "seq_lines": self.lines,
            "n_updates": T,
            "ops": {
                "init": self.init_ops,
                "updates_total": sum(self.update_ops),
                "per_update_max": max(self.update_ops) if T else 0,
                "per_update_min": min(self.update_ops) if T else 0,
                "per_update_mean": (sum(self.update_ops) / T) if T else 0.0,
            },
            "sizes": {
                "start": kv(self.n_start),
                "end": kv(self.n),
                "min": dict(zip(names, self.n_min), total=self.total_min),
                "max": dict(zip(names, self.n_max), total=self.total_max),
                "note": "min/max are taken over states (after INIT and after each UPDATE), per component",
                "total_series_stride": stride,
                "total_series": self.totals[::stride],
            },
            "expected_betti": expected_info,
            "gen_time_s": round(gen_time, 3),
        }
        if extra:
            meta["stats"] = extra
        with open(self.stem + ".meta.json", "w", encoding="utf-8", newline="\n") as fh:
            json.dump(meta, fh, indent=1)
            fh.write("\n")
        return meta


class IndexedSet:
    """Set with O(1) add/remove and uniform random choice (deterministic order)."""

    __slots__ = ("items", "pos")

    def __init__(self, it=()):
        self.items = []
        self.pos = {}
        for x in it:
            self.add(x)

    def add(self, x):
        if x in self.pos:
            return
        self.pos[x] = len(self.items)
        self.items.append(x)

    def remove(self, x):
        i = self.pos.pop(x)
        last = self.items.pop()
        if i < len(self.items):
            self.items[i] = last
            self.pos[last] = i

    def __contains__(self, x):
        return x in self.pos

    def __len__(self):
        return len(self.items)

    def choice(self, rng):
        return self.items[rng.randrange(len(self.items))]
