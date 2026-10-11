// lcr: v1's localized column re-reduction WITHOUT basis tracking (SPEC 0 E1,
// SPEC 5). Intentionally inexact; used only to measure the error rate.
#pragma once

#include <cstdint>
#include <vector>

#include "complex.hpp"
#include "smallvec.hpp"

namespace mmhm {

class Lcr {
 public:
  explicit Lcr(int maxdim) : D_(maxdim) {}

  // Static reduction with clearing keeping only R per column (cleared
  // columns get R = 0). Same inputs as Drb::build.
  void build(const Complex& cx, const std::vector<uint32_t>& cell2key, uint32_t nkeys,
             const std::vector<uint32_t> cols[4]);
  // Insert: reduce the new column against the current pivots; if non-zero,
  // it takes the pivot of its low. New cell gets a key larger than all keys.
  void add_cell(uint32_t c, int dim, const uint32_t* facets, int nf);
  // Delete: if R_c != 0 free pivot[low(R_c)]; drop R_c; nothing else.
  void remove_cell(uint32_t c);

  uint64_t rank(int k) const { return (k >= 1 && k <= 3) ? rank_[k] : 0; }
  uint64_t nnz_R() const { return nnz_R_; }
  uint64_t chain_adds = 0;

 private:
  int D_;
  std::vector<uint32_t> pivot_;  // by key -> slot
  uint32_t next_key_ = 0;
  std::vector<uint32_t> cell2key_, cell2slot_;
  std::vector<uint8_t> cell_dim_;
  std::vector<SmallVec> R_[4];
  std::vector<uint32_t> free_[4];
  uint64_t rank_[4] = {0, 0, 0, 0};
  uint64_t nnz_R_ = 0;
  Scratch a_, b_;
  void ensure_cell(uint32_t c);
  uint32_t reduce(int k, uint32_t nr);
};

}  // namespace mmhm
