## Summary

Audit of test files in `test/discovery/` (77 files) and `test/ErrorGuidedStructuralEvolution/` (30 files) for quality issues including duplicates, implementation-detail ("how") tests, meaningless tests, and timing-based assertions. Addresses #1767.

### Changes made

**Duplicates removed (3 files/tests):**
- `test/discovery/CoordinatedStructuralCacheV2.ts` — exact duplicate of `CoordinatedStructuralCache.ts` (2 tests with identical names, setup, and assertions)
- `test/ErrorGuidedStructuralEvolution/RustDiscoveryReadLargeCString.ts` — near-duplicate of `RustDiscoveryCStringLimit.ts` (both test large JSON payload handling via mocked Rust FFI)
- `test/ErrorGuidedStructuralEvolution/DiscoverInputOptimization.ts` — removed third test ("Binary optimisation: Input values read from binary match expected values") which was a near-duplicate of the first test

**How-test removed (1 file):**
- `test/ErrorGuidedStructuralEvolution/DiscoveryDiagnostics.ts` — tested that `logRustNoImprovement` produces specific `console.warn` messages (implementation detail, not behaviour)

**Timing-based tests fixed (2 files):**
- `test/ErrorGuidedStructuralEvolution/InvalidDataDetection.ts` — removed `Date.now()` elapsed-time assertion that is unreliable in parallel test execution
- `test/ErrorGuidedStructuralEvolution/PromiseChainErrorHandling.ts` — removed trivially-true test (Promise.allSettled always settles all promises), removed duplicate setTimeout-based deadlock test, kept one simplified test that relies on the test runner's own timeout instead

**Diagnostic/noisy test cleaned (1 file):**
- `test/ErrorGuidedStructuralEvolution/NeuronDiscoveryIntegration.ts` — removed explicit "DIAGNOSTIC" test (no assertions, just console output), removed excessive `console.log` noise from remaining 4 integration tests, improved test names

**Cross-area duplicates:** No significant duplicates found between `test/discovery/` and `test/ErrorGuidedStructuralEvolution/` — files with similar names (e.g., DiscoveryDiagnostics, DiscoveryTimeout) test complementary functionality.

## Evidence
- All 4763 tests pass after changes
- `./quality.sh` passes cleanly (lint, format, type-check, tests)
- Net removal of ~959 lines across 7 files (3 deleted, 4 modified)

## Test Plan
- Verified all remaining tests pass: `ok | 4763 passed | 0 failed`
- No test behaviour was changed — only duplicates, how-tests, timing assertions, and diagnostic noise were removed
