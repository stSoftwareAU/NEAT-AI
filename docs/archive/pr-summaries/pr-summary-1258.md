## Summary

Fix WASM activation loading in Deno Worker contexts (issue #1258).

> **Note (historical):** As of Issue #1263, WASM activation is mandatory and the
> JS fallback/activation toggles mentioned in older docs have been removed.

When a Deno `Worker` independently imports NEAT-AI and calls
`Creature.activate()`, WASM auto-initialisation was previously skipped for
worker scopes (unless `NEAT_AI_WASM_PKG_PATH` was explicitly set). This caused
the library to throw:

> WASM activation could not be loaded. Ensure the NEAT-AI package is installed
> correctly.

**Changes:**

1. **`src/wasm/WasmActivation.ts`**: Auto-initialisation now runs in both the
   main thread and worker contexts. The previous guard that skipped workers
   (unless `NEAT_AI_WASM_PKG_PATH` was set) has been removed so WASM loads
   transparently everywhere.

2. **`src/Creature.ts`**: `requireWasmOrThrow()` now detects worker scopes.
   (This behaviour was later superseded by Issue #1263, which makes WASM
   mandatory and removes fallback/toggles.)

3. **`src/wasm/mod.ts`**: Exported the new `isProbablyWorkerScope()` helper so
   `Creature.ts` can use it.

4. **`README.md`**: Updated the activation documentation to reflect transparent
   Worker support and automatic fallback behaviour.

No caller-visible API changes. No environment variables required.

## Evidence

Unable to generate screenshot: This is a CLI-only library with no visual
interface.

## Test Plan

- Added `test/wasm/WorkerActivation.ts` — spawns a Deno `Worker` that creates a
  `Creature`, calls `activate()`, and posts the result back. Verifies that the
  worker succeeds without any caller-set environment variables and that the
  outputs are finite numbers.
- First phase of `quality.sh` (discovery tests without FFI) passed: 34 passed, 0
  failed.
- Full `quality.sh` suite runs without regressions from these changes.
