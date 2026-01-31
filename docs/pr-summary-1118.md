# PR Summary: WASM Migration Phase 1 - Add WASM Activation Option (#1118)

## Summary

This PR implements WASM Migration Phase 1, adding an optional WASM activation
path to the `Creature` class with automatic fallback to JS when WASM cannot be
used. The library remains fully functional while introducing optional WASM
acceleration.

> **Note (historical):** As of Issue #1263, WASM activation is mandatory and the
> JS fallback/env toggle described below has been removed.

### Changes Made

1. **Extended `activate()` and `activateAndTrace()` methods**
   - Added optional `useWasm?: boolean` parameter (defaults to `false`)
   - When `useWasm=true`, attempts WASM activation with automatic JS fallback

2. **WASM eligibility detection**
   - Added `isWasmEligible()` method to check if creature can use WASM
   - Added `getUnsupportedWasmSquashFunctions()` to identify incompatible
     functions
   - Eligibility result is cached and invalidated on structural changes

3. **Lazy WASM compilation with caching**
   - WASM binary compiled only on first WASM activation request
   - Cached `WasmCreatureActivation` instance reused for subsequent calls
   - Cache invalidated on `clearState()` and structural changes

4. **Resource cleanup**
   - Added `disposeWasm()` method for explicit cleanup
   - Automatic cleanup in `dispose()` and `clearState()` methods
   - WASM eligibility cache invalidated via `invalidateScoreCache()`

### Supported Squash Functions (35 types)

All standard and aggregate squash functions are WASM-supported:

| Category      | Functions                                             |
| ------------- | ----------------------------------------------------- |
| Standard      | IDENTITY, ReLU, ReLU6, LeakyReLU, SELU, ELU           |
| Sigmoid-like  | LOGISTIC, TANH, HARD_TANH, SOFTSIGN, Softplus         |
| Modern        | Swish, Mish, GELU                                     |
| Trigonometric | SINE, Cosine, TAN, ArcTan                             |
| Other         | GAUSSIAN, BENT_IDENTITY, BIPOLAR_SIGMOID, BIPOLAR     |
| Discrete      | STEP, COMPLEMENT                                      |
| Mathematical  | ABSOLUTE, SQUARE, Cube, SQRT, StdInverse, Exponential |
| Advanced      | LogSigmoid, ISRU                                      |
| Aggregate     | MINIMUM, MAXIMUM, IF                                  |

### Unsupported Functions

The following deprecated functions are not supported in WASM:

- `MEAN` - Deprecated aggregate function
- `HYPOT` - Deprecated aggregate function
- `HYPOTv2` - Deprecated aggregate function

> **Note (historical):** The `useJs` parameter and any activation env toggles
> have been removed (Issue #1263).

## Evidence

This is a performance enhancement with no UI changes. The WASM prototype (PR
#1117) demonstrated ~9.5x performance improvement for neural network activation.
This PR integrates that capability into the main Creature API.

### Verification

- All 1518+ existing tests pass without modification
- 17 new unit tests added for WASM integration
- Both JS and WASM paths produce identical results (within floating-point
  tolerance)

## Test Plan

### New Tests Added (`test/CreatureWasmActivation.ts`)

| Test                                       | Description                                |
| ------------------------------------------ | ------------------------------------------ |
| Module initialisation                      | WASM module loads successfully             |
| `activate()` accepts useWasm parameter     | API works with new parameter               |
| `activate()` produces same results         | JS and WASM outputs match                  |
| `activateAndTrace()` accepts useWasm       | API consistency (always uses JS)           |
| `isWasmEligible()` for supported functions | Returns true for WASM-compatible creatures |
| `isWasmEligible()` for MEAN                | Returns false for unsupported function     |
| `isWasmEligible()` for HYPOT               | Returns false for unsupported function     |
| Aggregate functions (IF, MINIMUM, MAXIMUM) | Supported in WASM                          |
| Falls back to JS for unsupported squash    | Automatic fallback works                   |
| Caches compiled WASM activation            | Lazy compilation and reuse                 |
| Invalidates cache on clearState()          | Cache management                           |
| Buffer reuse works with useWasm            | Performance optimisation                   |
| Works with multiple outputs                | Multi-output creatures                     |
| Works with constant neurons                | Constant neuron support                    |
| All supported squash functions             | 35 squash functions verified               |
| `getUnsupportedWasmSquashFunctions()`      | Diagnostic method                          |
| `disposeWasm()` cleans up resources        | Resource management                        |

### Existing Tests

All 1518+ existing tests pass without modification, verifying:

- No breaking changes to public API
- Both JS and WASM paths produce identical results
- Backward compatibility maintained

## API Usage

```typescript
const creature = Creature.fromJSON(creatureJson);
creature.fix();

// Standard JS activation (unchanged)
const jsOutput = creature.activate(input);

// WASM activation (automatic fallback if not supported)
const wasmOutput = creature.activate(input, false, false, true);

// Check WASM eligibility
if (creature.isWasmEligible()) {
  console.log("Creature can use WASM acceleration");
} else {
  const unsupported = creature.getUnsupportedWasmSquashFunctions();
  console.log("Unsupported squash functions:", unsupported);
}

// Explicit cleanup (optional - also called by dispose()/clearState())
creature.disposeWasm();
```

## Breaking Changes

None. All existing code continues to work without modification.
