// Dynamic reduced basis (SPEC 2): exact rank maintenance of B_1..B_3 under
// column insertion / deletion.
#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "column.hpp"
#include "complex.hpp"
#include "smallvec.hpp"

namespace mmhm {

// Returns the facet cell ids of a cell (used only by the invariant checker).
using FacetsFn = std::function<void(uint32_t cell, std::vector<uint32_t>& facets)>;

class Drb {
 public:
  explicit Drb(int maxdim);

  // ---- static build (SPEC 4, with V and occ) --------------------------------
  // cell2key: keys of the alive cells, a permutation of 0..nkeys-1;
  // cols[d]: alive cells of dimension d in increasing key order.
  // adds_per_cell (optional, indexed by cell id): additions spent on the
  // column of each cell (cleared columns: 0).
  void build(const Complex& cx, const std::vector<uint32_t>& cell2key, uint32_t nkeys,
             const std::vector<uint32_t> cols[4], std::vector<uint32_t>* adds_per_cell = nullptr);

  // ---- atomic edits ----------------------------------------------------------
  // Register a new cell c of dimension `dim` whose facets (cell ids, already
  // registered) are facets[0..nf). It receives a key larger than every key in
  // use. For dim >= 1 this is SPEC 2.1.
  void add_cell(uint32_t c, int dim, const uint32_t* facets, int nf);
  // Unregister cell c, which must have no cofaces (SPEC 2.2 for dim >= 1).
  void remove_cell(uint32_t c);

  // ---- queries ----------------------------------------------------------------
  uint64_t rank(int k) const { return (k >= 1 && k <= 3) ? rank_[k] : 0; }
  uint64_t nnz_R() const { return nnz_R_; }
  uint64_t nnz_V() const { return nnz_V_; }
  uint64_t live_slots(int k) const { return live_[k]; }
  uint32_t key_of(uint32_t c) const { return cell2key_[c]; }
  uint32_t cell_of(uint32_t key) const { return key2cell_[key]; }
  uint32_t next_key() const { return next_key_; }
  // Slot whose R has low = row_key, or NONE.
  uint32_t pivot_slot(uint32_t row_key) const { return pivot_[row_key]; }
  const SmallVec& R(int k, uint32_t j) const { return R_[k][j]; }
  const SmallVec& V(int k, uint32_t j) const { return V_[k][j]; }
  // Exact occ[c] (filtered, deduplicated); for tests and diagnostics.
  std::vector<uint32_t> occ_of(uint32_t c) const;

  // Cumulative counters (callers take differences per update).
  uint64_t chain_adds = 0;     // column additions (insert reductions + deletion eliminations)
  uint64_t footprint = 0;      // sum of |occ[sigma]| over deletions of dim >= 1 cells
  uint64_t case_a = 0, case_b = 0;
  uint64_t build_adds = 0;     // additions of the last build only

  // ---- invariants ----------------------------------------------------------------
  // Checks (I1) R_j = dV_j, (I2) distinct lows + pivot table, (I3) #slots = n_k
  // and (when n_k <= indep_limit) linear independence of the V_j by dense
  // elimination, plus consistency of occ / counters / key maps.
  // Returns "" if all hold, else a description of the first violation.
  std::string check(const FacetsFn& facets, size_t indep_limit = 512) const;
  // With MMHM_CHECKS defined, check() runs after every build/add/remove and
  // aborts on violation. Set the facet accessor used for that.
  void set_auto_check(FacetsFn f) { auto_facets_ = std::move(f); }

 private:
  uint32_t alloc_slot(int k);
  void free_slot(int k, uint32_t j);
  void xor_R(int k, uint32_t j, uint32_t src);
  void xor_V(int k, uint32_t j, uint32_t src);
  void occ_push(uint32_t cell, uint32_t j);
  void occ_compact(uint32_t cell);
  void ensure_cell(uint32_t c);
  void auto_check(const char* where) const;

  int D_;
  // per key
  std::vector<uint32_t> key2cell_;
  std::vector<uint32_t> pivot_;  // key of a (k-1)-cell -> slot of B_k with that low
  uint32_t next_key_ = 0;
  // per cell id
  std::vector<uint32_t> cell2key_;  // NONE if not registered
  std::vector<uint8_t> cell_dim_;
  std::vector<SmallVec> occ_;       // lazy: may contain stale/duplicate slot ids
  std::vector<uint32_t> occ_cnt_;   // exact |occ[c]|
  // per dimension k = 1..3
  std::vector<SmallVec> R_[4], V_[4];
  std::vector<uint32_t> free_[4];
  std::vector<uint32_t> stamp_[4];
  uint32_t epoch_ = 0;
  uint64_t rank_[4] = {0, 0, 0, 0};
  uint64_t live_[4] = {0, 0, 0, 0};
  uint64_t nnz_R_ = 0, nnz_V_ = 0;
  // Reduce a new column of B_k with boundary bd (sorted keys) and V = {s}
  // against the pivot table; result left in wr_ / wv_. Returns #additions.
  uint64_t reduce_new(int k, const uint32_t* bd, uint32_t nb, uint32_t s);
  // scratch
  WorkR wr_;
  WorkV wv_;
  Scratch ra_, va_;
  std::vector<uint32_t> added_, O_;
  FacetsFn auto_facets_;
};

}  // namespace mmhm
