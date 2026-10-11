// Unit tests of the building blocks.
#include "column.hpp"
#include "complex.hpp"
#include "morse.hpp"
#include "seq.hpp"
#include "simplex_map.hpp"
#include "smallvec.hpp"
#include "test_util.hpp"

using namespace mmhm;

TEST_CASE(unit_xor_merge_random) {
  std::mt19937 rng(1);
  for (int it = 0; it < 2000; ++it) {
    std::set<uint32_t> A, B;
    const int na = int(rng() % 12), nb = int(rng() % 12);
    for (int i = 0; i < na; ++i) A.insert(rng() % 20);
    for (int i = 0; i < nb; ++i) B.insert(rng() % 20);
    std::vector<uint32_t> a(A.begin(), A.end()), b(B.begin(), B.end()), out(a.size() + b.size());
    out.resize(xor_merge(a.data(), uint32_t(a.size()), b.data(), uint32_t(b.size()), out.data()));
    std::vector<uint32_t> want;
    std::set_symmetric_difference(a.begin(), a.end(), b.begin(), b.end(), std::back_inserter(want));
    CHECK(out == want);
  }
}

TEST_CASE(unit_smallvec) {
  SmallVec v;
  for (uint32_t i = 0; i < 100; ++i) v.push_back(i);
  CHECK(v.size() == 100 && v.back() == 99);
  SmallVec w = v;
  CHECK(w.size() == 100 && w[50] == 50);
  std::vector<uint32_t> x = {1, 2};
  w.assign(x.data(), 2);  // shrinks back to inline storage
  CHECK(w.size() == 2 && w[1] == 2 && w.heap_bytes() == 0);
  SmallVec z = std::move(v);
  CHECK(z.size() == 100 && v.size() == 0);
  CHECK(z.erase_unordered(5) && z.size() == 99 && !z.erase_unordered(5));
  std::vector<SmallVec> many(10);
  for (int i = 0; i < 1000; ++i) many.emplace_back(z);  // reallocation moves
  CHECK(many.back().size() == 99);
  SmallVec s;
  uint32_t y[3] = {2, 5, 9};
  s.assign(y, 3);
  CHECK(s.contains_sorted(5) && !s.contains_sorted(4));
}

TEST_CASE(unit_simplex_map) {
  SimplexMap m;
  std::map<std::pair<uint64_t, uint64_t>, uint32_t> ref;
  std::mt19937_64 rng(7);
  for (int it = 0; it < 200000; ++it) {
    uint32_t v[4];
    const int n = 1 + int(rng() % 4);
    for (int i = 0; i < n; ++i) v[i] = uint32_t(rng() % 30) * 7 + uint32_t(i);
    sort_small(v, n);
    const SKey k = make_skey(v, n);
    const auto rk = std::make_pair(k.a, k.b);
    if (rng() % 3 == 0) {
      const bool had = ref.erase(rk) > 0;
      CHECK(m.erase(k) == had);
    } else if (!ref.count(rk)) {
      ref[rk] = uint32_t(it);
      CHECK(m.insert(k, uint32_t(it)));
    } else {
      CHECK(!m.insert(k, 1));
    }
    if (it % 997 == 0) {
      CHECK(m.size() == ref.size());
      for (auto& kv : ref) CHECK(m.find(SKey{kv.first.first, kv.first.second}) == kv.second);
    }
  }
}

TEST_CASE(unit_parse_ok) {
  const std::string text =
      "MMHMSEQ 1\n"
      "dim 2   # max dimension\n"
      "# comment\n"
      "INIT\n"
      "+ 1 0\n"
      "+ 0\n"
      "+ 1\n"
      "END\n"
      "UPDATE\n"
      "- 0 1   # inline comment\n"
      "+ 2\n"
      "END\n"
      "UPDATE\n"
      "END\n";
  Sequence s;
  std::string err;
  CHECK_MSG(parse_seq_text(text, s, err), err);
  CHECK(s.dim == 2);
  CHECK(s.num_updates() == 2);
  CHECK(s.block_size(0) == 3 && s.block_size(1) == 2 && s.block_size(2) == 0);
  // INIT is stably sorted by dimension; vertex lists are sorted.
  CHECK(s.block(0)[0].n == 1 && s.block(0)[0].v[0] == 0 && s.block(0)[0].line == 6);
  CHECK(s.block(0)[1].n == 1 && s.block(0)[1].v[0] == 1 && s.block(0)[1].line == 7);
  CHECK(s.block(0)[2].n == 2 && s.block(0)[2].v[0] == 0 && s.block(0)[2].v[1] == 1);
  CHECK(s.block(1)[0].op == '-' && s.block(1)[0].line == 10);
}

