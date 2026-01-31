# PR Summary: Make WASM the Default with No JS Fallback (#1229)

## Summary

Issue #1229 completes the WASM migration by making WASM the **sole default
activation path**. The JavaScript activation fallback has been removed from the
default code path. This is the final step before the JS activation path can be
removed entirely.

> **Note (historical):** As of Issue #1263, **WASM activation is mandatory** and
> the JS activation path/toggles described below have been removed.

### Key Changes

1. **WASM is the default with no JS fallback** - The default activation path
   requires WASM. If WASM is not initialised or the squash function is
   unsupported, the default path **throws** rather than silently falling back to
   JavaScript.

2. **Initialisation required** - Call `initWasmActivation()` before using
   activation, or rely on the library's automatic initialisation.

3. **JS activation for verification only** - This existed historically for
   verification and comparison purposes only (removed by Issue #1263).

4. **Unsupported squash functions** - Historically, some squash functions were
   not implemented in WASM and would throw on the default path.

5. **Tests updated** - Tests that require WASM use `initWasmForTests()` where
   needed.

### Migration Guide

```typescript
// Before (#1122): WASM default with silent JS fallback
const output = creature.activate(input); // Falls back to JS if WASM unavailable

// After (#1229): WASM required, throws if unavailable
import { initWasmActivation } from "./src/wasm/mod.ts";
await initWasmActivation(); // Required before activation
const output = creature.activate(input); // Throws if WASM not initialised

// Historical: verification/testing JS activation was previously available
// (removed by Issue #1263).
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
- `./quality.sh` passes cleanly
