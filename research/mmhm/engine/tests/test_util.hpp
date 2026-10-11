// Minimal test framework, brute-force Z2 oracle and helpers.
#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <map>
#include <memory>
#include <random>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "methods.hpp"
#include "seq.hpp"

namespace t {

// ------------------------------------------------------------ framework ----
struct Failure : std::runtime_error {
  using std::runtime_error::runtime_error;
};
struct Registry {
  std::vector<std::pair<std::string, std::function<void()>>> tests;
  static Registry& get() {
    static Registry r;
    return r;
  }
};
struct Registrar {
  Registrar(const char* name, std::function<void()> f) { Registry::get().tests.emplace_back(name, f); }
};
#define TEST_CASE(name)                                        \
  static void test_##name();                                   \
  static ::t::Registrar registrar_##name(#name, test_##name); \
  static void test_##name()

#define CHECK(cond)                                                                       \
  do {                                                                                    \
    if (!(cond)) {                                                                        \
      std::ostringstream os_;                                                             \
      os_ << __FILE__ << ":" << __LINE__ << ": CHECK(" #cond ") failed";                  \
      throw ::t::Failure(os_.str());                                                      \
    }                                                                                     \
  } while (0)
#define CHECK_MSG(cond, msg)                                                              \
  do {                                                                                    \
    if (!(cond)) {                                                                        \
      std::ostringstream os_;                                                             \
      os_ << __FILE__ << ":" << __LINE__ << ": CHECK(" #cond ") failed: " << msg;         \
      throw ::t::Failure(os_.str());                                                      \
    }                                                                                     \
  } while (0)

using Simplex = std::vector<uint32_t>;
using B4 = std::array<int64_t, 4>;

inline std::string str(const B4& b) {
  std::ostringstream os;
  os << "(" << b[0] << "," << b[1] << "," << b[2] << "," << b[3] << ")";
  return os.str();
}

// ---------------------------------------------------- brute-force oracle ----
// Betti numbers over Z2 by dense Gaussian elimination of every B_k.
inline size_t dense_rank_z2(std::vector<std::vector<uint64_t>>& m, size_t ncols) {
  size_t rank = 0;
  for (size_t c = 0; c < ncols && rank < m.size(); ++c) {
    const size_t w = c / 64;
    const uint64_t bit = uint64_t(1) << (c % 64);
    size_t p = rank;
    while (p < m.size() && !(m[p][w] & bit)) ++p;
    if (p == m.size()) continue;
    std::swap(m[p], m[rank]);
    for (size_t i = 0; i < m.size(); ++i)
      if (i != rank && (m[i][w] & bit))
        for (size_t x = 0; x < m[i].size(); ++x) m[i][x] ^= m[rank][x];
    ++rank;
  }
  return rank;
}

inline B4 brute_betti(const std::set<Simplex>& K) {
  std::vector<Simplex> by[4];
  for (const Simplex& s : K) by[s.size() - 1].push_back(s);
  std::map<Simplex, size_t> idx[4];
  for (int d = 0; d < 4; ++d)
    for (size_t i = 0; i < by[d].size(); ++i) idx[d][by[d][i]] = i;
  int64_t r[5] = {0, 0, 0, 0, 0};
  for (int k = 1; k <= 3; ++k) {
    const size_t rows = by[k - 1].size();
    const size_t W = (rows + 63) / 64;
    std::vector<std::vector<uint64_t>> m;  // one bitset per column
    for (const Simplex& s : by[k]) {
      std::vector<uint64_t> col(W, 0);
      for (size_t i = 0; i < s.size(); ++i) {
        Simplex f = s;
        f.erase(f.begin() + long(i));
        const size_t j = idx[k - 1].at(f);
        col[j / 64] ^= uint64_t(1) << (j % 64);
      }
      m.push_back(col);
    }
    r[k] = int64_t(dense_rank_z2(m, rows));
  }
  B4 b;
  for (int k = 0; k < 4; ++k) b[k] = int64_t(by[k].size()) - r[k] - r[k + 1];
  return b;
}

// ------------------------------------------------------------- sequences ----
struct Op {
  char op;
  Simplex s;
};
struct TestSeq {
  int dim = 3;
  std::vector<Simplex> init;
  std::vector<std::vector<Op>> updates;
};

inline mmhm::Edit make_edit(char op, const Simplex& s) {
  mmhm::Edit e;
  e.op = op;
  e.n = uint8_t(s.size());
  e.line = 0;
  for (int i = 0; i < 4; ++i) e.v[i] = i < int(s.size()) ? s[i] : mmhm::NONE;
  mmhm::sort_small(e.v, e.n);
  return e;
}

// All faces of the given simplices (closure), sorted by dimension.
inline std::vector<Simplex> closure(const std::vector<Simplex>& tops) {
  std::set<Simplex> all;
  for (Simplex t : tops) {
    std::sort(t.begin(), t.end());
    const int n = int(t.size());
    for (int mask = 1; mask < (1 << n); ++mask) {
      Simplex f;
      for (int i = 0; i < n; ++i)
        if (mask & (1 << i)) f.push_back(t[i]);
      all.insert(f);
    }
  }
  std::vector<Simplex> v(all.begin(), all.end());
  std::stable_sort(v.begin(), v.end(),
                   [](const Simplex& a, const Simplex& b) { return a.size() < b.size(); });
  return v;
}

// Method configurations exercised by the differential tests.
struct Config {
  std::string label, method;
  mmhm::MethodOptions opt;
};
inline std::vector<Config> exact_configs(bool with_rebuild_variants = true) {
  std::vector<Config> c;
  mmhm::MethodOptions def;
  c.push_back({"full-id", "full-id", def});
  c.push_back({"full-morse", "full-morse", def});
  c.push_back({"drb-id", "drb-id", def});
  c.push_back({"mmhm", "mmhm", def});
  c.push_back({"mmhm-norb", "mmhm-norb", def});
  if (with_rebuild_variants) {
    mmhm::MethodOptions a0;
    a0.alpha = 0.0;
    c.push_back({"mmhm(alpha=0)", "mmhm", a0});
    mmhm::MethodOptions a1;
    a1.alpha = 0.1;
    a1.period = 3;
    c.push_back({"mmhm(alpha=0.1,period=3)", "mmhm", a1});
    mmhm::MethodOptions p1;
    p1.alpha = -1;
    p1.period = 1;
    c.push_back({"mmhm(period=1)", "mmhm", p1});
  }
  return c;
}

struct RunStats {
  uint64_t case_a = 0, case_b = 0, rebuilds = 0, updates = 0, mismatches = 0;
};

// Runs `cfg` over `seq`, comparing with the brute-force oracle after INIT and
// after every update. For DRB methods also checks the invariants explicitly
// (in every build type). Throws Failure on the first disagreement.
inline RunStats run_and_compare(const TestSeq& seq, const Config& cfg, bool check_invariants = true) {
  std::unique_ptr<mmhm::Method> m = mmhm::make_method(cfg.method, seq.dim, cfg.opt);
  CHECK(m != nullptr);
  std::set<Simplex> K;
  std::vector<mmhm::Edit> init;
  for (const Simplex& s : seq.init) {
    init.push_back(make_edit('+', s));
    Simplex ss = s;
    std::sort(ss.begin(), ss.end());
    K.insert(ss);
  }
  m->init(init.data(), init.size());
  auto* dm = dynamic_cast<mmhm::DrbMethod*>(m.get());
  auto facets = [&](uint32_t c, std::vector<uint32_t>& f) {
    f.assign(m->cx.facets(c), m->cx.facets(c) + m->cx.num_facets(c));
  };
  RunStats st;
  auto compare = [&](size_t t) {
    int64_t b[4];
    m->betti(b);
    const B4 got{b[0], b[1], b[2], b[3]};
    const B4 want = brute_betti(K);
    CHECK_MSG(got == want, cfg.label << " update " << t << ": got " << str(got) << " want "
                                     << str(want) << " (|K|=" << K.size() << ")");
    if (dm && check_invariants) {
      const std::string e = dm->drb.check(facets);
      CHECK_MSG(e.empty(), cfg.label << " update " << t << ": " << e);
    }
  };
  compare(0);
  for (size_t t = 1; t <= seq.updates.size(); ++t) {
    for (const Op& o : seq.updates[t - 1]) {
      m->apply(make_edit(o.op, o.s));
      Simplex ss = o.s;
      std::sort(ss.begin(), ss.end());
      if (o.op == '+')
        K.insert(ss);
      else
        K.erase(ss);
    }
    m->end_update(t);
    if (m->last_rebuild) ++st.rebuilds;
    compare(t);
    ++st.updates;
  }
  if (dm) {
    st.case_a = dm->drb.case_a;
    st.case_b = dm->drb.case_b;
  }
  return st;
}

// ------------------------------------------------- random valid sequences ----
struct RandomSpec {
  int nv = 7;            // vertex pool size
  int dim = 3;           // max dimension
  double p_top = 0.3;    // initial complex: probability of each top simplex
  int updates = 40;
  int max_batch = 5;
  int phase = 8;         // growth / shrink phases of this many updates
};

// Random closed initial complex on {0..nv-1}, then random valid batches:
// insert a random absent simplex whose facets are present, or delete a random
// maximal simplex; edits are valid sequentially within a batch.
inline TestSeq random_seq(const RandomSpec& sp, uint64_t seed) {
  std::mt19937_64 rng(seed);
  std::uniform_real_distribution<double> U(0, 1);
  // universe: all simplices of dim <= sp.dim on nv vertices
  std::vector<Simplex> uni;
  for (int mask = 1; mask < (1 << sp.nv); ++mask) {
    Simplex s;
    for (int i = 0; i < sp.nv; ++i)
      if (mask & (1 << i)) s.push_back(uint32_t(i));
    if (int(s.size()) <= sp.dim + 1) uni.push_back(s);
  }
  std::vector<Simplex> tops;
  for (const Simplex& s : uni)
    if (int(s.size()) == sp.dim + 1 || (s.size() >= 2 && U(rng) < 0.15))
      if (U(rng) < sp.p_top) tops.push_back(s);
  TestSeq q;
  q.dim = sp.dim;
  q.init = closure(tops);
  std::shuffle(q.init.begin(), q.init.end(), rng);  // INIT need not be faces-first
  std::set<Simplex> K(q.init.begin(), q.init.end());
  for (int t = 0; t < sp.updates; ++t) {
    const bool grow = (t / sp.phase) % 2 == 0;
    const double p_ins = grow ? 0.65 : 0.35;
    const int b = std::uniform_int_distribution<int>(1, sp.max_batch)(rng);
    std::vector<Op> batch;
    for (int e = 0; e < b; ++e) {
      std::vector<const Simplex*> ins, del;
      for (const Simplex& s : uni) {
        const bool present = K.count(s) > 0;
        if (!present) {
          bool ok = true;
          if (s.size() > 1)
            for (size_t i = 0; i < s.size() && ok; ++i) {
              Simplex f = s;
              f.erase(f.begin() + long(i));
              ok = K.count(f) > 0;
            }
          if (ok) ins.push_back(&s);
        } else {
          bool maximal = true;
          for (int v = 0; v < sp.nv && maximal; ++v) {
            if (std::binary_search(s.begin(), s.end(), uint32_t(v))) continue;
            if (int(s.size()) >= sp.dim + 1) break;
            Simplex c = s;
            c.insert(std::upper_bound(c.begin(), c.end(), uint32_t(v)), uint32_t(v));
            if (K.count(c)) maximal = false;
          }
          if (maximal) del.push_back(&s);
        }
      }
      bool do_ins = U(rng) < p_ins;
      if (do_ins && ins.empty()) do_ins = false;
      if (!do_ins && del.empty()) do_ins = true;
      if (do_ins && ins.empty()) break;
      const Simplex& s = do_ins ? *ins[std::uniform_int_distribution<size_t>(0, ins.size() - 1)(rng)]
                                : *del[std::uniform_int_distribution<size_t>(0, del.size() - 1)(rng)];
      if (do_ins)
        K.insert(s);
      else
        K.erase(s);
      batch.push_back(Op{do_ins ? '+' : '-', s});
    }
    q.updates.push_back(batch);
  }
  return q;
}

}  // namespace t
