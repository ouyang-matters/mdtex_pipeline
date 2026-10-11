#include "drb.hpp"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <sstream>
#include <stdexcept>
#include <unordered_map>
#include <utility>

namespace mmhm {

Drb::Drb(int maxdim) : D_(maxdim) {}

void Drb::ensure_cell(uint32_t c) {
  if (c >= cell2key_.size()) {
    const size_t n = std::max<size_t>(size_t(c) + 1, cell2key_.size() + cell2key_.size() / 2 + 16);
    cell2key_.resize(n, NONE);
    cell_dim_.resize(n, 0);
    occ_.resize(n);
    occ_cnt_.resize(n, 0);
  }
}

uint64_t Drb::reduce_new(int k, const uint32_t* bd, uint32_t nb, uint32_t s) {
  wr_.reset(bd, nb);
  wv_.reset(s);
  const std::vector<SmallVec>& Rk = R_[k];
  const std::vector<SmallVec>& Vk = V_[k];
  uint64_t adds = 0;
  uint32_t lo;
  while ((lo = wr_.low()) != NONE) {
    const uint32_t p = pivot_[lo];
    if (p == NONE) break;
    wr_.add(Rk[p].data(), Rk[p].size());
    wv_.add(Vk[p].data(), Vk[p].size());
    ++adds;
  }
  return adds;
}

void Drb::build(const Complex& cx, const std::vector<uint32_t>& cell2key, uint32_t nkeys,
                const std::vector<uint32_t> cols[4], std::vector<uint32_t>* adds_per_cell) {
  key2cell_.assign(nkeys, NONE);
  pivot_.assign(nkeys, NONE);
  next_key_ = nkeys;
  const size_t cap = cx.capacity();
  cell2key_.assign(cap, NONE);
  cell_dim_.assign(cap, 0);
  for (SmallVec& o : occ_) o.release();
  occ_.resize(cap);
  occ_cnt_.assign(cap, 0);
  for (int d = 0; d <= D_; ++d)
    for (uint32_t c : cols[d]) {
      const uint32_t s = cell2key[c];
      key2cell_[s] = c;
      cell2key_[c] = s;
      cell_dim_[c] = uint8_t(d);
    }
  nnz_R_ = nnz_V_ = 0;
  build_adds = 0;
  if (adds_per_cell) adds_per_cell->assign(cap, 0);
  for (int k = 1; k <= 3; ++k) {
    std::vector<SmallVec>().swap(R_[k]);
    std::vector<SmallVec>().swap(V_[k]);
    free_[k].clear();
    stamp_[k].clear();
    rank_[k] = 0;
    live_[k] = 0;
  }
  epoch_ = 0;

  for (int k = D_; k >= 1; --k) {
    const std::vector<uint32_t>& C = cols[k];
    const size_t n = C.size();
    std::vector<SmallVec>& Rk = R_[k];
    std::vector<SmallVec>& Vk = V_[k];
    Rk.resize(n);
    Vk.resize(n);
    stamp_[k].assign(n, 0);
    for (size_t i = 0; i < n; ++i) {
      const uint32_t c = C[i];
      const uint32_t s = cell2key_[c];
      if (k < D_ && pivot_[s] != NONE) {
        // Clearing: s = low(R_q) for a reduced column q of B_{k+1}. Then
        // R_s := 0 and V_s := R_q, a boundary with low(V_s) = s.
        const SmallVec& Rq = R_[k + 1][pivot_[s]];
        Vk[i].assign(Rq.data(), Rq.size());
        nnz_V_ += Rq.size();
        continue;
      }
      const uint32_t* f = cx.facets(c);
      uint32_t r[4];
      for (int t = 0; t <= k; ++t) r[t] = cell2key_[f[t]];
      sort_small(r, k + 1);
      const uint64_t a = reduce_new(k, r, uint32_t(k + 1), s);
      build_adds += a;
      if (adds_per_cell) (*adds_per_cell)[c] = uint32_t(a);
      const uint32_t nr = wr_.size(), nv = wv_.size();
      Rk[i].assign(wr_.data(), nr);
      Vk[i].assign(wv_.data(), nv);
      nnz_R_ += nr;
      nnz_V_ += nv;
      if (nr) {
        pivot_[Rk[i].back()] = uint32_t(i);
        ++rank_[k];
      }
    }
    live_[k] = n;
  }
  for (int k = 1; k <= D_; ++k) {
    const std::vector<SmallVec>& Vk = V_[k];
    for (uint32_t j = 0; j < Vk.size(); ++j)
      for (uint32_t e : Vk[j]) {
        const uint32_t cell = key2cell_[e];
        occ_[cell].push_back(j);
        ++occ_cnt_[cell];
      }
  }
  chain_adds += build_adds;
  auto_check("build");
}

uint32_t Drb::alloc_slot(int k) {
  uint32_t j;
  if (!free_[k].empty()) {
    j = free_[k].back();
    free_[k].pop_back();
  } else {
    j = uint32_t(R_[k].size());
    R_[k].emplace_back();
    V_[k].emplace_back();
    stamp_[k].push_back(0);
  }
  ++live_[k];
  return j;
}

void Drb::free_slot(int k, uint32_t j) {
  SmallVec& Vj = V_[k][j];
  SmallVec& Rj = R_[k][j];
  for (uint32_t e : Vj) --occ_cnt_[key2cell_[e]];
  nnz_V_ -= Vj.size();
  nnz_R_ -= Rj.size();
  Vj.release();
  Rj.release();
  free_[k].push_back(j);
  --live_[k];
}

void Drb::occ_push(uint32_t cell, uint32_t j) {
  SmallVec& L = occ_[cell];
  L.push_back(j);
  ++occ_cnt_[cell];
  if (L.size() > 2 * occ_cnt_[cell] + 8) occ_compact(cell);
}

// Drop stale and duplicate entries of the lazy occ list of `cell`: an entry
// j is kept iff slot j currently has the cell's key in V_j.
void Drb::occ_compact(uint32_t cell) {
  const int k = cell_dim_[cell];
  const uint32_t s = cell2key_[cell];
  if (++epoch_ == 0) {
    for (int d = 1; d <= 3; ++d) std::fill(stamp_[d].begin(), stamp_[d].end(), 0);
    epoch_ = 1;
  }
  SmallVec& L = occ_[cell];
  const std::vector<SmallVec>& Vk = V_[k];
  std::vector<uint32_t>& st = stamp_[k];
  uint32_t w = 0;
  for (uint32_t i = 0; i < L.size(); ++i) {
    const uint32_t j = L[i];
    if (j < Vk.size() && st[j] != epoch_ && Vk[j].contains_sorted(s)) {
      st[j] = epoch_;
      L[w++] = j;
    }
  }
  L.resize_down(w);
  if (L.capacity() > 4 * w + 16) L.shrink_to_fit();
}

void Drb::xor_R(int k, uint32_t j, uint32_t src) {
  const SmallVec& Rs = R_[k][src];
  SmallVec& Rj = R_[k][j];
  uint32_t* out = ra_.ensure(size_t(Rj.size()) + Rs.size());
  const uint32_t n = xor_merge(Rj.data(), Rj.size(), Rs.data(), Rs.size(), out);
  nnz_R_ += n;
  nnz_R_ -= Rj.size();
  Rj.assign(out, n);
}

// V_j ^= V_src, keeping occ consistent: entries that leave V_j decrement the
// exact counter (their occ list entry becomes stale); entries that join V_j
// are pushed to the occ list after V_j is final.
void Drb::xor_V(int k, uint32_t j, uint32_t src) {
  const SmallVec& Vs = V_[k][src];
  SmallVec& Vj = V_[k][j];
  const uint32_t na = Vj.size(), nb = Vs.size();
  const uint32_t* a = Vj.data();
  const uint32_t* b = Vs.data();
  uint32_t* out = va_.ensure(size_t(na) + nb);
  added_.clear();
  uint32_t i = 0, l = 0, n = 0;
  while (i < na && l < nb) {
    const uint32_t x = a[i], y = b[l];
    if (x < y) {
      out[n++] = x;
      ++i;
    } else if (y < x) {
      out[n++] = y;
      added_.push_back(y);
      ++l;
    } else {
      --occ_cnt_[key2cell_[x]];
      ++i;
      ++l;
    }
  }
  while (i < na) out[n++] = a[i++];
  while (l < nb) {
    out[n++] = b[l];
    added_.push_back(b[l]);
    ++l;
  }
  nnz_V_ += n;
  nnz_V_ -= na;
  Vj.assign(out, n);
  for (uint32_t e : added_) occ_push(key2cell_[e], j);
}

void Drb::add_cell(uint32_t c, int dim, const uint32_t* facets, int nf) {
  if (next_key_ == NONE) throw std::runtime_error("order-key space exhausted");
  ensure_cell(c);
  const uint32_t s = next_key_++;
  key2cell_.push_back(c);
  pivot_.push_back(NONE);
  cell2key_[c] = s;
  cell_dim_[c] = uint8_t(dim);
  occ_[c].release();
  occ_cnt_[c] = 0;
  if (dim >= 1) {
    const int k = dim;
    uint32_t* r = ra_.ensure(size_t(nf));
    for (int t = 0; t < nf; ++t) r[t] = cell2key_[facets[t]];
    if (nf <= 4)
      sort_small(r, nf);
    else
      std::sort(r, r + nf);
    chain_adds += reduce_new(k, r, uint32_t(nf), s);
    const uint32_t nr = wr_.size(), nv = wv_.size();
    const uint32_t j = alloc_slot(k);
    R_[k][j].assign(wr_.data(), nr);
    V_[k][j].assign(wv_.data(), nv);
    nnz_R_ += nr;
    nnz_V_ += nv;
    for (uint32_t e : V_[k][j]) occ_push(key2cell_[e], j);
    if (nr) {
      pivot_[R_[k][j].back()] = j;
      ++rank_[k];
    }
  }
  auto_check("add_cell");
}

void Drb::remove_cell(uint32_t c) {
  const int k = cell_dim_[c];
  const uint32_t s = cell2key_[c];
  if (k >= 1) {
    // O := occ[sigma], exact (filter the lazy list).
    if (++epoch_ == 0) {
      for (int d = 1; d <= 3; ++d) std::fill(stamp_[d].begin(), stamp_[d].end(), 0);
      epoch_ = 1;
    }
    O_.clear();
    {
      const SmallVec& L = occ_[c];
      const std::vector<SmallVec>& Vk = V_[k];
      std::vector<uint32_t>& st = stamp_[k];
      for (uint32_t j : L)
        if (j < Vk.size() && st[j] != epoch_ && Vk[j].contains_sorted(s)) {
          st[j] = epoch_;
          O_.push_back(j);
        }
    }
    if (O_.empty()) throw std::logic_error("DRB: occ of a deleted cell is empty (I3 violated)");
    footprint += O_.size();
    std::vector<SmallVec>& Rk = R_[k];
    std::vector<SmallVec>& Vk = V_[k];
    // Case A: some slot containing sigma is a cycle; pick the shortest.
    uint32_t z = NONE;
    for (uint32_t j : O_)
      if (Rk[j].empty() &&
          (z == NONE || Vk[j].size() < Vk[z].size() || (Vk[j].size() == Vk[z].size() && j < z)))
        z = j;
    if (z != NONE) {
      ++case_a;
      for (uint32_t j : O_)
        if (j != z) {
          xor_V(k, j, z);  // R_j unchanged since dV_z = 0
          ++chain_adds;
        }
      free_slot(k, z);
    } else {
      // Case B: every slot containing sigma has R != 0; p = the one with the
      // smallest low, so adding R_p keeps every other low unchanged.
      ++case_b;
      uint32_t p = O_[0];
      for (uint32_t j : O_)
        if (Rk[j].back() < Rk[p].back()) p = j;
      for (uint32_t j : O_)
        if (j != p) {
          xor_R(k, j, p);
          xor_V(k, j, p);
          ++chain_adds;
        }
      pivot_[Rk[p].back()] = NONE;
      --rank_[k];
      free_slot(k, p);
    }
    occ_[c].release();
    if (occ_cnt_[c] != 0) throw std::logic_error("DRB: deleted cell still occurs in some V");
  }
  key2cell_[s] = NONE;
  cell2key_[c] = NONE;
  auto_check("remove_cell");
}

std::vector<uint32_t> Drb::occ_of(uint32_t c) const {
  std::vector<uint32_t> out;
  const int k = cell_dim_[c];
  const uint32_t s = cell2key_[c];
  if (k < 1 || s == NONE) return out;
  for (uint32_t j : occ_[c])
    if (j < V_[k].size() && V_[k][j].contains_sorted(s)) out.push_back(j);
  std::sort(out.begin(), out.end());
  out.erase(std::unique(out.begin(), out.end()), out.end());
  return out;
}

void Drb::auto_check(const char* where) const {
#ifdef MMHM_CHECKS
  if (!auto_facets_) return;
  const std::string e = check(auto_facets_);
  if (!e.empty()) {
    std::fprintf(stderr, "DRB invariant violated after %s: %s\n", where, e.c_str());
    std::abort();
  }
#else
  (void)where;
#endif
}

namespace {

// Rank of a set of GF(2) vectors given as index lists over [0, ncols).
size_t dense_rank(const std::vector<std::vector<uint32_t>>& rows, size_t ncols) {
  const size_t W = (ncols + 63) / 64;
  std::vector<std::vector<uint64_t>> m(rows.size(), std::vector<uint64_t>(W, 0));
  for (size_t i = 0; i < rows.size(); ++i)
    for (uint32_t x : rows[i]) m[i][x / 64] ^= uint64_t(1) << (x % 64);
  size_t rank = 0;
  for (size_t col = 0; col < ncols && rank < m.size(); ++col) {
    const size_t w = col / 64;
    const uint64_t bit = uint64_t(1) << (col % 64);
    size_t piv = rank;
    while (piv < m.size() && !(m[piv][w] & bit)) ++piv;
    if (piv == m.size()) continue;
    std::swap(m[piv], m[rank]);
    for (size_t i = 0; i < m.size(); ++i)
      if (i != rank && (m[i][w] & bit))
        for (size_t t = 0; t < W; ++t) m[i][t] ^= m[rank][t];
    ++rank;
  }
  return rank;
}

}  // namespace

std::string Drb::check(const FacetsFn& facets, size_t indep_limit) const {
  std::ostringstream err;
  size_t ncells[4] = {0, 0, 0, 0};
  for (uint32_t c = 0; c < cell2key_.size(); ++c) {
    const uint32_t s = cell2key_[c];
    if (s == NONE) continue;
    if (s >= next_key_ || key2cell_[s] != c) {
      err << "cell " << c << " key map inconsistent";
      return err.str();
    }
    ++ncells[cell_dim_[c]];
  }
  for (uint32_t s = 0; s < key2cell_.size(); ++s) {
    const uint32_t c = key2cell_[s];
    if (c != NONE && (c >= cell2key_.size() || cell2key_[c] != s)) {
      err << "key " << s << " maps to cell " << c << " which does not map back";
      return err.str();
    }
    if (pivot_[s] != NONE) {
      if (c == NONE) {
        err << "pivot entry on unregistered key " << s;
        return err.str();
      }
      const int k = cell_dim_[c] + 1;
      if (k > D_ || pivot_[s] >= R_[k].size() || R_[k][pivot_[s]].empty() ||
          R_[k][pivot_[s]].back() != s) {
        err << "(I2) pivot[" << s << "] does not point to a slot with that low";
        return err.str();
      }
    }
  }
  std::vector<uint32_t> cnt(cell2key_.size(), 0);
  std::vector<uint32_t> f, bd, keys, tmp;
  uint64_t nnzR = 0, nnzV = 0;
  for (int k = 1; k <= D_; ++k) {
    size_t live = 0, rk = 0;
    for (uint32_t j = 0; j < V_[k].size(); ++j) {
      const SmallVec& R = R_[k][j];
      const SmallVec& V = V_[k][j];
      if (V.empty()) {
        if (!R.empty()) {
          err << "dim " << k << " slot " << j << ": empty V but non-empty R";
          return err.str();
        }
        continue;
      }
      ++live;
      for (uint32_t t = 0; t < V.size(); ++t) {
        const uint32_t e = V[t];
        if ((t && V[t - 1] >= e) || e >= key2cell_.size() || key2cell_[e] == NONE ||
            cell_dim_[key2cell_[e]] != k) {
          err << "dim " << k << " slot " << j << ": V not a sorted chain of live " << k << "-cells";
          return err.str();
        }
      }
      for (uint32_t t = 0; t < R.size(); ++t) {
        const uint32_t e = R[t];
        if ((t && R[t - 1] >= e) || e >= key2cell_.size() || key2cell_[e] == NONE ||
            cell_dim_[key2cell_[e]] != k - 1) {
          err << "dim " << k << " slot " << j << ": R not a sorted chain of live " << (k - 1)
              << "-cells";
          return err.str();
        }
      }
      // (I1) R_j = boundary of V_j
      bd.clear();
      for (uint32_t e : V) {
        facets(key2cell_[e], f);
        keys.clear();
        for (uint32_t g : f) keys.push_back(cell2key_[g]);
        std::sort(keys.begin(), keys.end());
        tmp.resize(bd.size() + keys.size());
        tmp.resize(xor_merge(bd.data(), uint32_t(bd.size()), keys.data(), uint32_t(keys.size()),
                             tmp.data()));
        bd.swap(tmp);
      }
      if (bd.size() != R.size() || !std::equal(bd.begin(), bd.end(), R.begin())) {
        err << "(I1) dim " << k << " slot " << j << ": R != boundary(V)";
        return err.str();
      }
      if (!R.empty()) {
        ++rk;
        if (pivot_[R.back()] != j) {
          err << "(I2) dim " << k << " slot " << j << ": low not owned in pivot table";
          return err.str();
        }
      }
      for (uint32_t e : V) {
        const uint32_t cell = key2cell_[e];
        ++cnt[cell];
        if (std::find(occ_[cell].begin(), occ_[cell].end(), j) == occ_[cell].end()) {
          err << "occ[" << cell << "] misses slot " << j << " (dim " << k << ")";
          return err.str();
        }
      }
      nnzR += R.size();
      nnzV += V.size();
    }
    if (live != live_[k]) {
      err << "dim " << k << ": live slot counter " << live_[k] << " != " << live;
      return err.str();
    }
    if (live != ncells[k]) {
      err << "(I3) dim " << k << ": #slots " << live << " != n_k " << ncells[k];
      return err.str();
    }
    if (rk != rank_[k]) {
      err << "dim " << k << ": rank counter " << rank_[k] << " != " << rk;
      return err.str();
    }
    if (ncells[k] <= indep_limit) {
      std::unordered_map<uint32_t, uint32_t> idx;
      for (uint32_t c = 0; c < cell2key_.size(); ++c)
        if (cell2key_[c] != NONE && cell_dim_[c] == k) idx.emplace(cell2key_[c], uint32_t(idx.size()));
      std::vector<std::vector<uint32_t>> rows;
      for (uint32_t j = 0; j < V_[k].size(); ++j) {
        if (V_[k][j].empty()) continue;
        rows.emplace_back();
        for (uint32_t e : V_[k][j]) rows.back().push_back(idx.at(e));
      }
      if (dense_rank(rows, idx.size()) != idx.size()) {
        err << "(I3) dim " << k << ": the V_j are linearly dependent";
        return err.str();
      }
    }
  }
  for (uint32_t c = 0; c < cell2key_.size(); ++c)
    if (cell2key_[c] != NONE && cell_dim_[c] >= 1 && cnt[c] != occ_cnt_[c]) {
      err << "occ counter of cell " << c << " is " << occ_cnt_[c] << ", true " << cnt[c];
      return err.str();
    }
  if (nnzR != nnz_R_ || nnzV != nnz_V_) {
    err << "nnz counters (" << nnz_R_ << "," << nnz_V_ << ") != (" << nnzR << "," << nnzV << ")";
    return err.str();
  }
  return std::string();
}

}  // namespace mmhm
