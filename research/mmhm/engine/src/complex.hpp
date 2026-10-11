// Simplicial complex store: simplex -> cell id, per-cell facets/cofaces.
#pragma once

#include <array>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

#include "simplex_map.hpp"
#include "smallvec.hpp"

namespace mmhm {

// Thrown for an invalid atomic edit (closure violation, duplicate, ...).
struct EditError : std::runtime_error {
  using std::runtime_error::runtime_error;
};

std::string simplex_str(const uint32_t* v, int n);

class Complex {
 public:
  explicit Complex(int maxdim);

  int maxdim() const { return maxdim_; }

  // Atomic insertion; validates (absent, every facet present, dim <= maxdim)
  // and throws EditError otherwise. `v` must be sorted. Returns the cell id.
  uint32_t insert(const uint32_t* v, int n);
  // Lookup for an atomic deletion; throws EditError if absent or if the
  // simplex still has cofaces. Does not modify the complex.
  uint32_t find_deletable(const uint32_t* v, int n) const;
  // Plain lookup (NONE if absent).
  uint32_t find(const uint32_t* v, int n) const { return map_.find(make_skey(v, n)); }
  // Removes cell c (must have no cofaces). The id may be reused later.
  void remove(uint32_t c);

  // Per-cell accessors (c must be alive unless stated).
  int dim(uint32_t c) const { return dim_[c]; }
  bool alive(uint32_t c) const { return c < alive_.size() && alive_[c]; }
  const uint32_t* verts(uint32_t c) const { return verts_[c].data(); }
  // Facet cell ids; facet i omits vertex i. dim(c)+1 facets for dim >= 1.
  const uint32_t* facets(uint32_t c) const { return facets_[c].data(); }
  int num_facets(uint32_t c) const { return dim_[c] == 0 ? 0 : dim_[c] + 1; }
  const SmallVec& cofaces(uint32_t c) const { return cof_[c]; }
  uint64_t ins(uint32_t c) const { return ins_[c]; }
  SKey key(uint32_t c) const { return make_skey(verts_[c].data(), dim_[c] + 1); }

  size_t n(int d) const { return n_[d]; }
  size_t total() const { return n_[0] + n_[1] + n_[2] + n_[3]; }
  // One past the largest cell id ever handed out (size for per-cell arrays).
  size_t capacity() const { return dim_.size(); }

  // Alive cells of dimension d in increasing insertion order.
  void cells_by_insertion(int d, std::vector<uint32_t>& out);

  struct TupleEntry {
    SKey k;
    uint32_t c;
  };
  // Alive cells of dimension d sorted lexicographically by vertex tuple.
  const std::vector<TupleEntry>& cells_by_tuple(int d);

  // The two order indices above are maintained incrementally (sequential
  // merge of the edits since the last query) while tracking is on; with
  // tracking off they cost nothing per edit and are rebuilt by a full sort
  // on the next query. Both default to on.
  void set_track_insertion(bool on);
  void set_track_tuples(bool on);

 private:
  int maxdim_;
  SimplexMap map_;
  std::vector<uint8_t> dim_;
  std::vector<uint8_t> alive_;
  std::vector<std::array<uint32_t, 4>> verts_;
  std::vector<std::array<uint32_t, 4>> facets_;
  std::vector<SmallVec> cof_;
  std::vector<uint64_t> ins_;
  std::vector<uint32_t> free_ids_;
  size_t n_[4] = {0, 0, 0, 0};
  uint64_t ins_counter_ = 0;

  struct InsEntry {
    uint32_t c;
    uint64_t ins;
  };
  void ins_compact(int d);
  void ins_rebuild(int d);
  void tuple_refresh(int d);
  void tuple_rebuild(int d);

  // Insertion index: entries sorted by ins; ins values removed since the
  // last compaction are dropped by a sequential merge.
  bool track_ins_ = true;
  bool ins_fresh_[4] = {true, true, true, true};
  std::vector<InsEntry> ins_list_[4];
  std::vector<uint64_t> ins_removed_[4];
  // Tuple index: entries sorted by key; keys removed and ids inserted since
  // the last refresh are merged sequentially.
  bool track_tuple_ = true;
  bool tuple_fresh_[4] = {true, true, true, true};
  std::vector<TupleEntry> tuple_sorted_[4];
  std::vector<SKey> tuple_removed_[4];
  std::vector<uint32_t> tuple_pending_[4];
};

}  // namespace mmhm
