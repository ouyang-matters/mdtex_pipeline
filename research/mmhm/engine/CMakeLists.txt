cmake_minimum_required(VERSION 3.16)
project(mmhm_engine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type (Release or Debug)" FORCE)
endif()

# Reproducible flags (SPEC / experiments/ENVIRONMENT.md): no -march=native.
set(CMAKE_CXX_FLAGS_RELEASE "-O2 -DNDEBUG" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_DEBUG "-O1 -g" CACHE STRING "" FORCE)

add_compile_options(-Wall -Wextra -Wno-unused-parameter)

add_library(mmhm_core STATIC
  src/seq.cpp
  src/complex.cpp
  src/morse.cpp
  src/static_reduce.cpp
  src/drb.cpp
  src/lcr.cpp
  src/methods.cpp
)
target_include_directories(mmhm_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)
# Debug: explicit DRB invariant checks (I1)-(I3) after every DRB operation.
target_compile_definitions(mmhm_core PUBLIC $<$<CONFIG:Debug>:MMHM_CHECKS>)

add_executable(mmhm src/main.cpp)
target_link_libraries(mmhm PRIVATE mmhm_core)

# Synthetic .seq generator used by the tests and the sanity runs (not the
# paper's workloads, which live in ../workloads).
add_executable(gen_seq tools/gen_seq.cpp)

# ---------------------------------------------------------------- tests ----
enable_testing()

add_executable(mmhm_tests
  tests/test_main.cpp
  tests/test_unit.cpp
  tests/test_known.cpp
  tests/test_e1.cpp
  tests/test_apparent.cpp
  tests/test_random.cpp
)
target_link_libraries(mmhm_tests PRIVATE mmhm_core)
# GCC 13 reports false positives on inlined small-buffer / vector::erase code.
target_compile_options(mmhm_tests PRIVATE -Wno-array-bounds -Wno-stringop-overflow)

foreach(group unit known e1 apparent random_small random_cases random_rebuild random_wide random_dim2)
  add_test(NAME ${group} COMMAND mmhm_tests ${group})
endforeach()

# End-to-end CLI tests on generated sequences, every method with --verify-every 1.
set(SEQDIR ${CMAKE_CURRENT_BINARY_DIR}/testdata)
add_test(NAME gen_ball COMMAND gen_seq ball --n 3 --updates 60 --batch 6 --seed 7 --out ${SEQDIR}/ball.seq)
add_test(NAME gen_torus COMMAND gen_seq torus --n 6 --m 5 --updates 60 --batch 3 --seed 3 --out ${SEQDIR}/torus.seq)
set_tests_properties(gen_ball gen_torus PROPERTIES FIXTURES_SETUP seqs)
add_test(NAME cli_check_ball COMMAND mmhm check --seq ${SEQDIR}/ball.seq)
add_test(NAME cli_check_torus COMMAND mmhm check --seq ${SEQDIR}/torus.seq)
set_tests_properties(cli_check_ball cli_check_torus PROPERTIES FIXTURES_REQUIRED seqs)
foreach(m full-id full-morse drb-id drb-id-rb mmhm mmhm-norb lcr)
  add_test(NAME cli_ball_${m} COMMAND mmhm run --method ${m} --seq ${SEQDIR}/ball.seq
    --verify-every 1 --out ${SEQDIR}/ball_${m}.csv --betti-out ${SEQDIR}/ball_${m}.betti)
  set_tests_properties(cli_ball_${m} PROPERTIES FIXTURES_REQUIRED seqs)
endforeach()
foreach(m full-id full-morse drb-id drb-id-rb mmhm mmhm-norb lcr euler)
  add_test(NAME cli_torus_${m} COMMAND mmhm run --method ${m} --seq ${SEQDIR}/torus.seq
    --verify-every 1 --out ${SEQDIR}/torus_${m}.csv)
  set_tests_properties(cli_torus_${m} PROPERTIES FIXTURES_REQUIRED seqs)
endforeach()
# Same runs without verification (the store then skips the insertion index).
foreach(m full-id full-morse drb-id drb-id-rb mmhm mmhm-norb)
  add_test(NAME cli_ball_noverify_${m} COMMAND mmhm run --method ${m} --seq ${SEQDIR}/ball.seq
    --out ${SEQDIR}/ball_nv_${m}.csv --betti-out ${SEQDIR}/ball_nv_${m}.betti)
  set_tests_properties(cli_ball_noverify_${m} PROPERTIES FIXTURES_REQUIRED seqs)
endforeach()
add_test(NAME cli_ball_mmhm_rebuilds COMMAND mmhm run --method mmhm --seq ${SEQDIR}/ball.seq
  --verify-every 1 --alpha 0.05 --period 4 --out ${SEQDIR}/ball_mmhm_rb.csv)
set_tests_properties(cli_ball_mmhm_rebuilds PROPERTIES FIXTURES_REQUIRED seqs)
add_test(NAME cli_ball_drb-id-rb_rebuilds COMMAND mmhm run --method drb-id-rb --seq ${SEQDIR}/ball.seq
  --verify-every 1 --alpha 0.05 --period 4 --out ${SEQDIR}/ball_drb-id-rb_rb.csv
  --betti-out ${SEQDIR}/ball_drb-id-rb_rb.betti)
set_tests_properties(cli_ball_drb-id-rb_rebuilds PROPERTIES FIXTURES_REQUIRED seqs)
# euler must refuse a 3-dimensional complex (exit 4).
add_test(NAME cli_euler_rejects_ball COMMAND mmhm run --method euler --seq ${SEQDIR}/ball.seq)
set_tests_properties(cli_euler_rejects_ball PROPERTIES FIXTURES_REQUIRED seqs WILL_FAIL TRUE)
# Betti files of all exact methods must be identical.
add_test(NAME cli_betti_agree COMMAND ${CMAKE_COMMAND}
  -DDIR=${SEQDIR} -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/compare_betti.cmake)
set_tests_properties(cli_betti_agree PROPERTIES DEPENDS
  "cli_ball_full-id;cli_ball_full-morse;cli_ball_drb-id;cli_ball_drb-id-rb;cli_ball_mmhm;cli_ball_mmhm-norb;cli_ball_noverify_full-id;cli_ball_noverify_full-morse;cli_ball_noverify_drb-id;cli_ball_noverify_drb-id-rb;cli_ball_noverify_mmhm;cli_ball_noverify_mmhm-norb;cli_ball_drb-id-rb_rebuilds"
  FIXTURES_REQUIRED seqs)
