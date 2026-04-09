## Summary

Add integration test for the full discovery analysis path on CPU-only machines
(no GPU). The test exercises `ensureRustCombinedAnalysis` → `analyzeParallel`
with a stubbed GPU guard that simulates GPU unavailability, verifying graceful
degradation rather than thread panics. Closes #2143.

## Evidence

All 5 new tests pass on the test machine. The full quality gate (`./quality.sh`)
passes with 5217 tests, 0 failures.

Test coverage includes:

- `ensureRustCombinedAnalysis` returns `{ result: undefined, cache: undefined }`
  when GPU is unavailable
- Both synapse and neuron scopes log unavailability messages confirming CPU
  fallback
- No exceptions thrown during the GPU-unavailable flow (the primary concern from
  Issue #2141)
- `requireGpu` is omitted from the input (not hardcoded to `false`), allowing
  the GPU guard to protect FFI calls
- Discovery disabled path returns undefined without calling analysis

## Test Plan

- Added `test/discovery/CpuOnlyDiscoveryIntegration.ts` with 5 integration
  tests:
  1. `ensureRustCombinedAnalysis returns undefined result when GPU unavailable`
  2. `both synapse and neuron scopes log unavailability`
  3. `no exceptions thrown during GPU-unavailable flow`
  4. `analyzeParallel receives requireGpu omitted, enabling GPU guard`
  5. `discovery disabled returns undefined without calling analysis`
- Tests pass on machines both with and without GPU (uses dependency injection
  stubs)
- Follows existing patterns from `test/ErrorGuidedStructuralEvolution/` and
  `test/discovery/CrossPlatformGpuSupport.ts`
