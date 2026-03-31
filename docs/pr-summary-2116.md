## Summary

Replace GPU `assert!` panics with graceful error returns in NEAT-AI-Discovery,
and add the `requireGpu` field to the Rust `AnalyzeParallelInput` struct. Closes
#2116.

### Rust changes (NEAT-AI-Discovery)

- **`src/ffi_types/requests.rs`**: Added `require_gpu: bool` field to
  `AnalyzeParallelInput` with `#[serde(default = "default_true")]` for backwards
  compatibility. The field is renamed from `requireGpu` via the existing
  `#[serde(rename_all = "camelCase")]` attribute.

- **`src/ffi_internal/analysis.rs`**: Added GPU availability check at the top of
  `analyze_parallel_internal()`. When GPU is unavailable, returns a structured
  JSON error with `success: false`, `errorKind: "GpuPermanent"`, and a
  descriptive message — instead of letting downstream `assert!` calls panic.

- **`src/analysis/neuron/mod.rs`**: Replaced `assert!(gpu_is_available())` with
  `anyhow::bail!()` that returns an error through the `Result` chain.

- **`src/analysis/synapse/orchestration.rs`**: Same treatment as neuron —
  replaced `assert!` with `anyhow::bail!()`.

### TypeScript changes (NEAT-AI)

- **`src/.../RustDiscoveryTypes.ts`**: Added `errorKind?: string` to
  `RustParallelAnalysisResult` interface to surface Rust error classification.

- **`test/.../AnalyzeParallelGpuGuard.ts`**: Added test verifying that the Rust
  layer returns `errorKind: "GpuPermanent"` when GPU is unavailable and
  `requireGpu: false` is passed.

## Evidence

- All 643 Rust library tests pass (`cargo test --lib`)
- All 5174 TypeScript tests pass (`./quality.sh`)
- `cargo clippy` and `cargo fmt` clean
- Defence-in-depth: three layers of GPU protection:
  1. TypeScript guard in `analyzeParallel()` (Issue #2115)
  2. Rust `analyze_parallel_internal()` GPU check (this PR)
  3. Rust analysis functions return `anyhow::bail!()` instead of panicking

## Test Plan

- Added `require_gpu_defaults_to_true_when_omitted` — verifies backwards
  compatibility
- Added `require_gpu_false_is_deserialised_from_camel_case` — verifies serde
  rename
- Added `analyze_parallel_internal_returns_gpu_error_when_unavailable` —
  verifies structured error response on GPU-less machines
- Added TypeScript test for Rust `errorKind: "GpuPermanent"` classification
