# Prefer native neat-core for topological backprop (Issue #3741)

## Summary

When `libneat_core` is present, `wasmPropagateTopological` calls the native C
ABI (`neat_propagate_topological`, NEAT-AI-core #540) with the same packed
buffer WASM already uses.

`trainDir` (reached from production `evolveDir`) spawns sibling
`neat_ai_backpropagation train` when the binary is present and the request is
one the CLI can honour. Custom costs, recurrent graphs, predictive coding,
cross-validation, dropout, fuzzing, quantisation, and Muon stay on the
TypeScript loop so those tests remain unaltered.

Resolution for `libneat_core` (first match): `NEAT_AI_CORE_LIB_PATH`,
`~/.cargo/lib/`, `./target/release/`, sibling `../NEAT-AI-core/target/release/`.

Resolution for the trainer (first match): `NEAT_AI_BACKPROP_BINARY_PATH`,
`./target/release/`, sibling `../NEAT-AI-Backpropagation/target/release/`. Apply
step scale: `NEAT_AI_BACKPROP_STEP_SCALE` (default `0.01`).

`quality.sh` builds both sibling release artefacts when those checkouts exist.

## Tests

New `test/wasm/NativeCoreLibrary.ts` and
`test/architecture/training/RustTrainDirBridge.ts` only. Existing
`test/propagate/**` and `trainDir` tests are not edited.
