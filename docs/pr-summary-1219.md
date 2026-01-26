## Summary

Fixes #1219: WASM activation must be initialised before discovery recording.

This PR ensures that WASM activation is automatically initialised before
discovery recording begins, allowing calling programs to use discovery features
without explicitly initialising WASM first.

### Problem

When discovery recording was called without WASM being initialised first, an
`AssertionError` was thrown at `DiscoverStructure.ts:934` with the message:
"WASM activation must be initialised before discovery recording".

This was unexpected behaviour for users migrating to WASM, as the issue
description noted: "I hope/expect the calling programs not to need to change
with our migration to WASM."

### Solution

Added automatic WASM initialisation at the start of the `recordDirectory()`
function in `DiscoverDirectory.ts`. The new `ensureWasmActivationForDiscovery()`
helper function:

1. Checks if WASM is already initialised
2. If not, attempts to initialise it from the default path
   (`wasm_activation/pkg`)
3. Throws a clear error message if initialisation fails

This ensures backward compatibility - existing code that doesn't explicitly
initialise WASM will continue to work, as the library now handles it
automatically.

### Changes

- Added `getWasmDefaultPath()` function to determine the WASM module path
- Added `ensureWasmActivationForDiscovery()` function to handle automatic
  WASM initialisation
- Modified `recordDirectory()` to call `ensureWasmActivationForDiscovery()`
  before starting discovery
- Added imports for `initWasmActivation` and `isWasmActivationAvailable`
  from the WASM module

## Evidence

Unable to generate screenshot: This is a CLI-only library with no visual
interface.

The fix addresses the error shown in the issue:
```
AssertionError: WASM activation must be initialised before discovery recording
    at assert (https://jsr.io/@std/assert/1.0.17/assert.ts:21:11)
    at DiscoverStructure.record (...)
```

After this fix, the WASM module is automatically initialised before discovery
recording begins, so calling programs no longer need to explicitly initialise
WASM.

## Test Plan

Added new tests in `test/discovery/WasmInitialisationBeforeDiscovery.ts`:

- `Issue #1219: ensureWasmActivationForDiscovery initialises WASM when not
  available` - Verifies the helper function initialises WASM correctly
- `Issue #1219: getWasmDefaultPath returns the expected default path` -
  Verifies the path calculation is correct
- `Issue #1219: ensureWasmActivationForDiscovery is idempotent` - Verifies
  calling the function multiple times is safe
- `Issue #1219: ensureWasmActivationForDiscovery works when WASM already
  initialised` - Verifies the function works when WASM was manually
  initialised first

All existing tests continue to pass (1801 tests passed).
