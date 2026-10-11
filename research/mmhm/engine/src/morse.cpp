#include "morse.hpp"

#include <random>

namespace mmhm {

void MorseBuilder::compute(Complex& cx, MorseOrder& out, bool record_pairs) {
  const size_t cap = cx.capacity();
  const int D = cx.maxdim();
  out.removal.clear();
  out.pairs.clear();
  out.num_pairs = 0;
  for (int d = 0; d < 4; ++d) out.critical[d] = 0;
  const size_t N = cx.total();
  out.removal.reserve(N);

  node_.assign(cap, Node{0, 0});
  queue_.clear();
  queue_.reserve(N + 16);

  // Sorted views (lexicographic per dimension); mark P, then count cofaces.
  const std::vector<Complex::TupleEntry>* sorted[4] = {nullptr, nullptr, nullptr, nullptr};
  size_t remaining[4] = {0, 0, 0, 0};
  for (int d = 0; d <= D; ++d) {
    sorted[d] = &cx.cells_by_tuple(d);
    remaining[d] = sorted[d]->size();
    for (const auto& e : *sorted[d]) node_[e.c].cnt = kInP;
  }
  for (int d = 1; d <= D; ++d)
    for (const auto& e : *sorted[d]) {
      const uint32_t* f = cx.facets(e.c);
      for (int i = 0; i <= d; ++i) {
        Node& g = node_[f[i]];
        ++g.cnt;
        g.xr ^= e.c;
      }
    }
  for (int d = 0; d <= D; ++d)
    for (const auto& e : *sorted[d])
      if ((node_[e.c].cnt & ~kInP) == 1) queue_.push_back(e.c);

  auto remove_cell = [&](uint32_t c) {
    node_[c].cnt &= ~kInP;
    const int d = cx.dim(c);
    --remaining[d];
    out.removal.push_back(c);
    const uint32_t* f = cx.facets(c);
    for (int i = 0; i < (d ? d + 1 : 0); ++i) {
      Node& g = node_[f[i]];  // facets of a cell of P are in P (P is a subcomplex)
      g.xr ^= c;
      if ((--g.cnt & ~kInP) == 1) queue_.push_back(f[i]);
    }
  };

  size_t head = 0;
  size_t cursor[4] = {0, 0, 0, 0};
  size_t left = N;
  while (true) {
    while (head < queue_.size()) {
      const uint32_t x = queue_[head++];
      if (node_[x].cnt != (kInP | 1u)) continue;  // not in P, or not free
      const uint32_t y = node_[x].xr;               // the unique coface of x in P
      // y is maximal in P: P is always a subcomplex, so cof(y) = 0.
      if (record_pairs) out.pairs.emplace_back(x, y);
      ++out.num_pairs;
      remove_cell(y);  // rm(y) = t
      remove_cell(x);  // rm(x) = t + 1
      left -= 2;
    }
    if (left == 0) break;
    int d = D;
    while (d > 0 && remaining[d] == 0) --d;
    const std::vector<Complex::TupleEntry>& S = *sorted[d];
    while (!(node_[S[cursor[d]].c].cnt & kInP)) ++cursor[d];
    const uint32_t c = S[cursor[d]].c;
    ++out.critical[d];
    remove_cell(c);
    --left;
  }
}

void morse_keys(const Complex& cx, const MorseOrder& mo, std::vector<uint32_t>& cell2key,
                std::vector<uint32_t> cols[4]) {
  const size_t N = mo.removal.size();
  if (cell2key.size() < cx.capacity()) cell2key.resize(cx.capacity(), NONE);
  for (int d = 0; d < 4; ++d) {
    cols[d].clear();
    cols[d].reserve(cx.n(d));
  }
  for (size_t i = N; i-- > 0;) {
    const uint32_t c = mo.removal[i];
    cell2key[c] = uint32_t(N - 1 - i);
    cols[cx.dim(c)].push_back(c);
  }
}

void insertion_keys(Complex& cx, std::vector<uint32_t>& cell2key, std::vector<uint32_t> cols[4]) {
  if (cell2key.size() < cx.capacity()) cell2key.resize(cx.capacity(), NONE);
  uint32_t next = 0;
  for (int d = 0; d < 4; ++d) {
    cols[d].clear();
    if (d > cx.maxdim()) continue;
    cx.cells_by_insertion(d, cols[d]);
    for (uint32_t c : cols[d]) cell2key[c] = next++;
  }
}

void tuple_keys(Complex& cx, std::vector<uint32_t>& cell2key, std::vector<uint32_t> cols[4]) {
  if (cell2key.size() < cx.capacity()) cell2key.resize(cx.capacity(), NONE);
  uint32_t next = 0;
  for (int d = 0; d < 4; ++d) {
    cols[d].clear();
    if (d > cx.maxdim()) continue;
    const auto& t = cx.cells_by_tuple(d);
    cols[d].reserve(t.size());
    for (const auto& e : t) {
      cols[d].push_back(e.c);
      cell2key[e.c] = next++;
    }
  }
}

void random_keys(Complex& cx, std::vector<uint32_t>& cell2key, std::vector<uint32_t> cols[4],
                 uint64_t seed) {
  if (cell2key.size() < cx.capacity()) cell2key.resize(cx.capacity(), NONE);
  std::mt19937_64 rng(seed);
  uint32_t next = 0;
  for (int d = 0; d < 4; ++d) {
    cols[d].clear();
    if (d > cx.maxdim()) continue;
    for (const auto& e : cx.cells_by_tuple(d)) cols[d].push_back(e.c);
    // Fisher-Yates with the explicit generator (std::shuffle's distribution
    // use is implementation-defined; this is reproducible across libraries)
    for (size_t i = cols[d].size(); i > 1; --i) {
      const size_t j = size_t(rng() % i);
      std::swap(cols[d][i - 1], cols[d][j]);
    }
    for (uint32_t c : cols[d]) cell2key[c] = next++;
  }
}

}  // namespace mmhm
