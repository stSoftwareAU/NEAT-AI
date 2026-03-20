## Summary

Removed the `NEAT_RUST_DISCOVERY_OPTIONAL` environment variable. Discovery is
always optional — the Rust library already probes for GPU availability
internally and falls back to CPU when no GPU is present. The
`shouldSkipRustDiscoveryTests()` function now returns `!isRustDiscoveryEnabled()`
directly, skipping tests gracefully when the library is absent without requiring
any environment variable. Closes #1911.

Note: The env var remains in CI workflow files (`.github/workflows/`) because
modifying workflow files requires the `workflow` OAuth scope. The env var is
harmless — the code no longer reads it.

## Evidence

- `shouldSkipRustDiscoveryTests()` simplified to a single-line function that
  returns the inverse of `isRustDiscoveryEnabled()`
- All 4752 existing tests continue to pass (4 pre-existing failures unrelated
  to this change)

## Test Plan

- Added `test/ErrorGuidedStructuralEvolution/RustDiscoveryAlwaysOptional.ts`
  which verifies `shouldSkipRustDiscoveryTests()` returns the inverse of
  `isRustDiscoveryEnabled()` without any environment variable
