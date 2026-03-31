## Summary

Guard `analyzeParallel()` FFI call when GPU is unavailable, preventing Rust
thread panics from hard `assert!` statements. When the Rust library is loaded
but no GPU adapter is detected, the function now returns a graceful failure
result (`success: false`, error: "GPU adapter not available") instead of
calling into Rust and triggering a thread panic. The guard respects the
`requireGpu` field on `RustParallelAnalysisInput`: when explicitly `false`,
the call proceeds to Rust for CPU fallback analysis. Closes #2115.

## Evidence

- 5174 tests passed, 0 failed after the change
- The guard prevents the 1,034 Rust thread panics and 1,470 repeated error
  messages observed in GRQ-16 logs
- `RustAnalysisCache.ts` already sets `requireGpu: false` (line 150), so
  production discovery calls will continue to reach Rust via CPU fallback

## Test Plan

- Added `test/ErrorGuidedStructuralEvolution/AnalyzeParallelGpuGuard.ts` with:
  - Test that `analyzeParallel()` returns graceful failure when library is
    available but GPU is unavailable (and `requireGpu` is not `false`)
  - Test that `analyzeParallel()` proceeds when `requireGpu: false` even
    without GPU
  - Test that `analyzeParallel()` returns `null` when library is unavailable
- Existing tests pass: `CrossPlatformGpuSupport.ts`,
  `RustDiscoveryCrossPlatformGpu.ts`
