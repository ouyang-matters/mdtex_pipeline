#include "seq.hpp"

#include <cstdio>
#include <cstring>

#include "smallvec.hpp"

namespace mmhm {

namespace {

struct LineReader {
  const char* p;
  const char* end;
  uint32_t lineno = 0;
  // Returns the next line with comments stripped and trailing space trimmed.
  bool next(const char*& b, const char*& e) {
    if (p >= end) return false;
    const char* nl = static_cast<const char*>(std::memchr(p, '\n', size_t(end - p)));
    const char* le = nl ? nl : end;
    b = p;
    e = le;
    p = nl ? nl + 1 : end;
    ++lineno;
    const char* h = static_cast<const char*>(std::memchr(b, '#', size_t(e - b)));
    if (h) e = h;
    while (b < e && (*b == ' ' || *b == '\t' || *b == '\r')) ++b;
    while (e > b && (e[-1] == ' ' || e[-1] == '\t' || e[-1] == '\r')) --e;
    return true;
  }
};

bool word_is(const char* b, const char* e, const char* w) {
  size_t n = std::strlen(w);
  return size_t(e - b) == n && std::memcmp(b, w, n) == 0;
}

std::string at(uint32_t line, const std::string& msg) {
  return "line " + std::to_string(line) + ": " + msg;
}

}  // namespace

bool parse_seq_text(const std::string& text, Sequence& out, std::string& err) {
  out = Sequence();
  LineReader lr{text.data(), text.data() + text.size()};
  const char *b, *e;
  enum { HEADER, DIM, OUTSIDE, IN_INIT, IN_UPDATE } st = HEADER;
  bool seen_init = false;
  out.edits.reserve(text.size() / 12 + 16);
  while (lr.next(b, e)) {
    if (b == e) continue;
    const uint32_t ln = lr.lineno;
    switch (st) {
      case HEADER: {
        if (!word_is(b, e, "MMHMSEQ 1")) {
          err = at(ln, "expected header 'MMHMSEQ 1'");
          return false;
        }
        st = DIM;
        break;
      }
      case DIM: {
        if (e - b < 5 || std::memcmp(b, "dim ", 4) != 0) {
          err = at(ln, "expected 'dim <D>'");
          return false;
        }
        const char* q = b + 4;
        while (q < e && *q == ' ') ++q;
        if (q + 1 != e || *q < '0' || *q > '3') {
          err = at(ln, "dim must be 0..3");
          return false;
        }
        out.dim = *q - '0';
        st = OUTSIDE;
        break;
      }
      case OUTSIDE: {
        if (word_is(b, e, "INIT")) {
          if (seen_init) {
            err = at(ln, "second INIT block");
            return false;
          }
          seen_init = true;
          out.block_begin.push_back(out.edits.size());
          st = IN_INIT;
        } else if (word_is(b, e, "UPDATE")) {
          if (!seen_init) {
            err = at(ln, "UPDATE before INIT");
            return false;
          }
          out.block_begin.push_back(out.edits.size());
          st = IN_UPDATE;
        } else {
          err = at(ln, "expected INIT or UPDATE");
          return false;
        }
        break;
      }
      case IN_INIT:
      case IN_UPDATE: {
        if (word_is(b, e, "END")) {
          st = OUTSIDE;
          break;
        }
        char op = *b;
        if (op != '+' && op != '-') {
          err = at(ln, "expected '+', '-' or END");
          return false;
        }
        if (st == IN_INIT && op == '-') {
          err = at(ln, "deletion inside INIT");
          return false;
        }
        Edit ed;
        ed.op = op;
        ed.line = ln;
        ed.n = 0;
        for (int i = 0; i < 4; ++i) ed.v[i] = NONE;
        const char* q = b + 1;
        while (true) {
          while (q < e && (*q == ' ' || *q == '\t')) ++q;
          if (q >= e) break;
          if (*q < '0' || *q > '9') {
            err = at(ln, "bad vertex token");
            return false;
          }
          uint64_t x = 0;
          while (q < e && *q >= '0' && *q <= '9') {
            x = x * 10 + uint64_t(*q - '0');
            if (x >= NONE) {
              err = at(ln, "vertex id out of range (must be < 4294967295)");
              return false;
            }
            ++q;
          }
          if (q < e && *q != ' ' && *q != '\t') {
            err = at(ln, "bad vertex token");
            return false;
          }
          if (ed.n == 4) {
            err = at(ln, "more than 4 vertices");
            return false;
          }
          ed.v[ed.n++] = uint32_t(x);
        }
        if (ed.n == 0) {
          err = at(ln, "simplex without vertices");
          return false;
        }
        if (ed.n > out.dim + 1) {
          err = at(ln, "simplex dimension exceeds header dim");
          return false;
        }
        sort_small(ed.v, ed.n);
        for (int i = 1; i < ed.n; ++i)
          if (ed.v[i] == ed.v[i - 1]) {
            err = at(ln, "repeated vertex");
            return false;
          }
        out.edits.push_back(ed);
        break;
      }
    }
  }
  if (st == HEADER || st == DIM) {
    err = "missing header";
    return false;
  }
  if (st == IN_INIT || st == IN_UPDATE) {
    err = "unterminated block at end of file";
    return false;
  }
  if (!seen_init) {
    err = "missing INIT block";
    return false;
  }
  out.block_begin.push_back(out.edits.size());
  return true;
}

bool parse_seq_file(const std::string& path, Sequence& out, std::string& err) {
  FILE* f = std::fopen(path.c_str(), "rb");
  if (!f) {
    err = "cannot open " + path;
    return false;
  }
  std::string text;
  if (std::fseek(f, 0, SEEK_END) == 0) {
    long sz = std::ftell(f);
    if (sz > 0) text.reserve(size_t(sz));
    std::fseek(f, 0, SEEK_SET);
  }
  char buf[1 << 16];
  size_t got;
  while ((got = std::fread(buf, 1, sizeof buf, f)) > 0) text.append(buf, got);
  std::fclose(f);
  if (!parse_seq_text(text, out, err)) {
    err = path + ": " + err;
    return false;
  }
  return true;
}

}  // namespace mmhm
