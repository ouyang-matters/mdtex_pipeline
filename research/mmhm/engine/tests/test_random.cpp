// Randomized differential tests: after every update of random valid edit
// sequences on random complexes (dim <= 3), every exact method's Betti
// numbers equal the brute-force Z2 rank computation; DRB invariants are
// checked explicitly after every update (and, in Debug builds, after every
// DRB operation).
#include "test_util.hpp"

using namespace mmhm;

namespace {

struct Totals {
  uint64_t seqs = 0, updates = 0, comparisons = 0, case_a = 0, case_b = 0, rebuilds = 0;
};

Totals run_family(const t::RandomSpec& sp, uint64_t seed0, int nseeds,
                  const std::vector<t::Config>& cfgs) {
  Totals T;
  for (int i = 0; i < nseeds; ++i) {
    const uint64_t seed = seed0 + uint64_t(i);
    t::TestSeq q = t::random_seq(sp, seed);
    ++T.seqs;
    T.updates += q.updates.size();
    for (const t::Config& c : cfgs) {
      t::RunStats st;
      try {
        st = t::run_and_compare(q, c);
      } catch (const t::Failure& f) {
        throw t::Failure(std::string(f.what()) + " [seed " + std::to_string(seed) + ", nv " +
                         std::to_string(sp.nv) + "]");
      }
      T.comparisons += st.updates + 1;
      T.case_a += st.case_a;
      T.case_b += st.case_b;
      T.rebuilds += st.rebuilds;
    }
  }
  std::printf("       %llu sequences, %llu updates, %llu Betti comparisons, case A %llu, case B %llu, "
              "rebuilds %llu\n",
              (unsigned long long)T.seqs, (unsigned long long)T.updates,
              (unsigned long long)T.comparisons, (unsigned long long)T.case_a,
              (unsigned long long)T.case_b, (unsigned long long)T.rebuilds);
  return T;
}

}  // namespace

TEST_CASE(random_small) {
  t::RandomSpec sp;
  for (int nv : {4, 5, 6, 7}) {
    sp.nv = nv;
    sp.dim = 3;
    sp.p_top = 0.3;
    sp.updates = 40;
    sp.max_batch = 5;
    run_family(sp, 1000 * uint64_t(nv), 60, t::exact_configs());
  }
}

TEST_CASE(random_cases) {
  // Both deletion cases must be exercised, by every DRB method.
  t::RandomSpec sp;
  sp.nv = 7;
  sp.updates = 60;
  for (const char* m : {"drb-id", "mmhm", "mmhm-norb"}) {
    t::Config c{m, m, MethodOptions()};
    Totals T = run_family(sp, 77, 40, {c});
    CHECK_MSG(T.case_a > 0 && T.case_b > 0, m << ": case A " << T.case_a << ", case B " << T.case_b);
  }
  // Graph-only sequences (dim 1): cycles appear and disappear.
  sp.dim = 1;
  sp.nv = 9;
  sp.p_top = 0.4;
  Totals T = run_family(sp, 500, 40, t::exact_configs());
  CHECK(T.case_a > 0 && T.case_b > 0);
}

TEST_CASE(random_rebuild) {
  t::RandomSpec sp;
  sp.nv = 7;
  sp.updates = 50;
  sp.max_batch = 8;
  std::vector<t::Config> cfgs;
  for (double a : {0.0, 0.05, 0.25, 1.0}) {
    for (uint64_t p : {0, 1, 2, 5}) {
      MethodOptions o;
      o.alpha = a;
      o.period = p;
      cfgs.push_back({"mmhm(alpha=" + std::to_string(a) + ",period=" + std::to_string(p) + ")",
                      "mmhm", o});
    }
  }
  MethodOptions off;
  off.alpha = -1;
  off.period = 3;
  cfgs.push_back({"mmhm(alpha=off,period=3)", "mmhm", off});
  Totals T = run_family(sp, 9000, 25, cfgs);
  CHECK(T.rebuilds > 0);
}

TEST_CASE(random_wide) {
  // Larger vertex pools, sparser complexes, longer chains and bigger batches.
  t::RandomSpec sp;
  sp.dim = 3;
  sp.updates = 60;
  sp.max_batch = 10;
  sp.phase = 12;
  for (int nv : {9, 11}) {
    sp.nv = nv;
    sp.p_top = nv == 9 ? 0.06 : 0.02;
    run_family(sp, 20000 + 100 * uint64_t(nv), 15, t::exact_configs(false));
  }
}

TEST_CASE(random_dim2) {
  t::RandomSpec sp;
  sp.dim = 2;
  sp.updates = 50;
  sp.max_batch = 6;
  for (int nv : {6, 8, 10}) {
    sp.nv = nv;
    sp.p_top = nv == 10 ? 0.12 : 0.3;
    run_family(sp, 30000 + 100 * uint64_t(nv), 30, t::exact_configs());
  }
}
