## Summary

Extract shared Rust library crate (`neat-core`) from `wasm_activation`, creating a Cargo workspace that separates core neural network computation from WASM bindings. Closes #1964.

The `wasm_activation/` crate was a single `cdylib` tightly coupled to `wasm-bindgen` and `js-sys`. This refactoring extracts all pure computation into a reusable `neat-core` library crate, leaving `wasm_activation` as a thin `#[wasm_bindgen]` binding layer.

### Changes

- **Cargo workspace** at the project root with two members: `neat-core` (lib) and `wasm_activation` (cdylib)
- **`neat-core` crate** contains all 17 computation modules (`network.rs`, `squash.rs`, `derivative.rs`, `loss.rs`, `simd.rs`, etc.) with zero `wasm-bindgen`/`js-sys` dependencies
- **`wasm_activation` crate** rewritten as thin wrappers that delegate to `neat-core` and apply `#[wasm_bindgen]` attributes for JavaScript interop
- **`.cargo/config.toml`** configures SIMD feature flags (`+simd128`, `+relaxed-simd`) per target — WASM SIMD for `wasm32-unknown-unknown`, no flags for native targets
- **`build.sh`** updated for workspace directory layout (target/ at workspace root, fingerprint includes `neat-core` sources)
- **`.gitignore`** updated to allow `.cargo/` directory and ignore workspace-level `target/` and `Cargo.lock`

### Key design decisions

- Wrapper newtype pattern for `CompiledNetwork` and `PredictiveCodingEngine` — the WASM structs hold a `neat_core::Inner` and delegate all methods
- `JsValue` error returns converted to `String` in neat-core; wasm_activation converts back to `JsValue` at the boundary
- `js_sys::Float32Array`/`Float64Array` return types replaced with native Rust tuples/vecs in neat-core; wasm_activation packs results into JS typed arrays
- `activate_view` (zero-copy `Float32Array` over WASM memory) kept only in `wasm_activation` as it is inherently WASM-specific

## Evidence

- WASM build (`wasm_activation/build.sh`) produces identical output — `pkg/` directory contains all expected artefacts
- `neat-core` compiles and passes **169 unit tests** on native target (`cargo test -p neat-core`)
- Full `quality.sh` passes: **4870 tests passed, 0 failed** (including all existing WASM integration tests)
- `neat-core` has no `wasm-bindgen` or `js-sys` dependencies (verified by grep)

## Test Plan

- Existing 169 Rust unit tests (from all modules) now run in `neat-core` via `cargo test -p neat-core`
- All 4870 Deno tests pass via `quality.sh`, confirming WASM output is functionally identical
- New lib.rs integration tests in `neat-core` verify key types and functions are accessible
- WASM build verified to produce working `pkg/` output with `build.sh`
