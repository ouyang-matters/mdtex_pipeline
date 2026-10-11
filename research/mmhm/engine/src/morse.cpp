#include "morse.hpp"

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

  inP_.assign(cap, 0);
  if (cof_.size() < cap) cof_.resize(cap);
  queue_.clear();
  queue_.reserve(N + 16);

  // Sorted views; also mark membership and count cofaces.
  const std::vector<Complex::TupleEntry>* sorted[4] = {nullptr, nullptr, nullptr, nullptr};
  size_t remaining[4] = {0, 0, 0, 0};
  for (int d = 0; d <= D; ++d) {
    sorted[d] = &cx.cells_by_tuple(d);
    remaining[d] = sorted[d]->size();
    for (const auto& e : *sorted[d]) {
      inP_[e.c] = 1;
      cof_[e.c] = cx.cofaces(e.c).size();
    }
  }
  for (int d = 0; d <= D; ++d)
    for (const auto& e : *sorted[d])
      if (cof_[e.c] == 1) queue_.push_back(e.c);

  auto remove_cell = [&](uint32_t c) {
    inP_[c] = 0;
    --remaining[cx.dim(c)];
    out.removal.push_back(c);
    const uint32_t* f = cx.facets(c);
    const int nf = cx.num_facets(c);
    for (int i = 0; i < nf; ++i) {
      const uint32_t g = f[i];
      if (inP_[g] && --cof_[g] == 1) queue_.push_back(g);
    }
  };

  size_t head = 0;
  size_t cursor[4] = {0, 0, 0, 0};
  size_t left = N;
  while (true) {
    while (head < queue_.size()) {
      const uint32_t x = queue_[head++];
      if (!inP_[x] || cof_[x] != 1) continue;
      uint32_t y = NONE;
      for (uint32_t z : cx.cofaces(x))
        if (inP_[z]) {
          y = z;
          break;
        }
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
    while (!inP_[S[cursor[d]].c]) ++cursor[d];
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

}  // namespace mmhm
