// Open-addressing hash map: sorted vertex tuple (<= 4 vertices) -> cell id.
#pragma once

#include <cstdint>
#include <vector>

#include "smallvec.hpp"

namespace mmhm {

// A simplex key packs the sorted vertex tuple into 128 bits; unused trailing
// positions hold NONE (vertex id 0xFFFFFFFF is therefore reserved).
struct SKey {
  uint64_t a, b;
  bool operator==(const SKey& o) const { return a == o.a && b == o.b; }
  bool operator!=(const SKey& o) const { return !(*this == o); }
  bool operator<(const SKey& o) const { return a < o.a || (a == o.a && b < o.b); }
};

inline SKey make_skey(const uint32_t* v, int n) {
  uint32_t w[4] = {NONE, NONE, NONE, NONE};
  for (int i = 0; i < n; ++i) w[i] = v[i];
  return SKey{(uint64_t(w[0]) << 32) | w[1], (uint64_t(w[2]) << 32) | w[3]};
}

inline uint64_t mix64(uint64_t x) {
  x += 0x9E3779B97F4A7C15ull;
  x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ull;
  x = (x ^ (x >> 27)) * 0x94D049BB133111EBull;
  return x ^ (x >> 31);
}

class SimplexMap {
 public:
  SimplexMap() { rehash(64); }

  uint32_t find(const SKey& k) const {
    size_t i = home(k);
    while (true) {
      const Entry& e = tab_[i];
      if (e.val == NONE) return NONE;
      if (e.a == k.a && e.b == k.b) return e.val;
      i = (i + 1) & mask_;
    }
  }
  // Returns false (and does nothing) if k is already present.
  bool insert(const SKey& k, uint32_t val) {
    if ((size_ + 1) * 2 > tab_.size()) rehash(tab_.size() * 2);
    size_t i = home(k);
    while (true) {
      Entry& e = tab_[i];
      if (e.val == NONE) {
        e.a = k.a;
        e.b = k.b;
        e.val = val;
        ++size_;
        return true;
      }
      if (e.a == k.a && e.b == k.b) return false;
      i = (i + 1) & mask_;
    }
  }
  // Backward-shift deletion (no tombstones). Returns false if absent.
  bool erase(const SKey& k) {
    size_t i = home(k);
    while (true) {
      const Entry& e = tab_[i];
      if (e.val == NONE) return false;
      if (e.a == k.a && e.b == k.b) break;
      i = (i + 1) & mask_;
    }
    size_t j = i;
    while (true) {
      j = (j + 1) & mask_;
      if (tab_[j].val == NONE) break;
      size_t h = home(SKey{tab_[j].a, tab_[j].b});
      // Entry at j may move to i iff its home is not cyclically in (i, j].
      bool in_range = (i <= j) ? (i < h && h <= j) : (i < h || h <= j);
      if (in_range) continue;
      tab_[i] = tab_[j];
      i = j;
    }
    tab_[i].val = NONE;
    --size_;
    return true;
  }
  size_t size() const { return size_; }

 private:
  struct Entry {
    uint64_t a, b;
    uint32_t val;
  };
  size_t home(const SKey& k) const { return mix64(k.a ^ mix64(k.b)) & mask_; }
  void rehash(size_t cap) {
    std::vector<Entry> old;
    old.swap(tab_);
    tab_.assign(cap, Entry{0, 0, NONE});
    mask_ = cap - 1;
    size_ = 0;
    for (const Entry& e : old)
      if (e.val != NONE) insert(SKey{e.a, e.b}, e.val);
  }
  std::vector<Entry> tab_;
  size_t mask_ = 0, size_ = 0;
};

}  // namespace mmhm
