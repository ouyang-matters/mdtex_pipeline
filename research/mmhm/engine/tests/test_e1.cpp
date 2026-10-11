// SPEC 0, E1: re-reducing only the replaced column (no basis tracking) is
// wrong; the DRB is right.
#include "drb.hpp"
#include "lcr.hpp"
#include "test_util.hpp"

using namespace mmhm;

// Matrix level: B = [a | b], a = b = e1. Replace a by e2. True rank 2.
// Cells: rows e1 = 0, e2 = 1 (dimension 0); columns a = 2, b = 3, a' = 4.
TEST_CASE(e1_matrix_level) {
  std::map<uint32_t, std::vector<uint32_t>> bd = {{2, {0}}, {3, {0}}, {4, {1}}};
  FacetsFn facets = [&](uint32_t c, std::vector<uint32_t>& f) { f = bd.count(c) ? bd[c] : std::vector<uint32_t>{}; };

  Drb drb(1);
  drb.set_auto_check(facets);
  Lcr lcr(1);
  for (uint32_t r : {0u, 1u}) {
    drb.add_cell(r, 0, nullptr, 0);
    lcr.add_cell(r, 0, nullptr, 0);
  }
  for (uint32_t c : {2u, 3u}) {
    drb.add_cell(c, 1, bd[c].data(), 1);
    lcr.add_cell(c, 1, bd[c].data(), 1);
  }
  CHECK(drb.rank(1) == 1 && lcr.rank(1) == 1);  // b <- b + a = 0
  CHECK(drb.check(facets).empty());
  // b absorbed a: V_b = {a, b}, so a's footprint is 2 slots.
  CHECK(drb.occ_of(2).size() == 2);
  // replace a by e2
  drb.remove_cell(2);
  lcr.remove_cell(2);
  bd.erase(2);
  drb.add_cell(4, 1, bd[4].data(), 1);
  lcr.add_cell(4, 1, bd[4].data(), 1);
  CHECK(drb.check(facets).empty());
  CHECK_MSG(drb.rank(1) == 2, "DRB rank " << drb.rank(1));
  CHECK_MSG(lcr.rank(1) == 1, "LCR rank " << lcr.rank(1));
  CHECK(drb.case_a == 1 && drb.case_b == 0);  // the cycle V_b = a + b absorbs the deletion
}

// Same failure by deletion alone: a = e1, b = e1 + e2 with ord(e1) > ord(e2),
// so b <- b + a = e2 and R_b = e2 is only correct while a exists. Delete a,
// then insert c = e2. True rank of [e1+e2 | e2] is 2. lcr reduces c by the
// stale R_b to zero and reports 1. The DRB deletes a by Case B with p = b's
// slot (the smaller low), which repairs slot a to (R, V) = (e1+e2, b).
TEST_CASE(e1_matrix_level_stale_column) {
  std::map<uint32_t, std::vector<uint32_t>> bd = {{2, {0}}, {3, {0, 1}}, {4, {1}}};
  FacetsFn facets = [&](uint32_t c, std::vector<uint32_t>& f) { f = bd.count(c) ? bd[c] : std::vector<uint32_t>{}; };
  Drb drb(1);
  drb.set_auto_check(facets);
  Lcr lcr(1);
  for (uint32_t r : {1u, 0u}) {  // e2 (cell 1) gets key 0, e1 (cell 0) key 1
    drb.add_cell(r, 0, nullptr, 0);
    lcr.add_cell(r, 0, nullptr, 0);
  }
  for (uint32_t c : {2u, 3u}) {
    drb.add_cell(c, 1, bd[c].data(), int(bd[c].size()));
    lcr.add_cell(c, 1, bd[c].data(), int(bd[c].size()));
  }
  CHECK(drb.rank(1) == 2 && lcr.rank(1) == 2);
  CHECK(drb.chain_adds == 1);  // b absorbed a
  drb.remove_cell(2);
  lcr.remove_cell(2);
  bd.erase(2);
  CHECK(drb.rank(1) == 1 && lcr.rank(1) == 1);
  CHECK(drb.case_b == 1 && drb.case_a == 0);
  drb.add_cell(4, 1, bd[4].data(), 1);
  lcr.add_cell(4, 1, bd[4].data(), 1);
  CHECK(drb.check(facets).empty());
  CHECK_MSG(drb.rank(1) == 2, "DRB rank " << drb.rank(1));
  CHECK_MSG(lcr.rank(1) == 1, "LCR rank " << lcr.rank(1));
}

// Complex level: the boundary of a triangle, built edge by edge; the third
// edge reduces to zero by absorbing the first two. Deleting an absorbed edge
// leaves lcr with a stale zero column: it reports beta0 = 2, beta1 = 1 for a
// path. Every exact method stays correct. (Also exercised through the CLI
// mismatch counter.)
TEST_CASE(e1_complex_level_lcr_fails) {
  t::TestSeq q;
  q.dim = 1;
  q.init = {{0}, {1}, {2}};
  q.updates = {{{'+', {0, 1}}, {'+', {1, 2}}, {'+', {0, 2}}},
               {{'-', {0, 1}}},
               {{'-', {1, 2}}},
               {{'+', {0, 1}}}};
  for (const t::Config& c : t::exact_configs()) t::run_and_compare(q, c);

  // lcr: count disagreements with the brute-force oracle.
  int mismatches = 0;
  for (int variant = 0; variant < 2; ++variant) {
    std::unique_ptr<Method> m = make_method("lcr", 1, MethodOptions());
    std::vector<Edit> init;
    for (auto& s : q.init) init.push_back(t::make_edit('+', s));
    m->init(init.data(), init.size());
    std::set<t::Simplex> K(q.init.begin(), q.init.end());
    for (size_t u = 0; u < q.updates.size(); ++u) {
      for (const t::Op& o : q.updates[u]) {
        m->apply(t::make_edit(o.op, o.s));
        if (o.op == '+')
          K.insert(o.s);
        else
          K.erase(o.s);
      }
      m->end_update(u + 1);
      int64_t b[4];
      m->betti(b);
      if (t::B4{b[0], b[1], b[2], b[3]} != t::brute_betti(K)) ++mismatches;
    }
  }
  CHECK_MSG(mismatches > 0, "lcr never disagreed with the oracle");
}

// lcr over random sequences: it must disagree somewhere (it is the v1 rule),
// while never crashing. Reports the error rate.
TEST_CASE(e1_lcr_error_rate_random) {
  t::RandomSpec sp;
  sp.nv = 7;
  int updates = 0, wrong = 0;
  for (uint64_t seed = 1; seed <= 40; ++seed) {
    t::TestSeq q = t::random_seq(sp, seed);
    std::unique_ptr<Method> m = make_method("lcr", q.dim, MethodOptions());
    std::vector<Edit> init;
    for (auto& s : q.init) init.push_back(t::make_edit('+', s));
    m->init(init.data(), init.size());
    std::set<t::Simplex> K(q.init.begin(), q.init.end());
    for (size_t u = 0; u < q.updates.size(); ++u) {
      for (const t::Op& o : q.updates[u]) {
        m->apply(t::make_edit(o.op, o.s));
        if (o.op == '+')
          K.insert(o.s);
        else
          K.erase(o.s);
      }
      m->end_update(u + 1);
      int64_t b[4];
      m->betti(b);
      ++updates;
      if (t::B4{b[0], b[1], b[2], b[3]} != t::brute_betti(K)) ++wrong;
    }
  }
  std::printf("       lcr wrong after %d of %d random updates\n", wrong, updates);
  CHECK(wrong > 0);
}
