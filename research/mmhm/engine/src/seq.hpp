// .seq parser (SPEC 6.1). The whole file is loaded before any timing starts.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace mmhm {

struct Edit {
  uint32_t v[4];   // sorted vertex tuple, unused entries = NONE
  uint32_t line;   // 1-based source line (diagnostics)
  uint8_t n;       // number of vertices (dimension + 1)
  char op;         // '+' or '-'
};

struct Sequence {
  int dim = 0;
  std::vector<Edit> edits;
  // block b occupies edits[block_begin[b] .. block_begin[b+1]); block 0 = INIT,
  // which the parser stably sorts by dimension (file order within a dimension).
  std::vector<size_t> block_begin;

  size_t num_blocks() const { return block_begin.empty() ? 0 : block_begin.size() - 1; }
  size_t num_updates() const { return num_blocks() == 0 ? 0 : num_blocks() - 1; }
  const Edit* block(size_t b) const { return edits.data() + block_begin[b]; }
  size_t block_size(size_t b) const { return block_begin[b + 1] - block_begin[b]; }
};

// Parses `path`; on failure returns false and sets `err` (with line number).
bool parse_seq_file(const std::string& path, Sequence& out, std::string& err);
// Same, from an in-memory buffer (used by tests).
bool parse_seq_text(const std::string& text, Sequence& out, std::string& err);

}  // namespace mmhm
