// mmhm: engine CLI (SPEC 7).
//
//   mmhm run --method <name> --seq <file> [--out <csv>] [--betti-out <file>]
//            [--period m] [--alpha a] [--verify-every N] [--max-updates T]
//   mmhm check --seq <file>
//
// Exit codes: 0 ok, 1 usage, 2 invalid input (parse error or invalid atomic
// edit), 3 verification mismatch of an exact method, 4 method precondition
// violated (euler on a non-surface).

#include <algorithm>
#include <chrono>
#include <cinttypes>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "complex.hpp"
#include "methods.hpp"
#include "seq.hpp"
#include "static_reduce.hpp"

using namespace mmhm;

namespace {

using Clock = std::chrono::steady_clock;

uint64_t ns_between(Clock::time_point a, Clock::time_point b) {
  return uint64_t(std::chrono::duration_cast<std::chrono::nanoseconds>(b - a).count());
}

void usage() {
  std::fprintf(stderr,
               "usage:\n"
               "  mmhm run --method <name> --seq <file> [--out <csv>] [--betti-out <file>]\n"
               "           [--period m] [--alpha a] [--verify-every N] [--max-updates T]\n"
               "  mmhm check --seq <file>\n"
               "methods:");
  for (const auto& n : method_names()) std::fprintf(stderr, " %s", n.c_str());
  std::fprintf(stderr,
               "\n--period m: rebuild every m updates (mmhm only; default off)\n"
               "--alpha a : growth trigger (mmhm only; default 1.0; 'off' or 'inf' disables)\n");
}

bool parse_u64(const char* s, uint64_t& out) {
  if (!s || !*s) return false;
  char* end = nullptr;
  unsigned long long v = std::strtoull(s, &end, 10);
  if (*end) return false;
  out = v;
  return true;
}

struct Args {
  std::string cmd, method, seq, out, betti_out;
  uint64_t period = 0, verify_every = 0, max_updates = UINT64_MAX;
  double alpha = 1.0;
  bool period_given = false, alpha_given = false;
};

bool parse_args(int argc, char** argv, Args& a) {
  if (argc < 2) return false;
  a.cmd = argv[1];
  for (int i = 2; i < argc; ++i) {
    std::string k = argv[i];
    auto val = [&](const char*& v) {
      if (i + 1 >= argc) return false;
      v = argv[++i];
      return true;
    };
    const char* v = nullptr;
    if (k == "--method") {
      if (!val(v)) return false;
      a.method = v;
    } else if (k == "--seq") {
      if (!val(v)) return false;
      a.seq = v;
    } else if (k == "--out") {
      if (!val(v)) return false;
      a.out = v;
    } else if (k == "--betti-out") {
      if (!val(v)) return false;
      a.betti_out = v;
    } else if (k == "--period") {
      if (!val(v)) return false;
      std::string s = v;
      if (s == "off" || s == "inf") {
        a.period = 0;
      } else if (!parse_u64(v, a.period) || a.period == 0) {
        std::fprintf(stderr, "bad --period (positive integer, or off)\n");
        return false;
      }
      a.period_given = true;
    } else if (k == "--alpha") {
      if (!val(v)) return false;
      std::string s = v;
      if (s == "off" || s == "inf") {
        a.alpha = -1.0;
      } else {
        char* end = nullptr;
        a.alpha = std::strtod(v, &end);
        if (*end || !(a.alpha >= 0.0)) {
          std::fprintf(stderr, "bad --alpha (non-negative number, or off)\n");
          return false;
        }
      }
      a.alpha_given = true;
    } else if (k == "--verify-every") {
      if (!val(v) || !parse_u64(v, a.verify_every)) return false;
    } else if (k == "--max-updates") {
      if (!val(v) || !parse_u64(v, a.max_updates)) return false;
    } else {
      std::fprintf(stderr, "unknown option %s\n", k.c_str());
      return false;
    }
  }
  return true;
}

int cmd_check(const Args& a) {
  if (a.seq.empty()) {
    usage();
    return 1;
  }
  Sequence seq;
  std::string err;
  if (!parse_seq_file(a.seq, seq, err)) {
    std::fprintf(stderr, "error: %s\n", err.c_str());
    return 2;
  }
  Complex cx(seq.dim);
  const Edit* init = seq.block(0);
  const size_t ni = seq.block_size(0);
  std::vector<uint32_t> idx(ni);
  for (size_t i = 0; i < ni; ++i) idx[i] = uint32_t(i);
  std::stable_sort(idx.begin(), idx.end(),
                   [&](uint32_t x, uint32_t y) { return init[x].n < init[y].n; });
  for (uint32_t i : idx) {
    try {
      cx.insert(init[i].v, init[i].n);
    } catch (const EditError& e) {
      std::fprintf(stderr, "error: line %u: INIT not closed under faces: %s\n", init[i].line,
                   e.what());
      return 2;
    }
  }
  size_t max_total = cx.total(), min_total = cx.total(), max_ops = 0, edits = 0;
  for (size_t t = 1; t <= seq.num_updates(); ++t) {
    const Edit* E = seq.block(t);
    const size_t n = seq.block_size(t);
    max_ops = std::max(max_ops, n);
    edits += n;
    for (size_t i = 0; i < n; ++i) {
      try {
        if (E[i].op == '+')
          cx.insert(E[i].v, E[i].n);
        else
          cx.remove(cx.find_deletable(E[i].v, E[i].n));
      } catch (const EditError& e) {
        std::fprintf(stderr, "error: line %u (update %zu): %s\n", E[i].line, t, e.what());
        return 2;
      }
    }
    max_total = std::max(max_total, cx.total());
    min_total = std::min(min_total, cx.total());
  }
  std::printf(
      "OK %s: dim %d, INIT %zu simplices, %zu updates, %zu update edits (max %zu per update), "
      "|K| in [%zu, %zu], final n = %zu %zu %zu %zu\n",
      a.seq.c_str(), seq.dim, ni, seq.num_updates(), edits, max_ops, min_total, max_total, cx.n(0),
      cx.n(1), cx.n(2), cx.n(3));
  return 0;
}

int cmd_run(const Args& a) {
  if (a.method.empty() || a.seq.empty()) {
    usage();
    return 1;
  }
  MethodOptions opt;
  opt.period = a.period;
  opt.alpha = a.alpha;
  if (!make_method(a.method, 0, opt)) {
    std::fprintf(stderr, "unknown method '%s'\n", a.method.c_str());
    usage();
    return 1;
  }
  if ((a.period_given || a.alpha_given) && a.method != "mmhm")
    std::fprintf(stderr, "warning: --period/--alpha only affect mmhm; ignored for %s\n",
                 a.method.c_str());

  // ---- parse everything before timing starts
  Sequence seq;
  std::string err;
  if (!parse_seq_file(a.seq, seq, err)) {
    std::fprintf(stderr, "error: %s\n", err.c_str());
    return 2;
  }
  std::unique_ptr<Method> m = make_method(a.method, seq.dim, opt);
  const size_t T = std::min<uint64_t>(seq.num_updates(), a.max_updates);

  FILE* csv = stdout;
  if (!a.out.empty()) {
    csv = std::fopen(a.out.c_str(), "w");
    if (!csv) {
      std::fprintf(stderr, "error: cannot write %s\n", a.out.c_str());
      return 1;
    }
  }
  FILE* bf = nullptr;
  if (!a.betti_out.empty()) {
    bf = std::fopen(a.betti_out.c_str(), "w");
    if (!bf) {
      std::fprintf(stderr, "error: cannot write %s\n", a.betti_out.c_str());
      return 1;
    }
  }
  auto close_all = [&]() {
    if (csv != stdout) std::fclose(csv);
    else std::fflush(stdout);
    if (bf) std::fclose(bf);
  };
  std::fprintf(csv,
               "t,ops,n0,n1,n2,n3,b0,b1,b2,b3,time_ns,rebuild,rebuild_ns,nnz_R,nnz_V,"
               "footprint_sum,chain_adds,verified,mismatch\n");

  FullIdOracle oracle;
  uint64_t mismatches = 0, verified_count = 0, total_update_ns = 0, init_ns = 0;
  uint64_t rebuild_total_ns = 0, rebuild_count = 0;

  for (size_t t = 0; t <= T; ++t) {
    const Edit* E = seq.block(t);
    const size_t n = seq.block_size(t);
    const uint64_t adds0 = m->chain_adds_total();
    const uint64_t fp0 = m->footprint_total();
    uint64_t time_ns = 0;
    try {
      if (t == 0) {
        const auto t0 = Clock::now();
        m->init(E, n);
        const auto t1 = Clock::now();
        time_ns = ns_between(t0, t1);
        init_ns = time_ns;
      } else {
        size_t i = 0;
        try {
          const auto t0 = Clock::now();
          for (; i < n; ++i) m->apply(E[i]);
          m->end_update(t);
          const auto t1 = Clock::now();
          time_ns = ns_between(t0, t1);
        } catch (const EditError& e) {
          std::fprintf(stderr, "error: line %u (update %zu): invalid edit: %s\n", E[i].line, t,
                       e.what());
          close_all();
          return 2;
        }
        total_update_ns += time_ns;
      }
    } catch (const EditError& e) {
      std::fprintf(stderr, "error: %s\n", e.what());
      close_all();
      return 2;
    } catch (const PreconditionError& e) {
      std::fprintf(stderr, "error: update %zu: %s\n", t, e.what());
      close_all();
      return 4;
    }
    const bool rebuilt = t > 0 && m->last_rebuild;
    const uint64_t rebuild_ns = rebuilt ? m->last_rebuild_ns : 0;
    if (rebuilt) {
      ++rebuild_count;
      rebuild_total_ns += rebuild_ns;
    }
    int64_t b[4];
    m->betti(b);
    int verified = 0, mismatch = 0;
    auto write_row = [&]() {
      std::fprintf(csv,
                   "%zu,%zu,%zu,%zu,%zu,%zu,%" PRId64 ",%" PRId64 ",%" PRId64 ",%" PRId64
                   ",%" PRIu64 ",%d,%" PRIu64 ",%" PRIu64 ",%" PRIu64 ",%" PRIu64 ",%" PRIu64
                   ",%d,%d\n",
                   t, n, m->cx.n(0), m->cx.n(1), m->cx.n(2), m->cx.n(3), b[0], b[1], b[2], b[3],
                   time_ns, rebuilt ? 1 : 0, rebuild_ns, m->nnz_R(), m->nnz_V(),
                   m->footprint_total() - fp0, m->chain_adds_total() - adds0, verified, mismatch);
    };
    if (a.verify_every > 0 && (t % a.verify_every == 0 || t == T)) {
      int64_t ob[4];
      oracle.betti(m->cx, ob);
      verified = 1;
      ++verified_count;
      if (!std::equal(b, b + 4, ob)) {
        mismatch = 1;
        ++mismatches;
      }
      if (mismatch && m->exact()) {
        write_row();
        close_all();
        std::fprintf(stderr,
                     "VERIFICATION MISMATCH: method %s, update t=%zu (%s): got betti %" PRId64
                     " %" PRId64 " %" PRId64 " %" PRId64 ", full-id says %" PRId64 " %" PRId64
                     " %" PRId64 " %" PRId64 "\n",
                     m->name(), t, a.seq.c_str(), b[0], b[1], b[2], b[3], ob[0], ob[1], ob[2],
                     ob[3]);
        return 3;
      }
    }
    write_row();
    if (bf)
      std::fprintf(bf, "%" PRId64 " %" PRId64 " %" PRId64 " %" PRId64 "\n", b[0], b[1], b[2], b[3]);
  }
  close_all();
  std::fprintf(stderr,
               "%s: %zu updates, init %.3f ms, updates %.3f ms total (%.3f us/update amortized), "
               "rebuilds %" PRIu64 " (%.3f ms), verified %" PRIu64 ", mismatches %" PRIu64 "\n",
               m->name(), T, init_ns / 1e6, total_update_ns / 1e6,
               T ? total_update_ns / 1e3 / double(T) : 0.0, rebuild_count, rebuild_total_ns / 1e6,
               verified_count, mismatches);
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  Args a;
  if (!parse_args(argc, argv, a)) {
    usage();
    return 1;
  }
  try {
    if (a.cmd == "run") return cmd_run(a);
    if (a.cmd == "check") return cmd_check(a);
  } catch (const std::bad_alloc&) {
    std::fprintf(stderr, "error: out of memory\n");
    return 5;
  } catch (const std::exception& e) {
    std::fprintf(stderr, "error: %s\n", e.what());
    return 5;
  }
  usage();
  return 1;
}
