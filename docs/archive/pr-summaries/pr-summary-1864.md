## Summary

Cross-platform GPU support via wgpu abstraction. The discovery engine now
automatically selects the best GPU backend (Metal on macOS, Vulkan on Linux,
DX12 on Windows) and gracefully falls back to CPU computation when no compatible
GPU is available. Closes #1864.

### Key Changes

- **Automatic backend selection**: wgpu selects Metal/Vulkan/DX12 at runtime —
  no longer hardcoded to macOS Metal only
- **CPU fallback**: Discovery works without GPU hardware (common on headless
  Linux servers). `isRustDiscoveryEnabled()` now only requires the Rust library,
  not GPU
- **Backend diagnostics**: New `backend` field in GPU check result and
  `getRustGpuBackend()` function report which GPU backend is active
- **Cross-platform `requireGpu`**: Changed from `Deno.build.os === "darwin"`
  (macOS-only) to `false` — Rust handles GPU/CPU selection internally

### Rust Changes (NEAT-AI-Discovery)

- Added `backend` field to `GpuAvailabilityResult` and `CheckGpuOutput`
- `check_gpu_availability()` now reports which wgpu backend was selected
- Updated `no_gpu_result()` messaging to mention CPU fallback
- All existing Rust tests pass

## Evidence

- All 4593 Deno tests pass (including 4 new cross-platform GPU tests)
- All Rust tests pass with updated `GpuAvailabilityResult` struct
- GPU backend correctly reported as "metal" on macOS test machine
- No benchmarking required — this is a feature enhancement that enables
  cross-platform support without changing GPU compute paths. Existing Metal
  functionality is preserved (same code paths, same wgpu version)

## Test Plan

- Added `test/ErrorGuidedStructuralEvolution/RustDiscoveryCrossPlatformGpu.ts`:
  - `discovery enabled with library available (CPU fallback supported)` —
    verifies discovery enables with library alone
  - `GPU backend is a known wgpu backend when GPU is available` — verifies
    backend name is one of metal/vulkan/dx12/gl
  - `GPU backend matches platform expectations` — verifies Metal on macOS,
    Vulkan on Linux, DX12 on Windows
  - `discovery does not require GPU — library alone is sufficient` — verifies
    CPU fallback behaviour
- Existing `RustDiscoveryRequired` and `RustDiscoveryPath` tests continue to
  pass
