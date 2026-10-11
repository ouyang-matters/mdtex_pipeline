// Known complexes: every method must report the textbook Z2 Betti numbers,
// both when the complex is the INIT block and when it is built up / torn down
// one atomic edit per update.
#include "test_util.hpp"

using namespace mmhm;
using t::B4;
using t::Simplex;

namespace {

std::vector<Simplex> tet_boundary() { return {{0, 1, 2}, {0, 1, 3}, {0, 2, 3}, {1, 2, 3}}; }

std::vector<Simplex> four_simplex_boundary() {
  std::vector<Simplex> r;
  for (uint32_t skip = 0; skip < 5; ++skip) {
    Simplex s;
    for (uint32_t v = 0; v < 5; ++v)
      if (v != skip) s.push_back(v);
    r.push_back(s);
  }
  return r;
}

std::vector<Simplex> grid_ball(int N) {
  const int M = N + 1;
  auto vid = [&](int x, int y, int z) { return uint32_t((x * M + y) * M + z); };
  const int perms[6][3] = {{0, 1, 2}, {0, 2, 1}, {1, 0, 2}, {1, 2, 0}, {2, 0, 1}, {2, 1, 0}};
  std::vector<Simplex> tets;
  for (int x = 0; x < N; ++x)
    for (int y = 0; y < N; ++y)
      for (int z = 0; z < N; ++z)
        for (const auto& p : perms) {
          int c[3] = {x, y, z};
          Simplex s{vid(x, y, z)};
          for (int a : p) {
            ++c[a];
            s.push_back(vid(c[0], c[1], c[2]));
          }
          std::sort(s.begin(), s.end());
          tets.push_back(s);
        }
  return tets;
}

std::vector<Simplex> torus(int n, int m) {
  auto v = [&](int i, int j) { return uint32_t((i % n) * m + (j % m)); };
  std::vector<Simplex> r;
  for (int i = 0; i < n; ++i)
    for (int j = 0; j < m; ++j) {
      Simplex a{v(i, j), v(i + 1, j), v(i + 1, j + 1)}, b{v(i, j), v(i + 1, j + 1), v(i, j + 1)};
      std::sort(a.begin(), a.end());
      std::sort(b.begin(), b.end());
      r.push_back(a);
      r.push_back(b);
    }
  return r;
}

// 6-vertex RP^2 (hemi-icosahedron).
std::vector<Simplex> rp2() {
  return {{0, 1, 2}, {0, 2, 3}, {0, 3, 4}, {0, 4, 5}, {0, 1, 5},
          {1, 2, 4}, {2, 3, 5}, {1, 3, 4}, {2, 4, 5}, {1, 3, 5}};
}

std::vector<Simplex> figure8() { return {{0, 1}, {1, 2}, {0, 2}, {0, 3}, {3, 4}, {0, 4}}; }

struct Known {
  const char* name;
  std::vector<Simplex> tops;
  int dim;
  B4 betti;
};

std::vector<Known> knowns() {
  return {
      {"tet-boundary", tet_boundary(), 2, {1, 0, 1, 0}},
      {"3-ball(single tet)", {{0, 1, 2, 3}}, 3, {1, 0, 0, 0}},
      {"3-ball(2x2x2 grid)", grid_ball(2), 3, {1, 0, 0, 0}},
      {"3-sphere(4-simplex boundary)", four_simplex_boundary(), 3, {1, 0, 0, 1}},
      {"torus(3x3)", torus(3, 3), 2, {1, 2, 1, 0}},
      {"torus(4x5)", torus(4, 5), 2, {1, 2, 1, 0}},
      {"RP2", rp2(), 2, {1, 1, 1, 0}},
      {"figure-8", figure8(), 1, {1, 2, 0, 0}},
  };
}

B4 init_betti(const std::string& method, const std::vector<Simplex>& K, int dim) {
  std::unique_ptr<Method> m = make_method(method, dim, MethodOptions());
  std::vector<Edit> e;
  for (const Simplex& s : K) e.push_back(t::make_edit('+', s));
  m->init(e.data(), e.size());
  int64_t b[4];
  m->betti(b);
  return {b[0], b[1], b[2], b[3]};
}

}  // namespace

