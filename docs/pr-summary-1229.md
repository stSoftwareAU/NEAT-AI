# PR Summary: Make WASM the Default with No JS Fallback (#1229)

## Summary

Issue #1229 completes the WASM migration by making WASM the **sole default
activation path**. The JavaScript activation fallback has been removed from the
default code path. This is the final step before the JS activation path can be
removed entirely.

### Key Changes

1. **WASM is the default with no JS fallback** - The default activation path
   requires WASM. If WASM is not initialised or the squash function is
   unsupported, the default path **throws** rather than silently falling back to
   JavaScript.

2. **Initialisation required** - Call `initWasmActivation()` before using
   activation, or set `NEAT_AI_WASM_AUTO_INIT=1` for automatic initialisation.

3. **JS activation for verification only** - Use `activate(..., useJs: true)` or
   set `NEAT_AI_USE_JS_ACTIVATION=1` to enable JavaScript activation for
   verification and comparison purposes only.

4. **Unsupported squash functions** - Squash functions not yet implemented in
   WASM (e.g. MEAN, HYPOT, HYPOTv2, INVERSE, CLIPPED) throw on the default path.
   Use `useJs: true` for creatures that use these squash functions in tests.

5. **Tests updated** - Tests that require WASM use `initWasmForTests()` where
   needed.

### Environment Variables

| Variable                      | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `NEAT_AI_WASM_AUTO_INIT=1`    | Automatically initialise WASM on first activation  |
| `NEAT_AI_USE_JS_ACTIVATION=1` | Enable JavaScript activation for verification only |

### Migration Guide

```typescript
// Before (#1122): WASM default with silent JS fallback
const output = creature.activate(input); // Falls back to JS if WASM unavailable

// After (#1229): WASM required, throws if unavailable
import { initWasmActivation } from "./src/wasm/mod.ts";
await initWasmActivation(); // Required before activation
const output = creature.activate(input); // Throws if WASM not initialised

// For verification/testing with JS:
const jsOutput = creature.activate(input, false, false, true); // useJs=true
```

## Evidence

Unable to generate screenshot: This is a CLI-only library with no visual
interface.

Runtime behaviour for #1229 is already in place (WASM default, no fallback,
tests updated with `initWasmForTests()` where needed). No further code changes
are required.

## Test Plan

- Existing tests updated to use `initWasmForTests()` where WASM initialisation
  is required
- Tests using unsupported squash functions (MEAN, HYPOT, etc.) use `useJs: true`
  to verify JS path still works for comparison
- `./quality.sh` passes cleanly
