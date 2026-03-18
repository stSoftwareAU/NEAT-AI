## Summary

Enable cross-platform GPU support via the wgpu abstraction layer. The existing
Rust discovery engine already uses wgpu which supports Metal (macOS), Vulkan
(Linux), and DX12 (Windows). This change removes the macOS-only GPU requirement
from the TypeScript layer and adds automatic CPU fallback, GPU backend detection,
and cross-platform documentation. Closes #1864.

### Key Changes

- **Removed macOS-only GPU hardcoding**: Changed `requireGpu: Deno.build.os === "darwin"` to `requireGpu: false` in `RustAnalysisCache.ts`, enabling cross-platform GPU support with CPU fallback on all platforms.
- **Separated GPU requirement from discovery enablement**: `isRustDiscoveryEnabled()` now only requires the Rust library (not GPU). Discovery works via CPU fallback when no GPU is detected.
- **Added GPU backend detection**: New `getGpuBackendInfo()` function and `GpuBackendInfo` type report which wgpu backend (Metal/Vulkan/DX12/OpenGL) was selected, or the reason for CPU fallback.
- **Extended `RustCheckGpuResult`**: Added optional `backendName` and `adapterName` fields for cross-platform GPU diagnostics.
- **Improved logging**: GPU probe messages changed from warnings to info messages since GPU is no longer required. Logs report which backend was selected.

## Evidence

- All 4606 existing tests pass (no regressions)
- 17 new tests verify cross-platform GPU support:
  - `requireGpu` is `false` for cross-platform CPU fallback
  - CPU fallback analysis succeeds with `gpuUsed=false`
  - GPU-accelerated analysis reports `gpuUsed=true`
  - `RustCheckGpuResult` accepts backend info (Metal, Vulkan, DX12)
  - `RustCheckGpuResult` works without backend info (older Rust library)
  - `GpuBackendInfo` type covers all expected platform backends
  - `getGpuBackendInfo()` returns structured, consistent results
  - Discovery proceeds when library is available but GPU is not
  - Discovery is skipped when library is unavailable

## Test Plan

- Added `test/discovery/CrossPlatformGpuSupport.ts` (13 tests): verifies `requireGpu: false`, CPU fallback behaviour, GPU acceleration reporting, backend info types, and discovery enablement logic.
- Added `test/discovery/GpuBackendDetection.ts` (4 tests): verifies `getGpuBackendInfo()` returns structured results, consistency across calls, agreement with `isRustGpuAvailable()`, and type coverage for all platform backends.
