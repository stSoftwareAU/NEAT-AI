# Prefer native neat-core for topological backprop (Issue #3741)

## Summary

Native topological backprop is wired but **opt-in**, using the same pattern as
the Rust scorer: the handwritten TypeScript tests are not rewritten. An
environment flag swaps the implementation underneath `train()` /
`propagateTopological`. WASM stays the default until `./quality.sh --next` is
green **and** a bench shows a win.

- `./quality.sh --next` / `NEAT_AI_NATIVE_CORE_BACKPROP=1` —
  `wasmPropagateTopological` calls the native C ABI
  (`neat_propagate_topological`, NEAT-AI-core #540) with the same packed buffer
  WASM already uses. Existing `test/propagate/**` and `trainDir` tests exercise
  this path.
- `NEAT_AI_BACKPROP_ENABLED=1` — `trainDir` spawns sibling
  `neat_ai_backpropagation train`. This is a later host-path change, not part of
  `--next`, because spawning a process per evolve train is not how the scorer
  was proven.

Custom costs, recurrent graphs, predictive coding, cross-validation, dropout,
fuzzing, quantisation, and Muon stay on the TypeScript loop.

Resolution for `libneat_core` (first match): `NEAT_AI_CORE_LIB_PATH`,
`~/.cargo/lib/`, `./target/release/`, sibling `../NEAT-AI-core/target/release/`.

Resolution for the trainer (first match): `NEAT_AI_BACKPROP_BINARY_PATH`,
`./target/release/`, sibling `../NEAT-AI-Backpropagation/target/release/`. Apply
step scale: `NEAT_AI_BACKPROP_STEP_SCALE` (default `0.01`).

## Tests

New `test/wasm/NativeCoreLibrary.ts` and
`test/architecture/training/RustTrainDirBridge.ts` only. Existing
`test/propagate/**` and `trainDir` tests are not edited; `--next` is how they
confirm the native loop.
