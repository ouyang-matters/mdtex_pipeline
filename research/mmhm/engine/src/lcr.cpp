#include "lcr.hpp"

#include <algorithm>
#include <stdexcept>
#include <utility>

namespace mmhm {

void Lcr::ensure_cell(uint32_t c) {
  if (c >= cell2key_.size()) {
    const size_t n = std::max<size_t>(size_t(c) + 1, cell2key_.size() + cell2key_.size() / 2 + 16);
    cell2key_.resize(n, NONE);
    cell2slot_.resize(n, NONE);
    cell_dim_.resize(n, 0);
  }
}

void Lcr::reduce(int k, const uint32_t* bd, uint32_t nb) {
  wr_.reset(bd, nb);
  uint32_t lo;
  while ((lo = wr_.low()) != NONE) {
    const uint32_t p = pivot_[lo];
    if (p == NONE) break;
    wr_.add(R_[k][p].data(), R_[k][p].size());
    ++chain_adds;
  }
}

void Lcr::build(const Complex& cx, const std::vector<uint32_t>& cell2key, uint32_t nkeys,
                const std::vector<uint32_t> cols[4]) {
  pivot_.assign(nkeys, NONE);
  next_key_ = nkeys;
  const size_t cap = cx.capacity();
  cell2key_.assign(cap, NONE);
  cell2slot_.assign(cap, NONE);
  cell_dim_.assign(cap, 0);
  nnz_R_ = 0;
  for (int d = 0; d <= D_; ++d)
    for (uint32_t c : cols[d]) {
      cell2key_[c] = cell2key[c];
      cell_dim_[c] = uint8_t(d);
    }
  for (int k = 1; k <= 3; ++k) {
    std::vector<SmallVec>().swap(R_[k]);
    free_[k].clear();
    rank_[k] = 0;
  }
  for (int k = D_; k >= 1; --k) {
    const std::vector<uint32_t>& C = cols[k];
    R_[k].resize(C.size());
    for (size_t i = 0; i < C.size(); ++i) {
      const uint32_t c = C[i];
      cell2slot_[c] = uint32_t(i);
      const uint32_t s = cell2key_[c];
      if (k < D_ && pivot_[s] != NONE) continue;  // cleared: R = 0
      const uint32_t* f = cx.facets(c);
      uint32_t r[4];
      for (int t = 0; t <= k; ++t) r[t] = cell2key_[f[t]];
      sort_small(r, k + 1);
      reduce(k, r, uint32_t(k + 1));
      const uint32_t nr = wr_.size();
      R_[k][i].assign(wr_.data(), nr);
      nnz_R_ += nr;
      if (nr) {
        pivot_[R_[k][i].back()] = uint32_t(i);
        ++rank_[k];
      }
    }
  }
}

void Lcr::add_cell(uint32_t c, int dim, const uint32_t* facets, int nf) {
  if (next_key_ == NONE) throw std::runtime_error("order-key space exhausted");
  ensure_cell(c);
  const uint32_t s = next_key_++;
  pivot_.push_back(NONE);
  cell2key_[c] = s;
  cell_dim_[c] = uint8_t(dim);
  cell2slot_[c] = NONE;
  if (dim == 0) return;
  const int k = dim;
  uint32_t* r = a_.ensure(size_t(nf));
  for (int t = 0; t < nf; ++t) r[t] = cell2key_[facets[t]];
  if (nf <= 4)
    sort_small(r, nf);
  else
    std::sort(r, r + nf);
  reduce(k, r, uint32_t(nf));
  const uint32_t nr = wr_.size();
  uint32_t j;
  if (!free_[k].empty()) {
    j = free_[k].back();
    free_[k].pop_back();
  } else {
    j = uint32_t(R_[k].size());
    R_[k].emplace_back();
  }
  R_[k][j].assign(wr_.data(), nr);
  nnz_R_ += nr;
  cell2slot_[c] = j;
  if (nr) {
    pivot_[R_[k][j].back()] = j;
    ++rank_[k];
  }
}

void Lcr::remove_cell(uint32_t c) {
  const int k = cell_dim_[c];
  if (k >= 1) {
    const uint32_t j = cell2slot_[c];
    SmallVec& R = R_[k][j];
    if (!R.empty()) {
      pivot_[R.back()] = NONE;
      --rank_[k];
    }
    nnz_R_ -= R.size();
    R.release();
    free_[k].push_back(j);
  }
  cell2key_[c] = NONE;
  cell2slot_[c] = NONE;
}

}  // namespace mmhm
