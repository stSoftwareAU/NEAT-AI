## Summary

Add dedicated unit tests for five WASM modules that previously lacked isolated
test coverage. These tests verify the individual logic of each module rather
than end-to-end behavioural flows. Closes #1484.

### New test files (46 tests total)

| Test file                                | Module under test              | Tests |
| ---------------------------------------- | ------------------------------ | ----- |
| `test/wasm/CompileToWasm.ts`             | `CompileToWasm.ts`             | 14    |
| `test/wasm/WasmModuleLoader.ts`          | `WasmModuleLoader.ts`          | 14    |
| `test/wasm/WasmCreatureActivationLRU.ts` | `WasmCreatureActivationLRU.ts` | 11    |
| `test/wasm/WasmAutoInit.ts`              | `WasmAutoInit.ts`              | 3     |
| `test/wasm/EnsureWasmActivation.ts`      | `EnsureWasmActivation.ts`      | 4     |

### What is covered

- **CompileToWasm**: Binary layout (header, bias encoding, squash type, synapse
  count, synapse from_index/weight/type, constant neuron flag), total binary
  size calculation, hidden neuron compilation, statistics output, and
  SynapseTypeCode enum values.
- **WasmModuleLoader**: Module availability after init, idempotent
  initialisation, all function pointer getters returning non-null, version
  function producing a non-empty string, and sync init short-circuit when
  already initialised.
- **WasmCreatureActivationLRU**: Capacity get/set, minimum clamping to 1, floor
  to integer, noteUse safety (single and repeated), eviction triggering
  disposeWasm on the oldest creature, evictOldest edge cases (0, negative, large
  count), and capacity reduction triggering immediate eviction.
- **WasmAutoInit**: WASM availability after module import and
  isProbablyWorkerScope returning false in the main thread.
- **EnsureWasmActivation**: Success when WASM is already available, idempotent
  calls, WASM functions being usable afterwards, and concurrent calls all
  resolving successfully.

## Evidence

This is a testing-only change with no UI or performance impact. All 3731 tests
(including 46 new) pass via `./quality.sh`:

```
ok | 3731 passed (2 steps) | 0 failed
```

## Test Plan

- Added `test/wasm/CompileToWasm.ts` — 14 tests for binary compilation format
- Added `test/wasm/WasmModuleLoader.ts` — 14 tests for module loading and
  function getters
- Added `test/wasm/WasmCreatureActivationLRU.ts` — 11 tests for LRU cache
  behaviour
- Added `test/wasm/WasmAutoInit.ts` — 3 tests for auto-initialisation
- Added `test/wasm/EnsureWasmActivation.ts` — 4 tests for activation guarantees
- No existing tests were modified or removed