TEST_CASE(unit_parse_errors) {
  const char* bad[] = {
      "MMHMSEQ 2\ndim 2\nINIT\nEND\n",
      "MMHMSEQ 1\ndim 4\nINIT\nEND\n",
      "MMHMSEQ 1\ndim 1\nINIT\n+ 0 1 2\nEND\n",
      "MMHMSEQ 1\ndim 2\nINIT\n- 0\nEND\n",
      "MMHMSEQ 1\ndim 2\nINIT\n+ 0 0\nEND\n",
      "MMHMSEQ 1\ndim 2\nINIT\n+ 0\n",
      "MMHMSEQ 1\ndim 2\nUPDATE\nEND\n",
      "MMHMSEQ 1\ndim 2\nINIT\n+ x\nEND\n",
      "MMHMSEQ 1\ndim 2\nINIT\n+ 4294967295\nEND\n",
  };
  for (const char* b : bad) {
    Sequence s;
    std::string err;
    CHECK_MSG(!parse_seq_text(b, s, err), b);
    CHECK(!err.empty());
  }
}

TEST_CASE(unit_complex_validation) {
  Complex cx(2);
  uint32_t v0[1] = {0}, v1[1] = {1}, e01[2] = {0, 1}, e02[2] = {0, 2};
  cx.insert(v0, 1);
  cx.insert(v1, 1);
  bool threw = false;
  try {
    cx.insert(e02, 2);
  } catch (const EditError&) {
    threw = true;
  }
  CHECK(threw);
  const uint32_t e = cx.insert(e01, 2);
  CHECK(cx.dim(e) == 1 && cx.cofaces(cx.find(v0, 1)).size() == 1);
  threw = false;
  try {
    cx.find_deletable(v0, 1);
  } catch (const EditError&) {
    threw = true;
  }
  CHECK(threw);
  threw = false;
  try {
    cx.insert(e01, 2);
  } catch (const EditError&) {
    threw = true;
  }
  CHECK(threw);
  cx.remove(cx.find_deletable(e01, 2));
  CHECK(cx.n(1) == 0 && cx.cofaces(cx.find(v0, 1)).empty());
  cx.remove(cx.find_deletable(v0, 1));
  CHECK(cx.n(0) == 1 && cx.find(v0, 1) == NONE);
}

// The Morse order must be a function of the complex as a set (not of history,
// cell ids or INIT listing order).
TEST_CASE(unit_morse_deterministic) {
  t::RandomSpec sp;
  sp.nv = 8;
  sp.p_top = 0.35;
  for (uint64_t seed = 1; seed <= 20; ++seed) {
    t::TestSeq q = t::random_seq(sp, seed);
    auto build_keys = [&](std::vector<t::Simplex> order, uint64_t junk_seed) {
      Complex cx(3);
      // insert some junk first and delete it to perturb cell ids
      for (uint32_t i = 0; i < junk_seed % 5; ++i) {
        uint32_t v[1] = {1000 + i};
        cx.insert(v, 1);
      }
      for (uint32_t i = 0; i < junk_seed % 5; ++i) {
        uint32_t v[1] = {1000 + i};
        cx.remove(cx.find_deletable(v, 1));  // ids are reused below
      }
      std::stable_sort(order.begin(), order.end(),
                       [](const t::Simplex& a, const t::Simplex& b) { return a.size() < b.size(); });
      for (auto& s : order) {
        uint32_t v[4];
        for (size_t i = 0; i < s.size(); ++i) v[i] = s[i];
        sort_small(v, int(s.size()));
        cx.insert(v, int(s.size()));
      }
      MorseBuilder mb;
      MorseOrder mo;
      mb.compute(cx, mo, true);
      std::map<t::Simplex, uint32_t> rm;
      for (size_t i = 0; i < mo.removal.size(); ++i) {
        const uint32_t c = mo.removal[i];
        rm[t::Simplex(cx.verts(c), cx.verts(c) + cx.dim(c) + 1)] = uint32_t(i);
      }
      CHECK(mo.removal.size() == cx.total());
      return rm;
    };
    auto a = build_keys(q.init, 0);
    std::vector<t::Simplex> shuffled = q.init;
    std::mt19937 rng{static_cast<uint32_t>(seed)};
    std::shuffle(shuffled.begin(), shuffled.end(), rng);
    auto b = build_keys(shuffled, seed + 3);
    CHECK(a == b);
  }
}

