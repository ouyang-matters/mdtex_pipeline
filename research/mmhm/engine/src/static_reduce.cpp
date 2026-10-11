#include "static_reduce.hpp"

#include <utility>

#include "morse.hpp"

namespace mmhm {

StaticResult StaticReducer::run(const Complex& cx, const std::vector<uint32_t>& cell2key,
                                uint32_t nkeys, const std::vector<uint32_t> cols[4]) {
  StaticResult res;
  pivot_.assign(nkeys, NONE);
  size_t used = 0;
  const int D = cx.maxdim();
  for (int k = D; k >= 1; --k) {
    const std::vector<uint32_t>& C = cols[k];
    if (store_.size() < used + C.size()) store_.resize(used + C.size());
    for (uint32_t c : C) {
      const uint32_t s = cell2key[c];
      if (pivot_[s] != NONE) continue;  // clearing: s is a pivot row of B_{k+1}
      const uint32_t* f = cx.facets(c);
      uint32_t r[4];
      for (int i = 0; i <= k; ++i) r[i] = cell2key[f[i]];
      sort_small(r, k + 1);
      wr_.reset(r, uint32_t(k + 1));
      uint32_t lo;
      while ((lo = wr_.low()) != NONE) {
        const uint32_t p = pivot_[lo];
        if (p == NONE) break;
        wr_.add(store_[p].data(), store_[p].size());
        ++res.adds;
      }
      const uint32_t nr = wr_.size();
      if (nr > 0) {
        store_[used].assign(wr_.data(), nr);
        pivot_[store_[used].back()] = uint32_t(used);
        ++used;
        ++res.rank[k];
        res.nnz_R += nr;
      }
    }
  }
  return res;
}

void FullIdOracle::betti(Complex& cx, int64_t b[4], StaticResult* out) {
  insertion_keys(cx, cell2key_, cols_);
  StaticResult r = red_.run(cx, cell2key_, uint32_t(cx.total()), cols_);
  betti_from_ranks(cx, r.rank, b);
  if (out) *out = r;
}

}  // namespace mmhm
