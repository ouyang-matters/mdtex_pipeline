// Test runner: `mmhm_tests [prefix]` runs every test whose name starts with prefix.
#include <cstdio>
#include <cstring>

#include "test_util.hpp"

int main(int argc, char** argv) {
  const char* prefix = argc > 1 ? argv[1] : "";
  int run = 0, failed = 0;
  for (auto& tc : t::Registry::get().tests) {
    if (std::strncmp(tc.first.c_str(), prefix, std::strlen(prefix)) != 0) continue;
    ++run;
    try {
      tc.second();
      std::printf("[ ok ] %s\n", tc.first.c_str());
    } catch (const std::exception& e) {
      ++failed;
      std::printf("[FAIL] %s\n       %s\n", tc.first.c_str(), e.what());
    }
    std::fflush(stdout);
  }
  std::printf("%d tests, %d failed\n", run, failed);
  if (run == 0) {
    std::printf("no test matches '%s'\n", prefix);
    return 1;
  }
  return failed ? 1 : 0;
}
