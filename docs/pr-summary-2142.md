## Summary

Remove hardcoded `requireGpu: false` from `RustAnalysisCache.ts` so the GPU
guard in `analyzeParallel()` can properly block FFI calls when no GPU is
available. Previously, the hardcoded `false` bypassed the guard, allowing the
Rust library to be called without a GPU, which caused a panic at
`src/analysis/neuron/mod.rs:99:5`. With this fix, `requireGpu` is omitted
(undefined), so `analyzeParallel()` returns a graceful
`{ success: false, error: "GPU adapter not available" }` on machines without a
GPU. Closes #2142.

## Evidence

- Before fix: `requireGpu: false` bypassed the GPU guard, causing Rust panic on
  no-GPU machines.
- After fix: `requireGpu` is omitted, so the guard
  `input.requireGpu !== false && !isRustGpuAvailable()` activates and returns a
  graceful failure.
- All 5212 tests pass (0 failures, 3 ignored).

## Test Plan

- Added `test/ErrorGuidedStructuralEvolution/RustAnalysisCacheGpuGuard.ts` -
  verifies `ensureRustCombinedAnalysis` does not pass `requireGpu: false` to
  `analyzeParallel()`.
- Updated `test/discovery/CrossPlatformGpuSupport.ts` - two tests updated to
  assert `requireGpu` is `undefined` (omitted) rather than `false`.
- Existing `test/ErrorGuidedStructuralEvolution/AnalyzeParallelGpuGuard.ts`
  continues to pass unchanged.
