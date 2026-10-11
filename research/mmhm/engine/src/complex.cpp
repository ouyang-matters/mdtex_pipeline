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
  ins_list_[d].push_back(InsEntry{c, ins_[c]});
  tuple_pending_[d].push_back(c);
  // Keep the lazy order indices O(n_d): compact once dead entries dominate.
  if (ins_list_[d].size() > 2 * n_[d] + 1024) {
    std::vector<uint32_t> tmp;
    cells_by_insertion(d, tmp);
  }
  if (tuple_pending_[d].size() > 2 * n_[d] + 1024) cells_by_tuple(d);
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
  alive_[c] = 0;
  cof_[c].release();
  --n_[d];
  free_ids_.push_back(c);
}

void Complex::cells_by_insertion(int d, std::vector<uint32_t>& out) {
  out.clear();
  std::vector<InsEntry>& L = ins_list_[d];
  size_t w = 0;
  for (size_t i = 0; i < L.size(); ++i) {
    const InsEntry e = L[i];
    if (alive_[e.c] && ins_[e.c] == e.ins) {
      L[w++] = e;
      out.push_back(e.c);
    }
  }
  L.resize(w);
}

const std::vector<Complex::TupleEntry>& Complex::cells_by_tuple(int d) {
  std::vector<TupleEntry>& S = tuple_sorted_[d];
  std::vector<uint32_t>& P = tuple_pending_[d];
  // Drop entries of dead cells or of ids reused for another simplex.
  size_t w = 0;
  for (size_t i = 0; i < S.size(); ++i) {
    const TupleEntry& e = S[i];
    if (alive_[e.c] && dim_[e.c] == d && key(e.c) == e.k) S[w++] = e;
  }
  S.resize(w);
  if (!P.empty()) {
    std::vector<TupleEntry> add;
    add.reserve(P.size());
    for (uint32_t c : P)
      if (alive_[c] && dim_[c] == d) add.push_back(TupleEntry{key(c), c});
    P.clear();
    auto lt = [](const TupleEntry& x, const TupleEntry& y) { return x.k < y.k; };
    std::sort(add.begin(), add.end(), lt);
    std::vector<TupleEntry> merged;
    merged.reserve(S.size() + add.size());
    std::merge(S.begin(), S.end(), add.begin(), add.end(), std::back_inserter(merged), lt);
    // A simplex deleted and re-inserted under the same id appears twice.
    size_t m = 0;
    for (size_t i = 0; i < merged.size(); ++i)
      if (m == 0 || merged[m - 1].k != merged[i].k) merged[m++] = merged[i];
    merged.resize(m);
    S.swap(merged);
  }
  return S;
}

}  // namespace mmhm
