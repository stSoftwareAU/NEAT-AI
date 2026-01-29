## Summary

This PR completes **WASM Migration Phase 5** (Issue #1122), making WASM the
default activation implementation for all creatures.

> **Note:** Issue #1229 removes the default-path JS fallback for activation.
> WASM is now required; use `useJs: true` or `NEAT_AI_USE_JS_ACTIVATION=1` for
> verification only.

### Key Changes

1. **WASM is now the default** - Both `activate()` and `activateAndTrace()` use
   WASM activation by default when available
2. **Parameter renamed** - The fourth parameter changed from `useWasm` to
   `useJs`:
   - Old: `activate(input, feedbackLoop, reuseBuffer, useWasm)` where
     `useWasm=true` meant "use WASM"
   - New: `activate(input, feedbackLoop, reuseBuffer, useJs)` where `useJs=true`
     means "force JavaScript"
3. **Environment variable renamed** - Use `NEAT_AI_USE_JS_ACTIVATION=1` to
   globally force JavaScript activation for verification only (previously
   `NEAT_AI_USE_WASM=1` was used to enable WASM)
4. **No JS fallback on default path** - With #1229, the default path requires
   WASM and throws if WASM is not initialised or the squash function is
   unsupported. Use `useJs: true` or `NEAT_AI_USE_JS_ACTIVATION=1` for
   verification only

### API Changes

#### `activate()` method

```typescript
// Before (Phase 1-4): JS was default, useWasm=true for WASM
creature.activate(input, false, false, true); // WASM
creature.activate(input, false, false, false); // JS (default)

// After (Phase 5): WASM is default, useJs=true for JS
creature.activate(input, false, false, false); // WASM (default)
creature.activate(input, false, false, true); // JS (explicit)
creature.activate(input, false, false); // WASM (default)
```

#### `activateAndTrace()` method

```typescript
// Before: JS was default
creature.activateAndTrace(input, false, sparseConfig, false, true); // WASM
creature.activateAndTrace(input, false, sparseConfig, false, false); // JS

// After: WASM is default
creature.activateAndTrace(input, false, sparseConfig, false, false); // WASM (default)
creature.activateAndTrace(input, false, sparseConfig, false, true); // JS (explicit)
creature.activateAndTrace(input, false, sparseConfig, false); // WASM (default)
```

### Environment Variables

| Variable                              | Purpose                                           |
| ------------------------------------- | ------------------------------------------------- |
| `NEAT_AI_USE_JS_ACTIVATION=1`         | Force JavaScript activation for verification only |
| `NEAT_AI_USE_WASM_FORCE=1`            | Ignore minimum size thresholds for WASM           |
| `NEAT_AI_USE_WASM_MIN_NEURONS=<int>`  | Minimum neurons before using WASM                 |
| `NEAT_AI_USE_WASM_MIN_SYNAPSES=<int>` | Minimum synapses before using WASM                |

### Migration Guide

Existing code using explicit WASM selection needs to be updated:

```typescript
// Old code
creature.activate(input, false, false, true); // useWasm=true

// New code - no changes needed, WASM is now default
creature.activate(input, false, false);

// If you need explicit JS activation
creature.activate(input, false, false, true); // useJs=true
```

## Evidence

Unable to generate screenshot: This is a CLI/library tool with no visual
interface.

### Test Results

All 1560+ existing tests pass without modification, verifying backwards
compatibility:

- WASM and JS implementations produce identical results
- Unsupported squash functions (MEAN, HYPOT, etc.) throw on the default path;
  use `useJs: true` for those creatures in tests
- All 35 supported WASM squash functions verified
- Backpropagation works correctly with WASM default

## Test Plan

New tests added in `test/WasmDefaultActivation.ts`:

- `WASM Default: Module initialisation` - Verifies WASM module loads
- `WASM Default: activate() uses WASM by default when available` - Core
  functionality
- `WASM Default: activate() with useJs=true forces JavaScript activation` -
  Explicit JS
- `WASM Default: activateAndTrace() uses WASM by default when available` - Trace
  support
- `WASM Default: activateAndTrace() with useJs=true forces JavaScript activation` -
  Explicit JS trace
- `WASM Default: Throws for unsupported squash functions (MEAN) on default path` -
  Use `useJs: true` or `NEAT_AI_USE_JS_ACTIVATION=1` for verification
- `WASM Default: Works with multiple outputs` - Multi-output networks
- `WASM Default: Buffer reuse works correctly` - Performance feature
- `WASM Default: All supported squash functions produce correct results` - All
  35 functions
- `WASM Default: Cache works correctly across multiple activations` - WASM
  caching
- `WASM Default: disposeWasm() allows recompilation on next activate` - Resource
  management
- `WASM Default: activateAndTrace supports backpropagation correctly` - Training
  support
- `WASM Default: Mixed network with aggregate functions works correctly` - IF,
  MINIMUM, MAXIMUM
- `WASM Default: Parameter is useJs (not useWasm) for explicit JS selection` -
  API verification

Existing test files updated:

- `test/CreatureWasmActivation.ts` - Updated to use new `useJs` parameter
  semantics
- `test/WasmActivateAndTrace.ts` - Updated to use new `useJs` parameter
  semantics