// The lazily merged order indices must equal a brute-force scan after any
// edit history, with tracking on, off, or toggled.
TEST_CASE(unit_order_indices) {
  t::RandomSpec sp;
  sp.nv = 8;
  sp.updates = 60;
  for (uint64_t seed = 1; seed <= 30; ++seed) {
    t::TestSeq q = t::random_seq(sp, seed);
    Complex cx(3);
    const int mode = int(seed % 3);  // 0: on, 1: off, 2: toggled
    if (mode == 1) {
      cx.set_track_insertion(false);
      cx.set_track_tuples(false);
    }
    std::vector<t::Simplex> init = q.init;
    std::stable_sort(init.begin(), init.end(),
                     [](const t::Simplex& a, const t::Simplex& b) { return a.size() < b.size(); });
    std::map<t::Simplex, uint64_t> ins_order;  // simplex -> insertion counter
    uint64_t counter = 0;
    auto ins = [&](const t::Simplex& s) {
      Edit e = t::make_edit('+', s);
      cx.insert(e.v, e.n);
      ins_order[t::Simplex(e.v, e.v + e.n)] = counter++;
    };
    for (auto& s : init) ins(s);
    for (size_t u = 0; u < q.updates.size(); ++u) {
      for (auto& o : q.updates[u]) {
        if (o.op == '+') {
          ins(o.s);
        } else {
          Edit e = t::make_edit('-', o.s);
          cx.remove(cx.find_deletable(e.v, e.n));
          ins_order.erase(t::Simplex(e.v, e.v + e.n));
        }
      }
      if (mode == 2 && u % 7 == 3) {
        const bool on = (u / 7) % 2 == 0;
        cx.set_track_insertion(on);
        cx.set_track_tuples(on);
      }
      if (u % 3 != 0) continue;  // query only sometimes so edits accumulate
      for (int d = 0; d <= 3; ++d) {
        std::vector<std::pair<uint64_t, t::Simplex>> want_ins;
        std::vector<t::Simplex> want_tup;
        for (auto& kv : ins_order)
          if (int(kv.first.size()) == d + 1) {
            want_ins.emplace_back(kv.second, kv.first);
            want_tup.push_back(kv.first);
          }
        std::sort(want_ins.begin(), want_ins.end());
        std::vector<uint32_t> got;
        cx.cells_by_insertion(d, got);
        CHECK_MSG(got.size() == want_ins.size(), "insertion index size, seed " << seed);
        for (size_t i = 0; i < got.size(); ++i) {
          CHECK(cx.alive(got[i]));
          CHECK(t::Simplex(cx.verts(got[i]), cx.verts(got[i]) + d + 1) == want_ins[i].second);
        }
        const auto& tup = cx.cells_by_tuple(d);
        CHECK_MSG(tup.size() == want_tup.size(), "tuple index size, seed " << seed);
        for (size_t i = 0; i < tup.size(); ++i) {
          CHECK(cx.alive(tup[i].c) && cx.key(tup[i].c) == tup[i].k);
          CHECK(t::Simplex(cx.verts(tup[i].c), cx.verts(tup[i].c) + d + 1) == want_tup[i]);
        }
      }
    }
  }
}

// Working columns: identical results to plain symmetric difference, in both
// representations (small sorted / heap or append), including low() after
// every addition.
TEST_CASE(unit_work_columns) {
  std::mt19937 rng(11);
  for (int it = 0; it < 3000; ++it) {
    const uint32_t universe = 1 + rng() % (it % 3 == 0 ? 40 : 400);
    auto rand_chain = [&](uint32_t maxlen) {
      std::set<uint32_t> s;
      const uint32_t n = rng() % (maxlen + 1);
      for (uint32_t i = 0; i < n; ++i) s.insert(rng() % universe);
      return std::vector<uint32_t>(s.begin(), s.end());
    };
    std::vector<uint32_t> init = rand_chain(it % 2 ? 8 : 60);
    std::set<uint32_t> refR(init.begin(), init.end()), refV;
    WorkR wr;
    WorkV wv;
    wr.reset(init.data(), uint32_t(init.size()));
    const uint32_t s0 = rng() % universe;
    wv.reset(s0);
    refV.insert(s0);
    const int steps = int(rng() % 40);
    for (int k = 0; k < steps; ++k) {
      std::vector<uint32_t> c = rand_chain(it % 4 == 0 ? 120 : 10);
      wr.add(c.data(), uint32_t(c.size()));
      wv.add(c.data(), uint32_t(c.size()));
      for (uint32_t x : c) {
        if (!refR.erase(x)) refR.insert(x);
        if (!refV.erase(x)) refV.insert(x);
      }
      const uint32_t want = refR.empty() ? NONE : *refR.rbegin();
      CHECK(wr.low() == want);
    }
    std::vector<uint32_t> gotR(wr.data(), wr.data() + wr.size());
    std::vector<uint32_t> gotV(wv.data(), wv.data() + wv.size());
    CHECK(gotR == std::vector<uint32_t>(refR.begin(), refR.end()));
    CHECK(gotV == std::vector<uint32_t>(refV.begin(), refV.end()));
  }
}
