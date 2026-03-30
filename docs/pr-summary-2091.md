## Summary

Replaced all relative import paths with import map aliases defined in `deno.json` to eliminate "The import specifier can be remapped" (`deno(import-map-remap)`) warnings. Closes #2091.

**What changed:**

1. **`deno.json`** — Added import map entries for all `src/` subdirectories (`@blackbox/`, `@breed/`, `@cache/`, `@compact/`, `@config/`, `@costs/`, `@creature/`, `@deprecated/`, `@discovery/`, `@intelligentDesign/`, `@multithreading/`, `@mutate/`, `@neuron/`, `@onnx/`, `@predictiveCoding/`, `@presets/`, `@reconstruct/`, `@transfer/`, `@upgrade/`, `@wasm/`, `@workers/`) and top-level files (`@connectionOptions`, `@costs`, `@creature`), joining the existing aliases (`@architecture/`, `@errors/`, `@methods/`, `@neat/`, `@optimize/`, `@propagate/`, `@utils/`, `@globalAccessors`).

2. **1115 files** across `src/`, `test/`, and `bench/` — Replaced ~4900 relative import specifiers (e.g., `../architecture/Neuron.ts`) with their import map equivalents (e.g., `@architecture/Neuron.ts`).

## Evidence

- `deno check mod.ts` and `deno check test/` pass with no errors
- All 5164 tests pass (`./quality.sh --skip-discovery --skip-wasm`)
- No functional changes — only import specifier strings were modified

## Test Plan

- No new tests needed — this is a purely syntactic change to import paths
- Verified all existing 5164 tests continue to pass
- Verified type-checking passes for both source and test files
