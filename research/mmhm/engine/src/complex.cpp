#include "complex.hpp"

#include <algorithm>

namespace mmhm {

std::string simplex_str(const uint32_t* v, int n) {
  std::string s = "[";
  for (int i = 0; i < n; ++i) {
    if (i) s += ' ';
    s += std::to_string(v[i]);
  }
  return s + "]";
}

Complex::Complex(int maxdim) : maxdim_(maxdim) {
  if (maxdim < 0 || maxdim > 3) throw std::invalid_argument("maxdim must be 0..3");
}

uint32_t Complex::insert(const uint32_t* v, int n) {
  if (n < 1 || n > maxdim_ + 1)
    throw EditError("insert " + simplex_str(v, n) + ": dimension out of range");
  const SKey k = make_skey(v, n);
  if (map_.find(k) != NONE) throw EditError("insert " + simplex_str(v, n) + ": already present");
  uint32_t fac[4] = {NONE, NONE, NONE, NONE};
  if (n > 1) {
    uint32_t w[3];
    for (int i = 0; i < n; ++i) {
      int m = 0;
      for (int j = 0; j < n; ++j)
        if (j != i) w[m++] = v[j];
      fac[i] = map_.find(make_skey(w, n - 1));
      if (fac[i] == NONE)
        throw EditError("insert " + simplex_str(v, n) + ": facet " + simplex_str(w, n - 1) +
                        " missing");
    }
  }
  uint32_t c;
  if (!free_ids_.empty()) {
    c = free_ids_.back();
    free_ids_.pop_back();
  } else {
    c = uint32_t(dim_.size());
    if (c == NONE) throw EditError("too many cells");
    dim_.push_back(0);
    alive_.push_back(0);
    verts_.push_back({NONE, NONE, NONE, NONE});
    facets_.push_back({NONE, NONE, NONE, NONE});
    cof_.emplace_back();
    ins_.push_back(0);
  }
  const int d = n - 1;
  dim_[c] = uint8_t(d);
  alive_[c] = 1;
  verts_[c] = {NONE, NONE, NONE, NONE};
  for (int i = 0; i < n; ++i) verts_[c][i] = v[i];
  facets_[c] = {fac[0], fac[1], fac[2], fac[3]};
  cof_[c].release();
  ins_[c] = ins_counter_++;
  for (int i = 0; i < (n > 1 ? n : 0); ++i) cof_[fac[i]].push_back(c);
  map_.insert(k, c);
  ++n_[d];
  if (ins_fresh_[d]) {
    ins_list_[d].push_back(InsEntry{c, ins_[c]});
    if (ins_removed_[d].size() > n_[d] + 1024) ins_compact(d);
  }
  if (tuple_fresh_[d]) {
    tuple_pending_[d].push_back(c);
    if (tuple_pending_[d].size() + tuple_removed_[d].size() > 4 * n_[d] + 65536) tuple_refresh(d);
  }
  return c;
}

uint32_t Complex::find_deletable(const uint32_t* v, int n) const {
  if (n < 1 || n > 4) throw EditError("delete " + simplex_str(v, n) + ": bad dimension");
  const uint32_t c = map_.find(make_skey(v, n));
  if (c == NONE) throw EditError("delete " + simplex_str(v, n) + ": not present");
  if (!cof_[c].empty())
    throw EditError("delete " + simplex_str(v, n) + ": still has " +
                    std::to_string(cof_[c].size()) + " cofaces");
  return c;
}

void Complex::remove(uint32_t c) {
  const int d = dim_[c];
  for (int i = 0; i < num_facets(c); ++i) cof_[facets_[c][i]].erase_unordered(c);
  map_.erase(key(c));
  if (ins_fresh_[d]) ins_removed_[d].push_back(ins_[c]);
  if (tuple_fresh_[d]) tuple_removed_[d].push_back(key(c));
  alive_[c] = 0;
  cof_[c].release();
  --n_[d];
  free_ids_.push_back(c);
}

// ---- insertion-order index ------------------------------------------------

void Complex::ins_compact(int d) {
  std::vector<uint64_t>& R = ins_removed_[d];
  if (R.empty()) return;
  std::sort(R.begin(), R.end());
  std::vector<InsEntry>& L = ins_list_[d];
  size_t w = 0, r = 0;
  for (size_t i = 0; i < L.size(); ++i) {
    while (r < R.size() && R[r] < L[i].ins) ++r;
    if (r < R.size() && R[r] == L[i].ins) continue;  // removed (ins values are unique)
    L[w++] = L[i];
  }
  L.resize(w);
  R.clear();
}

void Complex::ins_rebuild(int d) {
  std::vector<InsEntry>& L = ins_list_[d];
  L.clear();
  for (uint32_t c = 0; c < dim_.size(); ++c)
    if (alive_[c] && dim_[c] == d) L.push_back(InsEntry{c, ins_[c]});
  std::sort(L.begin(), L.end(), [](const InsEntry& a, const InsEntry& b) { return a.ins < b.ins; });
  ins_removed_[d].clear();
}

void Complex::cells_by_insertion(int d, std::vector<uint32_t>& out) {
  if (!ins_fresh_[d]) {
    ins_rebuild(d);
    ins_fresh_[d] = true;
  } else {
    ins_compact(d);
  }
  out.clear();
  out.reserve(ins_list_[d].size());
  for (const InsEntry& e : ins_list_[d]) out.push_back(e.c);
  if (!track_ins_) {
    std::vector<InsEntry>().swap(ins_list_[d]);
    ins_fresh_[d] = false;
  }
}

void Complex::set_track_insertion(bool on) {
  track_ins_ = on;
  if (!on)
    for (int d = 0; d < 4; ++d) {
      std::vector<InsEntry>().swap(ins_list_[d]);
      std::vector<uint64_t>().swap(ins_removed_[d]);
      ins_fresh_[d] = false;
    }
}

// ---- tuple-order index ----------------------------------------------------

void Complex::tuple_rebuild(int d) {
  std::vector<TupleEntry>& S = tuple_sorted_[d];
  S.clear();
  for (uint32_t c = 0; c < dim_.size(); ++c)
    if (alive_[c] && dim_[c] == d) S.push_back(TupleEntry{key(c), c});
  std::sort(S.begin(), S.end(), [](const TupleEntry& x, const TupleEntry& y) { return x.k < y.k; });
  tuple_removed_[d].clear();
  tuple_pending_[d].clear();
}

// S := (S minus every key removed since the last refresh) merged with the
// still-alive cells inserted since then. An S entry whose key was removed is
// dropped even if the simplex was re-inserted: the re-insertion is in the
// pending list with its current id. Pending ids that died, or were reused
// for another simplex, are resolved by reading their current state.
void Complex::tuple_refresh(int d) {
  std::vector<TupleEntry>& S = tuple_sorted_[d];
  std::vector<SKey>& R = tuple_removed_[d];
  std::vector<uint32_t>& P = tuple_pending_[d];
  if (R.empty() && P.empty()) return;
  if (!R.empty()) {
    std::sort(R.begin(), R.end());
    size_t w = 0, r = 0;
    for (size_t i = 0; i < S.size(); ++i) {
      while (r < R.size() && R[r] < S[i].k) ++r;
      if (r < R.size() && R[r] == S[i].k) continue;
      S[w++] = S[i];
    }
    S.resize(w);
    R.clear();
  }
  if (!P.empty()) {
    std::vector<TupleEntry> add;
    add.reserve(P.size());
    for (uint32_t c : P)
      if (alive_[c] && dim_[c] == d) add.push_back(TupleEntry{key(c), c});
    P.clear();
    auto lt = [](const TupleEntry& x, const TupleEntry& y) { return x.k < y.k; };
    std::sort(add.begin(), add.end(), lt);
    size_t m = 0;
    for (size_t i = 0; i < add.size(); ++i)
      if (m == 0 || add[m - 1].k != add[i].k) add[m++] = add[i];
    add.resize(m);
    const size_t old = S.size();
    S.resize(old + add.size());
    // in-place merge from the back
    size_t i = old, j = add.size(), o = S.size();
    while (j > 0) {
      if (i > 0 && add[j - 1].k < S[i - 1].k)
        S[--o] = S[--i];
      else
        S[--o] = add[--j];
    }
  }
}

const std::vector<Complex::TupleEntry>& Complex::cells_by_tuple(int d) {
  if (!tuple_fresh_[d]) {
    tuple_rebuild(d);
    tuple_fresh_[d] = track_tuple_;
  } else {
    tuple_refresh(d);
  }
  return tuple_sorted_[d];
}

void Complex::set_track_tuples(bool on) {
  track_tuple_ = on;
  if (!on)
    for (int d = 0; d < 4; ++d) {
      std::vector<SKey>().swap(tuple_removed_[d]);
      std::vector<uint32_t>().swap(tuple_pending_[d]);
      tuple_fresh_[d] = false;
    }
}

}  // namespace mmhm
