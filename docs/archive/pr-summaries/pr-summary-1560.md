# PR Summary: Rust/WASM Predictive Coding Inference Engine

Closes #1560

## Overview

Adds a high-performance Predictive Coding (PC) inference engine implemented in
Rust and compiled to WebAssembly. The engine mirrors the existing TypeScript
reference implementation (`src/predictiveCoding/`) and provides two core
capabilities:

1. **Inference (settling)** — iterative energy-minimisation loop where hidden
   neuron latent values converge to minimise prediction error.
2. **Hebbian learning** — local weight and bias gradient computation from
   settled inference state.

## Changes

### New Rust modules (`wasm_activation/src/`)

- **`pc_inference.rs`** — Core `PredictiveCodingEngine` struct with:
  - Binary deserialisation constructor (from packed `Uint8Array`)
  - `infer()` / `infer_batch()` methods matching the TypeScript settling loop
  - Input/target clamping, early convergence termination, energy history
  - WASM bindings via `wasm_bindgen`: `infer_wasm()`, `infer_batch_wasm()`
  - 14 unit tests (determinism, clamping, convergence, batch consistency, etc.)

- **`pc_learning.rs`** — Hebbian gradient computation:
  - `compute_gradients()` implementing ΔW(j→i) = η · f'(a(i)) · ε(i) · x(j)
  - WASM binding `compute_gradients_wasm()` with packed Float32Array output
  - 5 unit tests (identity/tanh/relu squash, zero error, multiple connections)

### Modified (`wasm_activation/src/lib.rs`)

- Added `mod pc_inference` and `mod pc_learning` declarations
- Re-exported `PredictiveCodingEngine` for WASM consumers

### New TypeScript wrapper (`src/wasm/WasmPredictiveCoding.ts`)

- `WasmPredictiveCodingEngine` interface with `Symbol.dispose` support
- `parseInferenceResult()` / `parseGradientResult()` — unpack WASM output
- `serialisePcTopology()` — binary serialisation for the Rust constructor

### New TypeScript tests (`test/wasm/WasmPredictiveCoding.ts`)

- 6 tests covering serialisation format, parsing, roundtrip, edge cases

## Evidence

- **Rust tests**: All 200 cargo tests pass (including 18 new PC tests)
- **TypeScript tests**: All 6 new WASM PC tests pass
- **Full quality suite**: `./quality.sh --skip-discovery --skip-wasm` passes
  with 4300+ tests, 0 failures, exit code 0
- **Lint/fmt/type-check**: All clean

## Test Plan

- [x] `cargo test` in `wasm_activation/` — 200 tests pass
- [x] `deno test test/wasm/WasmPredictiveCoding.ts` — 6 tests pass
- [x] `./quality.sh --skip-discovery --skip-wasm` — full suite passes
- [ ] WASM build (`wasm_activation/build.sh`) — requires wasm-pack toolchain
- [ ] End-to-end integration with creature topology via `serialisePcTopology()`