TEST_CASE(known_brute_oracle) {
  for (const Known& k : knowns()) {
    const auto K = t::closure(k.tops);
    const B4 b = t::brute_betti(std::set<Simplex>(K.begin(), K.end()));
    CHECK_MSG(b == k.betti, k.name << ": brute " << t::str(b));
  }
}

TEST_CASE(known_init_all_methods) {
  for (const Known& k : knowns()) {
    const auto K = t::closure(k.tops);
    for (const char* m : {"full-id", "full-morse", "drb-id", "mmhm", "mmhm-norb", "lcr"}) {
      const B4 b = init_betti(m, K, k.dim);
      CHECK_MSG(b == k.betti, k.name << " / " << m << ": got " << t::str(b));
    }
  }
}

TEST_CASE(known_build_up_and_tear_down) {
  for (const Known& k : knowns()) {
    const auto K = t::closure(k.tops);
    t::TestSeq q;
    q.dim = k.dim;
    // INIT: vertices only; then one atomic insertion per update, then delete
    // maximal simplices (reverse insertion order) one per update.
    size_t i = 0;
    while (i < K.size() && K[i].size() == 1) q.init.push_back(K[i++]);
    for (; i < K.size(); ++i) q.updates.push_back({t::Op{'+', K[i]}});
    for (size_t j = K.size(); j-- > 0;) q.updates.push_back({t::Op{'-', K[j]}});
    for (const t::Config& c : t::exact_configs()) {
      t::run_and_compare(q, c);
    }
  }
}

TEST_CASE(known_batched_rebuilds) {
  // Whole complex inserted in batches of 7 on top of an empty INIT.
  for (const Known& k : knowns()) {
    const auto K = t::closure(k.tops);
    t::TestSeq q;
    q.dim = k.dim;
    for (size_t i = 0; i < K.size(); i += 7) {
      std::vector<t::Op> b;
      for (size_t j = i; j < std::min(K.size(), i + 7); ++j) b.push_back(t::Op{'+', K[j]});
      q.updates.push_back(b);
    }
    for (const t::Config& c : t::exact_configs()) t::run_and_compare(q, c);
  }
}

TEST_CASE(known_euler_surfaces) {
  for (const Known& k : knowns()) {
    if (k.dim != 2) continue;
    const auto K = t::closure(k.tops);
    const B4 b = init_betti("euler", K, 2);
    CHECK_MSG(b == k.betti, k.name << " / euler: got " << t::str(b));
  }
  // Punctured torus: remove one triangle.
  auto T = torus(4, 5);
  const Simplex hole = T.back();
  t::TestSeq q;
  q.dim = 2;
  q.init = t::closure(T);
  q.updates.push_back({t::Op{'-', hole}});
  q.updates.push_back({t::Op{'+', hole}});
  t::Config e{"euler", "euler", MethodOptions()};
  t::run_and_compare(q, e);
}

TEST_CASE(known_euler_rejects_non_manifold) {
  bool threw = false;
  try {
    init_betti("euler", t::closure(figure8()), 1);  // edges without cofaces
  } catch (const PreconditionError&) {
    threw = true;
  }
  CHECK(threw);
  threw = false;
  try {
    init_betti("euler", t::closure({{0, 1, 2}, {0, 1, 3}, {0, 1, 4}}), 2);  // 3 triangles on an edge
  } catch (const PreconditionError&) {
    threw = true;
  }
  CHECK(threw);
  threw = false;
  try {
    init_betti("euler", t::closure({{0, 1, 2, 3}}), 3);
  } catch (const PreconditionError&) {
    threw = true;
  }
  CHECK(threw);
}
