#include "methods.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>

namespace mmhm {

// ---------------------------------------------------------------- Method ----

void Method::init(const Edit* edits, size_t n) {
  std::vector<uint32_t> idx(n);
  for (size_t i = 0; i < n; ++i) idx[i] = uint32_t(i);
  // The parser already orders INIT by dimension; sort only other inputs.
  bool sorted = true;
  for (size_t i = 1; i < n && sorted; ++i) sorted = edits[i - 1].n <= edits[i].n;
  if (!sorted)
    std::stable_sort(idx.begin(), idx.end(),
                     [&](uint32_t a, uint32_t b) { return edits[a].n < edits[b].n; });
  for (uint32_t i : idx) {
    const Edit& e = edits[i];
    try {
      cx.insert(e.v, e.n);
    } catch (const EditError& err) {
      throw EditError(std::string("INIT is not a simplicial complex: ") + err.what());
    }
  }
  build();
  if (!needs_tuple_index()) cx.set_track_tuples(false);
}

void Method::apply(const Edit& e) {
  if (e.op == '+') {
    const uint32_t c = cx.insert(e.v, e.n);
    on_insert(c);
  } else {
    const uint32_t c = cx.find_deletable(e.v, e.n);
    on_delete(c);
    cx.remove(c);
  }
}

// ------------------------------------------------------------ FullMethod ----

void FullMethod::recompute() {
  if (order_ == Order::Insertion) {
    insertion_keys(cx, cell2key_, cols_);
  } else {
    mb_.compute(cx, mo_, false);
    morse_keys(cx, mo_, cell2key_, cols_);
  }
  res_ = red_.run(cx, cell2key_, uint32_t(cx.total()), cols_);
  adds_ += res_.adds;
}

// ------------------------------------------------------------- DrbMethod ----

DrbMethod::DrbMethod(int maxdim, Order o, bool rebuild, const MethodOptions& opt)
    : Method(maxdim), drb(maxdim), order_(o), rebuild_(rebuild), opt_(opt) {
  drb.set_auto_check([this](uint32_t c, std::vector<uint32_t>& f) {
    f.assign(cx.facets(c), cx.facets(c) + cx.num_facets(c));
  });
}

const char* DrbMethod::name() const {
  if (order_ == Order::Insertion) return "drb-id";
  return rebuild_ ? "mmhm" : "mmhm-norb";
}

void DrbMethod::do_build() {
  if (order_ == Order::Insertion) {
    insertion_keys(cx, cell2key_, cols_);
  } else {
    mb_.compute(cx, mo, record_pairs);
    morse_keys(cx, mo, cell2key_, cols_);
  }
  drb.build(cx, cell2key_, uint32_t(cx.total()), cols_);
  nnz_last_ = drb.nnz_R() + drb.nnz_V();
}

void DrbMethod::build() {
  do_build();
  t_last_ = 0;
}

void DrbMethod::end_update(uint64_t t) {
  last_rebuild = false;
  last_rebuild_ns = 0;
  if (!rebuild_) return;
  bool trigger = opt_.period > 0 && t - t_last_ >= opt_.period;
  if (!trigger && opt_.alpha >= 0) {
    const double nnz = double(drb.nnz_R() + drb.nnz_V());
    const double base = double(std::max<uint64_t>(nnz_last_, cx.total()));
    trigger = nnz > (1.0 + opt_.alpha) * base;
  }
  if (!trigger) return;
  const auto t0 = std::chrono::steady_clock::now();
  do_build();
  const auto t1 = std::chrono::steady_clock::now();
  t_last_ = t;
  last_rebuild = true;
  last_rebuild_ns = uint64_t(std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count());
  ++rebuilds;
}

void DrbMethod::betti(int64_t b[4]) {
  uint64_t r[5] = {0, drb.rank(1), drb.rank(2), drb.rank(3), 0};
  betti_from_ranks(cx, r, b);
}

// ------------------------------------------------------------- LcrMethod ----

void LcrMethod::build() {
  mb_.compute(cx, mo_, false);
  morse_keys(cx, mo_, cell2key_, cols_);
  lcr.build(cx, cell2key_, uint32_t(cx.total()), cols_);
}

void LcrMethod::betti(int64_t b[4]) {
  uint64_t r[5] = {0, lcr.rank(1), lcr.rank(2), lcr.rank(3), 0};
  betti_from_ranks(cx, r, b);
}

// ----------------------------------------------------------- EulerMethod ----

void EulerMethod::build() {
  if (cx.n(3) > 0) throw PreconditionError("euler: complex has tetrahedra (surfaces only)");
  count_[0] = count_[1] = count_[2] = 0;
  std::vector<uint32_t> edges;
  if (cx.maxdim() >= 1) cx.cells_by_insertion(1, edges);
  for (uint32_t e : edges) ++count_[cls(cx.cofaces(e).size())];
  check_preconditions();
}

void EulerMethod::on_insert(uint32_t c) {
  const int d = cx.dim(c);
  if (d == 3) throw PreconditionError("euler: tetrahedron inserted (surfaces only)");
  if (d == 1) {
    ++count_[cls(0)];
  } else if (d == 2) {
    const uint32_t* f = cx.facets(c);
    for (int i = 0; i < 3; ++i) {
      const size_t n = cx.cofaces(f[i]).size();  // already includes c
      --count_[cls(n - 1)];
      ++count_[cls(n)];
    }
  }
}

void EulerMethod::on_delete(uint32_t c) {
  const int d = cx.dim(c);
  if (d == 1) {
    --count_[cls(0)];
  } else if (d == 2) {
    const uint32_t* f = cx.facets(c);
    for (int i = 0; i < 3; ++i) {
      const size_t n = cx.cofaces(f[i]).size();  // still includes c
      --count_[cls(n)];
      ++count_[cls(n - 1)];
    }
  }
}

void EulerMethod::check_preconditions() const {
  if (count_[2] > 0)
    throw PreconditionError("euler: " + std::to_string(count_[2]) +
                            " non-manifold edge(s) (coface count not in {1,2})");
  if (cx.n(2) == 0) throw PreconditionError("euler: no triangles (not a surface)");
}

void EulerMethod::betti(int64_t b[4]) {
  const int64_t chi = int64_t(cx.n(0)) - int64_t(cx.n(1)) + int64_t(cx.n(2));
  b[0] = 1;
  b[2] = (count_[0] == 0 && count_[2] == 0) ? 1 : 0;
  b[1] = b[0] + b[2] - chi;
  b[3] = 0;
}

// --------------------------------------------------------------- factory ----

const std::vector<std::string>& method_names() {
  static const std::vector<std::string> names = {"full-id", "full-morse", "drb-id", "mmhm",
                                                 "mmhm-norb", "lcr", "euler"};
  return names;
}

std::unique_ptr<Method> make_method(const std::string& name, int maxdim, const MethodOptions& opt) {
  if (name == "full-id") return std::make_unique<FullMethod>(maxdim, Order::Insertion);
  if (name == "full-morse") return std::make_unique<FullMethod>(maxdim, Order::Morse);
  if (name == "drb-id") return std::make_unique<DrbMethod>(maxdim, Order::Insertion, false, opt);
  if (name == "mmhm") return std::make_unique<DrbMethod>(maxdim, Order::Morse, true, opt);
  if (name == "mmhm-norb") return std::make_unique<DrbMethod>(maxdim, Order::Morse, false, opt);
  if (name == "lcr") return std::make_unique<LcrMethod>(maxdim);
  if (name == "euler") return std::make_unique<EulerMethod>(maxdim);
  return nullptr;
}

}  // namespace mmhm
