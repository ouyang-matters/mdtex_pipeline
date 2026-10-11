// Collapse-based acyclic matching and Morse order (SPEC 3).
#pragma once

#include <cstdint>
#include <utility>
#include <vector>

#include "complex.hpp"

namespace mmhm {

struct MorseOrder {
  // Cells in removal order: rm(removal[t]) = t.
  std::vector<uint32_t> removal;
  // Gradient pairs (tau, sigma): tau a facet of sigma (only if requested).
  std::vector<std::pair<uint32_t, uint32_t>> pairs;
  size_t num_pairs = 0;
  size_t critical[4] = {0, 0, 0, 0};
};

class MorseBuilder {
 public:
  // Deterministic collapse matching of the whole complex. The result depends
  // only on the set of simplices (not on cell ids or history):
  //  * Q is a FIFO queue, initialised with the free faces in increasing
  //    (dimension, lexicographic vertex tuple) order;
  //  * facets of a removed cell are visited in "omit vertex 0, 1, ..." order
  //    and newly free ones appended to Q (y's facets first, then x's);
  //  * when Q runs dry, the critical cell is the lexicographically smallest
  //    vertex tuple among the remaining cells of the highest dimension.
  void compute(Complex& cx, MorseOrder& out, bool record_pairs);

 private:
  // Per cell: number of immediate cofaces still in P (bit 31 = "x in P") and
  // the XOR of their ids, so the unique coface of a free face is read off
  // directly instead of scanning coface lists.
  struct Node {
    uint32_t cnt;
    uint32_t xr;
  };
  static constexpr uint32_t kInP = 0x80000000u;
  std::vector<Node> node_;
  std::vector<uint32_t> queue_;
};

// Morse order keys from a removal sequence: ord(x) = N-1-rm(x), so later
// removal gives a smaller key and keys are exactly 0..N-1. Fills cell2key
// (indexed by cell id, sized to cx.capacity()) and cols[d] = cells of
// dimension d in increasing key order.
void morse_keys(const Complex& cx, const MorseOrder& mo, std::vector<uint32_t>& cell2key,
                std::vector<uint32_t> cols[4]);

// Insertion-order keys: keys 0..N-1 assigned dimension by dimension in
// increasing insertion order (only the order within a dimension matters).
void insertion_keys(Complex& cx, std::vector<uint32_t>& cell2key, std::vector<uint32_t> cols[4]);

// Canonical keys (full-sorted): per dimension, cells in lexicographic order of
// their vertex tuples -- a function of K as a set, independent of history.
void tuple_keys(Complex& cx, std::vector<uint32_t>& cell2key, std::vector<uint32_t> cols[4]);

// Random keys (drb-rand): per dimension, a uniformly random permutation of the
// alive cells drawn from a generator seeded with `seed` (cells are first put
// in vertex-tuple order, so the result depends only on K and the seed).
void random_keys(Complex& cx, std::vector<uint32_t>& cell2key, std::vector<uint32_t> cols[4],
                 uint64_t seed);

}  // namespace mmhm
