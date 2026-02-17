## Summary

Add memory leak detection tests for the WASM activation lifecycle, verifying
that WASM resources are properly reclaimed after creature activation, LRU
eviction, worker termination, and FFI cleanup. Closes #1505.

## Evidence

This is a backend/testing change with no UI. All 3888 tests pass (including the
new tests) via `./quality.sh --skip-discovery`.

New test coverage:

- **`test/wasm/WasmMemoryLifecycle.ts`** (10 tests): Verifies `disposeWasm()`
  clears cached state, repeated activate/dispose cycles produce consistent
  output, ephemeral activation leaves no cached WASM, `creature.dispose()` frees
  WASM, and LRU eviction respects capacity bounds with proper disposal of
  evicted creatures.

- **`test/wasm/WorkerMemoryIsolation.ts`** (3 tests): Verifies workers activate
  and terminate cleanly, multiple worker spawn/terminate cycles succeed, and
  worker disposal does not affect parent process WASM state.

- **`test/wasm/FFICleanupLifecycle.ts`** (3 tests): Verifies repeated
  `get_library_version` FFI calls with `free_discovery_result()` cleanup
  succeed, version results are consistent, and library close/reopen cycles work.
  Skipped when the Rust discovery library is unavailable.

## Test Plan

- Added `test/wasm/WasmMemoryLifecycle.ts` — 10 tests for WASM lifecycle
- Added `test/wasm/WorkerMemoryIsolation.ts` — 3 tests for worker isolation
- Added `test/wasm/FFICleanupLifecycle.ts` — 3 tests for FFI cleanup (skipped
  without discovery library)
- Updated `docs/TROUBLESHOOTING.md` with memory leak detection test
  documentation
- All existing tests continue to pass
