## Summary

Reduce WASM CompiledNetwork memory retention for data-generation workloads. Closes #1504.

### Changes

1. **`creature.activateEphemeral(input, feedbackLoop)`** — new activation method that compiles a one-shot WASM CompiledNetwork, activates, and immediately frees it. For workloads that touch thousands of creatures but only activate each one once or twice, this prevents WASM heap build-up. If the creature already has a cached activation, it reuses it (safe to mix with normal `activate()`).

2. **`getCachedWasmActivationCount()`** — new diagnostic function that returns the current number of entries in the WASM activation LRU cache. Exported from both `src/wasm/mod.ts` and the top-level `mod.ts` alongside the existing `setMaxCachedWasmCreatureActivations()` and `getMaxCachedWasmCreatureActivations()`.

3. **Top-level exports** — `getCachedWasmActivationCount`, `getMaxCachedWasmCreatureActivations`, and `setMaxCachedWasmCreatureActivations` are now exported from the root `mod.ts` so data-gen workloads can control and monitor WASM cache pressure without deep imports.

### Usage for data-gen workloads

```ts
import { Creature, setMaxCachedWasmCreatureActivations } from "./mod.ts";

// Lower cache cap for data-gen (default is 512)
setMaxCachedWasmCreatureActivations(64);

// For one-off activations, use ephemeral mode — no WASM heap retention
const output = creature.activateEphemeral(input);
```

## Evidence

This is a backend/API change with no visual output. Evidence is provided by the test suite:
- All 3865 tests pass including the new ephemeral activation tests
- New tests verify that ephemeral activation produces identical outputs to normal activation
- New tests verify that ephemeral activation does not inflate the LRU cache

## Test Plan

- `test/wasm/EphemeralActivation.ts` — 7 new tests:
  - `activateEphemeral: produces same output as activate`
  - `activateEphemeral: does not cache CompiledNetwork on creature`
  - `activateEphemeral: works when creature already has a cached activation`
  - `activateEphemeral: does not affect LRU cache count`
  - `getCachedWasmActivationCount: returns current entry count`
  - `getCachedWasmActivationCount: increases after activate`
- Existing `test/wasm/WasmCreatureActivationLRU.ts` tests continue to pass unchanged
