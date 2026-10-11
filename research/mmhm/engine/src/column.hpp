// Working columns for reductions, so that one column addition costs
// O(|added chain|) (times a log) rather than O(|working column|).
//
// Working columns are sorted vectors XORed by linear merge while that is
// cheap: the column is short, or the added chain is at least a quarter of its
// length (merge cost <= 5 |added|). Only when a short chain is added to a long
// column does it switch representation:
//  * WorkR (needs low() after every addition): a binary max-heap of keys with
//    lazy cancellation of equal pairs; low() inspects the root and its two
//    children (if the maximum occurs twice, its second copy is a child of the
//    root), so additions cost O(|R_p| log h);
//  * WorkV (only read at the end): entries are appended unsorted and the
//    final chain is obtained by one sort + pair cancellation.
// The result is identical to plain merging; only the cost changes.
#pragma once

#include <algorithm>
#include <cstdint>
#include <vector>

#include "smallvec.hpp"

namespace mmhm {

class WorkR {
 public:
  static constexpr uint32_t kHeapAt = 48;

  void reset(const uint32_t* p, uint32_t n) {
    heap_mode_ = false;
    heap_.clear();
    if (a_.size() < n + 16) a_.resize(n + 16);
    std::copy(p, p + n, a_.begin());
    na_ = n;
  }
  bool empty() { return low() == NONE; }
  // Largest key with odd multiplicity, or NONE if the column is zero.
  uint32_t low() {
    if (!heap_mode_) return na_ ? a_[na_ - 1] : NONE;
    while (!heap_.empty()) {
      const uint32_t x = heap_[0];
      const size_t h = heap_.size();
      const bool dup = (h > 1 && heap_[1] == x) || (h > 2 && heap_[2] == x);
      if (!dup) return x;
      pop();
      pop();
    }
    return NONE;
  }
  // XOR a sorted chain into the column.
  void add(const uint32_t* p, uint32_t n) {
    if (!heap_mode_) {
      if (na_ + n <= kHeapAt || 4 * size_t(n) >= na_) {
        if (b_.size() < na_ + n) b_.resize(na_ + n + 16);
        na_ = xor_merge(a_.data(), na_, p, n, b_.data());
        a_.swap(b_);
        return;
      }
      heap_mode_ = true;
      heap_.assign(a_.begin(), a_.begin() + na_);  // sorted ascending: re-heapify
      std::make_heap(heap_.begin(), heap_.end());
    }
    for (uint32_t i = 0; i < n; ++i) {
      heap_.push_back(p[i]);
      std::push_heap(heap_.begin(), heap_.end());
    }
  }
  // Final contents, sorted ascending.
  const uint32_t* data() {
    normalize();
    return a_.data();
  }
  uint32_t size() {
    normalize();
    return na_;
  }

 private:
  void pop() {
    std::pop_heap(heap_.begin(), heap_.end());
    heap_.pop_back();
  }
  // Back to sorted-vector form (drains the heap, cancelling pairs).
  void normalize() {
    if (!heap_mode_) return;
    std::sort_heap(heap_.begin(), heap_.end());  // ascending
    if (a_.size() < heap_.size() + 16) a_.resize(heap_.size() + 16);
    uint32_t m = 0;
    for (size_t i = 0; i < heap_.size();) {
      size_t j = i;
      while (j < heap_.size() && heap_[j] == heap_[i]) ++j;
      if ((j - i) & 1) a_[m++] = heap_[i];
      i = j;
    }
    na_ = m;
    heap_.clear();
    heap_mode_ = false;
  }
  bool heap_mode_ = false;
  std::vector<uint32_t> a_, b_, heap_;
  uint32_t na_ = 0;
};

class WorkV {
 public:
  static constexpr uint32_t kAppendAt = 48;

  void reset(uint32_t s) {
    append_mode_ = false;
    if (a_.size() < 16) a_.resize(16);
    a_[0] = s;
    na_ = 1;
  }
  void add(const uint32_t* p, uint32_t n) {
    if (!append_mode_) {
      if (na_ + n <= kAppendAt || 4 * size_t(n) >= na_) {
        if (b_.size() < na_ + n) b_.resize(na_ + n + 16);
        na_ = xor_merge(a_.data(), na_, p, n, b_.data());
        a_.swap(b_);
        return;
      }
      append_mode_ = true;
      app_.assign(a_.begin(), a_.begin() + na_);
    }
    app_.insert(app_.end(), p, p + n);
  }
  const uint32_t* data() {
    normalize();
    return a_.data();
  }
  uint32_t size() {
    normalize();
    return na_;
  }

 private:
  void normalize() {
    if (!append_mode_) return;
    std::sort(app_.begin(), app_.end());
    if (a_.size() < app_.size() + 16) a_.resize(app_.size() + 16);
    uint32_t m = 0;
    for (size_t i = 0; i < app_.size();) {
      size_t j = i;
      while (j < app_.size() && app_[j] == app_[i]) ++j;
      if ((j - i) & 1) a_[m++] = app_[i];
      i = j;
    }
    na_ = m;
    app_.clear();
    append_mode_ = false;
  }
  bool append_mode_ = false;
  std::vector<uint32_t> a_, b_, app_;
  uint32_t na_ = 0;
};

}  // namespace mmhm
