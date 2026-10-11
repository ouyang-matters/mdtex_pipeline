// Methods of SPEC 5 behind one interface used by the CLI and the tests.
#pragma once

#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "complex.hpp"
#include "drb.hpp"
#include "lcr.hpp"
#include "morse.hpp"
#include "seq.hpp"
#include "static_reduce.hpp"

namespace mmhm {

// A method's precondition does not hold (euler on a non-surface).
struct PreconditionError : std::runtime_error {
  using std::runtime_error::runtime_error;
};

struct MethodOptions {
  uint64_t period = 0;  // rebuild period m (mmhm only); 0 = off (m = infinity)
  double alpha = 1.0;   // growth trigger (mmhm only); negative = off (alpha = infinity)
};

class Method {
 public:
  explicit Method(int maxdim) : cx(maxdim) {}
  virtual ~Method() = default;

  virtual const char* name() const = 0;
  // Exact methods abort on a verification mismatch; inexact ones count it.
  virtual bool exact() const { return true; }

  // Builds K_0 from the INIT block: inserts every simplex into the store,
  // stably sorted by dimension (so INIT need only be closed under faces,
  // not listed faces-first), then runs the method's build.
  void init(const Edit* edits, size_t n);
  // One atomic edit; throws EditError if invalid.
  void apply(const Edit& e);
  // Called after the last atomic edit of update t >= 1.
  virtual void end_update(uint64_t /*t*/) {}

  virtual void betti(int64_t b[4]) = 0;

  // CSV counters (see README). Totals are cumulative; the driver differences them.
  virtual uint64_t nnz_R() const { return 0; }
  virtual uint64_t nnz_V() const { return 0; }
  virtual uint64_t chain_adds_total() const { return 0; }
  virtual uint64_t footprint_total() const { return 0; }
  // Rebuild performed by the last end_update().
  bool last_rebuild = false;
  uint64_t last_rebuild_ns = 0;
  uint64_t rebuilds = 0;

  Complex cx;

 protected:
  virtual void build() = 0;
  virtual void on_insert(uint32_t /*c*/) {}
  virtual void on_delete(uint32_t /*c*/) {}  // called before the cell is removed
};

enum class Order { Insertion, Morse };

// full-id / full-morse: static reduction with clearing after every update.
class FullMethod : public Method {
 public:
  FullMethod(int maxdim, Order o) : Method(maxdim), order_(o) {}
  const char* name() const override { return order_ == Order::Insertion ? "full-id" : "full-morse"; }
  void end_update(uint64_t) override { recompute(); }
  void betti(int64_t b[4]) override { betti_from_ranks(cx, res_.rank, b); }
  uint64_t nnz_R() const override { return res_.nnz_R; }
  uint64_t chain_adds_total() const override { return adds_; }

 protected:
  void build() override { recompute(); }

 private:
  void recompute();
  Order order_;
  StaticReducer red_;
  MorseBuilder mb_;
  MorseOrder mo_;
  std::vector<uint32_t> cell2key_;
  std::vector<uint32_t> cols_[4];
  StaticResult res_;
  uint64_t adds_ = 0;
};

// drb-id / mmhm / mmhm-norb.
class DrbMethod : public Method {
 public:
  DrbMethod(int maxdim, Order o, bool rebuild, const MethodOptions& opt);
  const char* name() const override;
  void end_update(uint64_t t) override;
  void betti(int64_t b[4]) override;
  uint64_t nnz_R() const override { return drb.nnz_R(); }
  uint64_t nnz_V() const override { return drb.nnz_V(); }
  uint64_t chain_adds_total() const override { return drb.chain_adds; }
  uint64_t footprint_total() const override { return drb.footprint; }

  Drb drb;
  // Morse data of the last build; gradient pairs are kept only if
  // record_pairs is set (tests).
  MorseOrder mo;
  bool record_pairs = false;

 protected:
  void build() override;
  void on_insert(uint32_t c) override { drb.add_cell(c, cx.dim(c), cx.facets(c), cx.num_facets(c)); }
  void on_delete(uint32_t c) override { drb.remove_cell(c); }

 private:
  void do_build();
  Order order_;
  bool rebuild_;
  MethodOptions opt_;
  MorseBuilder mb_;
  std::vector<uint32_t> cell2key_;
  std::vector<uint32_t> cols_[4];
  uint64_t t_last_ = 0;
  uint64_t nnz_last_ = 0;
};

// lcr: Morse order built once at INIT (same order as mmhm-norb), then the v1
// rule without basis tracking.
class LcrMethod : public Method {
 public:
  explicit LcrMethod(int maxdim) : Method(maxdim), lcr(maxdim) {}
  const char* name() const override { return "lcr"; }
  bool exact() const override { return false; }
  void betti(int64_t b[4]) override;
  uint64_t nnz_R() const override { return lcr.nnz_R(); }
  uint64_t chain_adds_total() const override { return lcr.chain_adds; }
  Lcr lcr;

 protected:
  void build() override;
  void on_insert(uint32_t c) override { lcr.add_cell(c, cx.dim(c), cx.facets(c), cx.num_facets(c)); }
  void on_delete(uint32_t c) override { lcr.remove_cell(c); }

 private:
  MorseBuilder mb_;
  MorseOrder mo_;
  std::vector<uint32_t> cell2key_;
  std::vector<uint32_t> cols_[4];
};

// euler: surfaces only, O(1) per atomic edit.
class EulerMethod : public Method {
 public:
  explicit EulerMethod(int maxdim) : Method(maxdim) {}
  const char* name() const override { return "euler"; }
  void end_update(uint64_t) override { check_preconditions(); }
  void betti(int64_t b[4]) override;

 protected:
  void build() override;
  void on_insert(uint32_t c) override;
  void on_delete(uint32_t c) override;

 private:
  void check_preconditions() const;
  static int cls(size_t ncof) { return ncof == 1 ? 0 : (ncof == 2 ? 1 : 2); }
  int64_t count_[3] = {0, 0, 0};  // edges with 1 coface / 2 cofaces / other
};

// Factory; returns nullptr for an unknown name.
std::unique_ptr<Method> make_method(const std::string& name, int maxdim, const MethodOptions& opt);
const std::vector<std::string>& method_names();

}  // namespace mmhm
