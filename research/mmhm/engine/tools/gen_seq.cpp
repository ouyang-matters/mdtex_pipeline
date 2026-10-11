// Small synthetic .seq generator for engine tests and sanity runs.
// (The paper's workloads are produced by ../workloads; this is test tooling.)
//
//   gen_seq ball  --n N [--updates T] [--batch s] [--seed k] --out file.seq
//     Freudenthal tetrahedralization of an N^3 grid of cubes; INIT = the
//     whole closed ball. Each update is a batch of 1..s random atomic edits:
//     delete a random maximal simplex or insert a random absent simplex of
//     the mesh whose facets are present (probability of insertion follows a
//     slow sine so the size oscillates). Topology changes freely.
//
//   gen_seq torus --n N --m M [--updates T] [--batch s] [--seed k] --out file.seq
//     N x M grid torus. Each edit deletes a triangle all of whose edges
//     have two cofaces, or re-inserts a deleted triangle, so the complex
//     stays a connected surface with boundary (valid input for `euler`).

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <map>
#include <random>
#include <string>
#include <vector>

namespace {

using Simplex = std::vector<uint32_t>;

struct IndexedSet {
  std::vector<uint32_t> items;
  std::vector<uint32_t> pos;  // NONE if absent
  explicit IndexedSet(size_t n) : pos(n, UINT32_MAX) {}
  bool has(uint32_t x) const { return pos[x] != UINT32_MAX; }
  void add(uint32_t x) {
    if (has(x)) return;
    pos[x] = uint32_t(items.size());
    items.push_back(x);
  }
  void remove(uint32_t x) {
    if (!has(x)) return;
    uint32_t i = pos[x], last = items.back();
    items[i] = last;
    pos[last] = i;
    items.pop_back();
    pos[x] = UINT32_MAX;
  }
  size_t size() const { return items.size(); }
  template <class R>
  uint32_t pick(R& rng) const {
    return items[std::uniform_int_distribution<size_t>(0, items.size() - 1)(rng)];
  }
};

struct Universe {
  std::vector<Simplex> s;
  std::map<Simplex, uint32_t> id;
  std::vector<std::vector<uint32_t>> facets, cofaces;
  void close_and_index(const std::vector<Simplex>& tops) {
    std::vector<Simplex> all;
    for (const Simplex& t : tops) {
      const int n = int(t.size());
      for (int mask = 1; mask < (1 << n); ++mask) {
        Simplex f;
        for (int i = 0; i < n; ++i)
          if (mask & (1 << i)) f.push_back(t[i]);
        all.push_back(f);
      }
    }
    std::sort(all.begin(), all.end(), [](const Simplex& a, const Simplex& b) {
      return a.size() != b.size() ? a.size() < b.size() : a < b;
    });
    all.erase(std::unique(all.begin(), all.end()), all.end());
    s = all;
    for (uint32_t i = 0; i < s.size(); ++i) id[s[i]] = i;
    facets.assign(s.size(), {});
    cofaces.assign(s.size(), {});
    for (uint32_t i = 0; i < s.size(); ++i) {
      if (s[i].size() < 2) continue;
      for (size_t j = 0; j < s[i].size(); ++j) {
        Simplex f = s[i];
        f.erase(f.begin() + long(j));
        uint32_t fi = id.at(f);
        facets[i].push_back(fi);
        cofaces[fi].push_back(i);
      }
    }
  }
};

void write_simplex(FILE* f, char op, const Simplex& s) {
  std::fputc(op, f);
  for (uint32_t v : s) std::fprintf(f, " %u", v);
  std::fputc('\n', f);
}

int gen_ball(int N, int T, int batch, uint64_t seed, FILE* out) {
  const int M = N + 1;
  auto vid = [&](int x, int y, int z) { return uint32_t((x * M + y) * M + z); };
  std::vector<Simplex> tets;
  const int perms[6][3] = {{0, 1, 2}, {0, 2, 1}, {1, 0, 2}, {1, 2, 0}, {2, 0, 1}, {2, 1, 0}};
  for (int x = 0; x < N; ++x)
    for (int y = 0; y < N; ++y)
      for (int z = 0; z < N; ++z)
        for (const auto& p : perms) {
          int c[3] = {x, y, z};
          Simplex t{vid(c[0], c[1], c[2])};
          for (int a : p) {
            ++c[a];
            t.push_back(vid(c[0], c[1], c[2]));
          }
          std::sort(t.begin(), t.end());
          tets.push_back(t);
        }
  Universe U;
  U.close_and_index(tets);
  const size_t n = U.s.size();
  std::vector<uint8_t> present(n, 1);
  std::vector<uint32_t> pcof(n);
  IndexedSet maximal(n), insertable(n);
  for (uint32_t i = 0; i < n; ++i) {
    pcof[i] = uint32_t(U.cofaces[i].size());
    if (pcof[i] == 0) maximal.add(i);
  }
  std::fprintf(out, "MMHMSEQ 1\ndim 3\n# gen_seq ball n=%d updates=%d batch=%d seed=%llu\nINIT\n", N,
               T, batch, (unsigned long long)seed);
  for (uint32_t i = 0; i < n; ++i) write_simplex(out, '+', U.s[i]);
  std::fprintf(out, "END\n");
  std::mt19937_64 rng(seed);
  std::uniform_real_distribution<double> unif(0.0, 1.0);
  for (int t = 1; t <= T; ++t) {
    std::fprintf(out, "UPDATE\n");
    const int s = std::uniform_int_distribution<int>(1, batch)(rng);
    const double p_ins = 0.5 + 0.25 * std::sin(t / 7.0);
    for (int e = 0; e < s; ++e) {
      bool ins = unif(rng) < p_ins;
      if (ins && insertable.size() == 0) ins = false;
      if (!ins && maximal.size() == 0) ins = true;
      if (ins) {
        const uint32_t x = insertable.pick(rng);
        insertable.remove(x);
        present[x] = 1;
        pcof[x] = 0;
        maximal.add(x);
        for (uint32_t f : U.facets[x])
          if (pcof[f]++ == 0) maximal.remove(f);
        for (uint32_t c : U.cofaces[x]) {
          bool ok = !present[c];
          for (uint32_t g : U.facets[c]) ok = ok && present[g];
          if (ok) insertable.add(c);
        }
        write_simplex(out, '+', U.s[x]);
      } else {
        const uint32_t x = maximal.pick(rng);
        maximal.remove(x);
        present[x] = 0;
        insertable.add(x);
        for (uint32_t f : U.facets[x])
          if (--pcof[f] == 0) maximal.add(f);
        for (uint32_t c : U.cofaces[x]) insertable.remove(c);
        write_simplex(out, '-', U.s[x]);
      }
    }
    std::fprintf(out, "END\n");
  }
  return 0;
}

int gen_torus(int N, int Mm, int T, int batch, uint64_t seed, FILE* out) {
  auto v = [&](int i, int j) { return uint32_t(((i % N + N) % N) * Mm + ((j % Mm + Mm) % Mm)); };
  std::vector<Simplex> tris;
  for (int i = 0; i < N; ++i)
    for (int j = 0; j < Mm; ++j) {
      Simplex a{v(i, j), v(i + 1, j), v(i + 1, j + 1)}, b{v(i, j), v(i + 1, j + 1), v(i, j + 1)};
      std::sort(a.begin(), a.end());
      std::sort(b.begin(), b.end());
      tris.push_back(a);
      tris.push_back(b);
    }
  Universe U;
  U.close_and_index(tris);
  const size_t n = U.s.size();
  std::vector<uint8_t> present(n, 1);
  std::vector<uint32_t> ecof(n, 0);
  std::vector<uint32_t> tri_ids;
  for (uint32_t i = 0; i < n; ++i)
    if (U.s[i].size() == 3) tri_ids.push_back(i);
  for (uint32_t t : tri_ids)
    for (uint32_t e : U.facets[t]) ++ecof[e];
  std::fprintf(out, "MMHMSEQ 1\ndim 2\n# gen_seq torus n=%d m=%d updates=%d batch=%d seed=%llu\nINIT\n",
               N, Mm, T, batch, (unsigned long long)seed);
  for (uint32_t i = 0; i < n; ++i) write_simplex(out, '+', U.s[i]);
  std::fprintf(out, "END\n");
  std::mt19937_64 rng(seed);
  std::vector<uint32_t> removed;
  for (int t = 1; t <= T; ++t) {
    std::fprintf(out, "UPDATE\n");
    const int s = std::uniform_int_distribution<int>(1, batch)(rng);
    for (int e = 0; e < s; ++e) {
      std::vector<uint32_t> cand;
      for (uint32_t x : tri_ids) {
        if (!present[x]) continue;
        bool ok = true;
        for (uint32_t g : U.facets[x]) ok = ok && ecof[g] == 2;
        if (ok) cand.push_back(x);
      }
      const bool ins = !removed.empty() && (cand.empty() || (rng() % 2 == 0));
      if (ins) {
        const size_t i = std::uniform_int_distribution<size_t>(0, removed.size() - 1)(rng);
        const uint32_t x = removed[i];
        removed.erase(removed.begin() + long(i));
        present[x] = 1;
        for (uint32_t g : U.facets[x]) ++ecof[g];
        write_simplex(out, '+', U.s[x]);
      } else {
        const uint32_t x = cand[std::uniform_int_distribution<size_t>(0, cand.size() - 1)(rng)];
        present[x] = 0;
        removed.push_back(x);
        for (uint32_t g : U.facets[x]) --ecof[g];
        write_simplex(out, '-', U.s[x]);
      }
    }
    std::fprintf(out, "END\n");
  }
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: gen_seq ball|torus --n N [--m M] [--updates T] [--batch s] "
                         "[--seed k] --out file\n");
    return 1;
  }
  std::string mode = argv[1], outp;
  int N = 3, Mm = 3, T = 50, batch = 4;
  uint64_t seed = 1;
  for (int i = 2; i + 1 < argc; i += 2) {
    std::string k = argv[i];
    const char* v = argv[i + 1];
    if (k == "--n") N = std::atoi(v);
    else if (k == "--m") Mm = std::atoi(v);
    else if (k == "--updates") T = std::atoi(v);
    else if (k == "--batch") batch = std::atoi(v);
    else if (k == "--seed") seed = std::strtoull(v, nullptr, 10);
    else if (k == "--out") outp = v;
    else {
      std::fprintf(stderr, "unknown option %s\n", k.c_str());
      return 1;
    }
  }
  if (outp.empty() || N < 1 || batch < 1 || T < 0) {
    std::fprintf(stderr, "bad arguments\n");
    return 1;
  }
  std::filesystem::path p(outp);
  if (p.has_parent_path()) std::filesystem::create_directories(p.parent_path());
  FILE* out = std::fopen(outp.c_str(), "w");
  if (!out) {
    std::fprintf(stderr, "cannot write %s\n", outp.c_str());
    return 1;
  }
  int rc;
  if (mode == "ball") {
    rc = gen_ball(N, T, batch, seed, out);
  } else if (mode == "torus") {
    if (N < 3 || Mm < 3) {
      std::fprintf(stderr, "torus needs n, m >= 3\n");
      return 1;
    }
    rc = gen_torus(N, Mm, T, batch, seed, out);
  } else {
    std::fprintf(stderr, "unknown mode %s\n", mode.c_str());
    rc = 1;
  }
  std::fclose(out);
  return rc;
}
