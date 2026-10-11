// Static reduction with clearing, ranks only (SPEC 4, FULL baselines).
#pragma once

#include <cstdint>
#include <vector>

#include "complex.hpp"
#include "smallvec.hpp"

namespace mmhm {

struct StaticResult {
  uint64_t rank[5] = {0, 0, 0, 0, 0};  // rank[k] = rank B_k (k = 1..3)
  uint64_t nnz_R = 0;                   // total entries of the non-zero reduced columns
  uint64_t adds = 0;                    // column additions performed
};

class StaticReducer {
 public:
  // cell2key: keys of all alive cells, a permutation of 0..nkeys-1 (only the
  // order within each dimension matters). cols[d]: alive cells of dimension d
  // in increasing key order. Processes k = D..1; a k-cell that is the low of
  // a reduced column of B_{k+1} is cleared (its column reduces to zero).
  StaticResult run(const Complex& cx, const std::vector<uint32_t>& cell2key, uint32_t nkeys,
                   const std::vector<uint32_t> cols[4]);

 private:
  std::vector<uint32_t> pivot_;  // row key -> index into store_
  std::vector<SmallVec> store_;  // non-zero reduced columns
  Scratch a_, b_;
};

// Betti numbers from n_k and ranks: b_k = n_k - r_k - r_{k+1}.
inline void betti_from_ranks(const Complex& cx, const uint64_t rank[5], int64_t b[4]) {
  for (int k = 0; k < 4; ++k)
    b[k] = int64_t(cx.n(k)) - int64_t(k >= 1 ? rank[k] : 0) - int64_t(k + 1 <= 3 ? rank[k + 1] : 0);
}

// Internal full-id recomputation (insertion order) used by --verify-every.
class FullIdOracle {
 public:
  void betti(Complex& cx, int64_t b[4], StaticResult* res = nullptr);

 private:
  StaticReducer red_;
  std::vector<uint32_t> cell2key_;
  std::vector<uint32_t> cols_[4];
};

}  // namespace mmhm
