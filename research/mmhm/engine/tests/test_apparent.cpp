// Lemma 2: in Morse order every gradient pair (tau, sigma) is an apparent
// pair: sigma's column takes its pivot with zero additions and low = tau.
#include "drb.hpp"
#include "morse.hpp"
#include "test_util.hpp"

using namespace mmhm;

namespace {

void check_apparent(Complex& cx, const char* what) {
  MorseBuilder mb;
  MorseOrder mo;
  mb.compute(cx, mo, true);
  CHECK(mo.removal.size() == cx.total());
  std::vector<uint32_t> cell2key, cols[4];
  morse_keys(cx, mo, cell2key, cols);
  // Matching sanity: every cell is paired at most once, Euler characteristic
  // is carried by the critical cells.
  std::vector<int> seen(cx.capacity(), 0);
  for (auto& p : mo.pairs) {
    CHECK(++seen[p.first] == 1 && ++seen[p.second] == 1);
    CHECK(cx.dim(p.second) == cx.dim(p.first) + 1);
  }
  int64_t chi = 0, chi_crit = 0;
  for (int d = 0; d <= 3; ++d) {
    chi += (d % 2 ? -1 : 1) * int64_t(cx.n(d));
    chi_crit += (d % 2 ? -1 : 1) * int64_t(mo.critical[d]);
  }
  CHECK(chi == chi_crit);

  Drb drb(cx.maxdim());
  std::vector<uint32_t> adds;
  drb.build(cx, cell2key, uint32_t(cx.total()), cols, &adds);
  auto facets = [&](uint32_t c, std::vector<uint32_t>& f) {
    f.assign(cx.facets(c), cx.facets(c) + cx.num_facets(c));
  };
  CHECK_MSG(drb.check(facets).empty(), what);
  // slot of sigma in DRB_k is its position in cols[k]
  std::vector<uint32_t> slot(cx.capacity(), NONE);
  for (int d = 1; d <= 3; ++d)
    for (uint32_t i = 0; i < cols[d].size(); ++i) slot[cols[d][i]] = i;
  size_t npairs = 0;
  for (auto& p : mo.pairs) {
    const uint32_t tau = p.first, sigma = p.second;
    const int k = cx.dim(sigma);
    // tau = low(boundary sigma)
    uint32_t mx = 0;
    for (int i = 0; i < cx.num_facets(sigma); ++i) mx = std::max(mx, cell2key[cx.facets(sigma)[i]]);
    CHECK_MSG(mx == cell2key[tau], what << ": tau is not low(d sigma)");
    CHECK_MSG(adds[sigma] == 0, what << ": gradient pair column needed " << adds[sigma] << " additions");
    const SmallVec& R = drb.R(k, slot[sigma]);
    const SmallVec& V = drb.V(k, slot[sigma]);
    CHECK_MSG(!R.empty() && R.back() == cell2key[tau], what << ": low(R_sigma) != tau");
    CHECK_MSG(V.size() == 1 && V[0] == cell2key[sigma], what << ": V_sigma != {sigma}");
    CHECK(drb.pivot_slot(cell2key[tau]) == slot[sigma]);
    ++npairs;
  }
  CHECK(npairs == mo.num_pairs);
}

Complex from_tops(const std::vector<t::Simplex>& tops, int dim) {
  Complex cx(dim);
  for (const t::Simplex& s : t::closure(tops)) {
    uint32_t v[4];
    for (size_t i = 0; i < s.size(); ++i) v[i] = s[i];
    cx.insert(v, int(s.size()));
  }
  return cx;
}

}  // namespace

TEST_CASE(apparent_pairs_random) {
  t::RandomSpec sp;
  for (int nv : {6, 8, 10}) {
    sp.nv = nv;
    sp.p_top = nv >= 10 ? 0.08 : 0.3;
    for (uint64_t seed = 1; seed <= 30; ++seed) {
      t::TestSeq q = t::random_seq(sp, seed);
      Complex cx = from_tops(q.init, 3);
      check_apparent(cx, "random");
    }
  }
}

TEST_CASE(apparent_pairs_after_edits) {
  // Morse order of a complex reached through edits (cell ids reused).
  t::RandomSpec sp;
  sp.nv = 8;
  for (uint64_t seed = 100; seed < 120; ++seed) {
    t::TestSeq q = t::random_seq(sp, seed);
    std::unique_ptr<Method> m = make_method("full-id", 3, MethodOptions());
    std::vector<Edit> init;
    for (auto& s : q.init) init.push_back(t::make_edit('+', s));
    m->init(init.data(), init.size());
    for (auto& u : q.updates) {
      for (auto& o : u) m->apply(t::make_edit(o.op, o.s));
      check_apparent(m->cx, "after edits");
    }
  }
}

TEST_CASE(apparent_pairs_meshes) {
  // grid ball, torus, sphere-like and flag complexes
  std::vector<t::Simplex> tets;
  const int N = 4, M = N + 1;
  auto vid = [&](int x, int y, int z) { return uint32_t((x * M + y) * M + z); };
  const int perms[6][3] = {{0, 1, 2}, {0, 2, 1}, {1, 0, 2}, {1, 2, 0}, {2, 0, 1}, {2, 1, 0}};
  for (int x = 0; x < N; ++x)
    for (int y = 0; y < N; ++y)
      for (int z = 0; z < N; ++z)
        for (const auto& p : perms) {
          int c[3] = {x, y, z};
          t::Simplex s{vid(x, y, z)};
          for (int a : p) {
            ++c[a];
            s.push_back(vid(c[0], c[1], c[2]));
          }
          std::sort(s.begin(), s.end());
          tets.push_back(s);
        }
  Complex ball = from_tops(tets, 3);
  check_apparent(ball, "grid ball");
  // boundary of the ball: triangles with exactly one tet coface (a 2-sphere)
  std::map<t::Simplex, int> tri_count;
  for (auto& s : tets)
    for (int i = 0; i < 4; ++i) {
      t::Simplex f = s;
      f.erase(f.begin() + i);
      ++tri_count[f];
    }
  std::vector<t::Simplex> sphere;
  for (auto& kv : tri_count)
    if (kv.second == 1) sphere.push_back(kv.first);
  Complex sph = from_tops(sphere, 2);
  check_apparent(sph, "sphere");
}
