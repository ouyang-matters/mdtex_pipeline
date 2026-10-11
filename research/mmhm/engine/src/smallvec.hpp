// Small-buffer vector of uint32 and sorted-set (Z2 chain) primitives.
#pragma once

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <new>
#include <vector>

namespace mmhm {

constexpr uint32_t NONE = 0xFFFFFFFFu;

// A vector of uint32 with 4 inline elements (sizeof == 24, same as
// std::vector) so that the common short chains (boundaries of simplices,
// apparent-pair V columns, coface lists, occ lists) never touch the heap.
//
// Used in two roles:
//  * as a Z2 chain: entries are order keys, strictly increasing, so
//    back() is low(c) and XOR is a linear merge;
//  * as an unordered bag (coface lists, occ lists).
class SmallVec {
 public:
  static constexpr uint32_t kInline = 4;

  SmallVec() noexcept : n_(0), cap_(kInline) {}
  ~SmallVec() {
    if (cap_ > kInline) std::free(heap_);
  }
  SmallVec(const SmallVec& o) : n_(0), cap_(kInline) { assign(o.data(), o.n_); }
  SmallVec(SmallVec&& o) noexcept : n_(o.n_), cap_(o.cap_) {
    if (cap_ > kInline)
      heap_ = o.heap_;
    else
      std::memcpy(inl_, o.inl_, sizeof(inl_));
    o.n_ = 0;
    o.cap_ = kInline;
  }
  SmallVec& operator=(const SmallVec& o) {
    if (this != &o) assign(o.data(), o.n_);
    return *this;
  }
  SmallVec& operator=(SmallVec&& o) noexcept {
    if (this != &o) {
      if (cap_ > kInline) std::free(heap_);
      n_ = o.n_;
      cap_ = o.cap_;
      if (cap_ > kInline)
        heap_ = o.heap_;
      else
        std::memcpy(inl_, o.inl_, sizeof(inl_));
      o.n_ = 0;
      o.cap_ = kInline;
    }
    return *this;
  }

  uint32_t size() const { return n_; }
  bool empty() const { return n_ == 0; }
  uint32_t capacity() const { return cap_; }
  const uint32_t* data() const { return cap_ > kInline ? heap_ : inl_; }
  uint32_t* data() { return cap_ > kInline ? heap_ : inl_; }
  const uint32_t* begin() const { return data(); }
  const uint32_t* end() const { return data() + n_; }
  uint32_t* begin() { return data(); }
  uint32_t* end() { return data() + n_; }
  uint32_t back() const { return data()[n_ - 1]; }
  uint32_t operator[](size_t i) const { return data()[i]; }
  uint32_t& operator[](size_t i) { return data()[i]; }

  void clear() { n_ = 0; }
  // Drop contents and any heap buffer.
  void release() {
    if (cap_ > kInline) std::free(heap_);
    n_ = 0;
    cap_ = kInline;
  }
  void reserve(uint32_t c) {
    if (c <= cap_) return;
    realloc_exact(std::max<uint32_t>(c, cap_ + cap_ / 2));
  }
  // Replace contents. `p` must not alias this vector's storage when growing.
  void assign(const uint32_t* p, uint32_t n) {
    if (n > cap_) {
      realloc_exact(n);
    } else if (cap_ > kInline && (n <= kInline || (cap_ > 32 && n < cap_ / 4))) {
      // shrink: avoid keeping large buffers for chains that became short
      shrink_to(n);
    }
    if (n) std::memmove(data(), p, sizeof(uint32_t) * n);
    n_ = n;
  }
  void push_back(uint32_t x) {
    if (n_ == cap_) realloc_exact(cap_ < 16 ? cap_ * 2 : cap_ + cap_ / 2);
    data()[n_++] = x;
  }
  void pop_back() { --n_; }
  void resize_down(uint32_t n) { n_ = n; }
  // Unordered erase of the first occurrence of x; returns false if absent.
  bool erase_unordered(uint32_t x) {
    uint32_t* d = data();
    for (uint32_t i = 0; i < n_; ++i) {
      if (d[i] == x) {
        d[i] = d[n_ - 1];
        --n_;
        return true;
      }
    }
    return false;
  }
  // Binary search (only meaningful in the sorted role).
  bool contains_sorted(uint32_t x) const {
    return std::binary_search(begin(), end(), x);
  }
  void shrink_to_fit() {
    if (cap_ > kInline) shrink_to(n_);
  }
  size_t heap_bytes() const { return cap_ > kInline ? sizeof(uint32_t) * cap_ : 0; }

 private:
  void realloc_exact(uint32_t nc) {
    uint32_t* p = static_cast<uint32_t*>(std::malloc(sizeof(uint32_t) * nc));
    if (!p) throw std::bad_alloc();
    if (n_) std::memcpy(p, data(), sizeof(uint32_t) * n_);
    if (cap_ > kInline) std::free(heap_);
    heap_ = p;
    cap_ = nc;
  }
  void shrink_to(uint32_t n) {
    // n <= n_ is not required: callers overwrite the content afterwards.
    if (n <= kInline) {
      uint32_t* old = heap_;
      uint32_t keep = std::min(n_, kInline);
      std::memcpy(inl_, old, sizeof(uint32_t) * keep);
      std::free(old);
      cap_ = kInline;
      n_ = keep;
    } else {
      uint32_t* p = static_cast<uint32_t*>(std::malloc(sizeof(uint32_t) * n));
      if (!p) throw std::bad_alloc();
      uint32_t keep = std::min(n_, n);
      std::memcpy(p, heap_, sizeof(uint32_t) * keep);
      std::free(heap_);
      heap_ = p;
      cap_ = n;
      n_ = keep;
    }
  }

  uint32_t n_, cap_;
  union {
    uint32_t inl_[kInline];
    uint32_t* heap_;
  };
};

static_assert(sizeof(SmallVec) == 24, "SmallVec should stay 24 bytes");

// out := a XOR b for strictly increasing a, b. `out` must have room for
// na + nb entries and must not alias a or b. Returns |out|.
inline uint32_t xor_merge(const uint32_t* a, uint32_t na, const uint32_t* b, uint32_t nb,
                          uint32_t* out) {
  uint32_t i = 0, j = 0, k = 0;
  while (i < na && j < nb) {
    const uint32_t x = a[i], y = b[j];
    if (x < y) {
      out[k++] = x;
      ++i;
    } else if (y < x) {
      out[k++] = y;
      ++j;
    } else {
      ++i;
      ++j;
    }
  }
  if (i < na) {
    std::memcpy(out + k, a + i, sizeof(uint32_t) * (na - i));
    k += na - i;
  }
  if (j < nb) {
    std::memcpy(out + k, b + j, sizeof(uint32_t) * (nb - j));
    k += nb - j;
  }
  return k;
}

// Growable scratch buffer used by merges.
struct Scratch {
  std::vector<uint32_t> buf;
  uint32_t* ensure(size_t n) {
    if (buf.size() < n) buf.resize(std::max(n, buf.size() * 2 + 16));
    return buf.data();
  }
};

// Sort a short array (<= 4 typically) in place.
inline void sort_small(uint32_t* a, int n) {
  for (int i = 1; i < n; ++i) {
    uint32_t x = a[i];
    int j = i - 1;
    while (j >= 0 && a[j] > x) {
      a[j + 1] = a[j];
      --j;
    }
    a[j + 1] = x;
  }
}

}  // namespace mmhm
