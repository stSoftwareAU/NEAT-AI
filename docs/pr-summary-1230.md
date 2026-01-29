# PR Summary: Itemise Remaining WASM Migration Tasks (#1230)

## Summary

Updated documentation, comments, and file headers across the repository to
accurately reflect the current WASM-default, no-JS-fallback behaviour
established by Issue #1229. This PR addresses all items identified in Issue
#1230.

### Changes Made

1. **docs/pr-summary-1122.md** (Phase 5 – WASM as default)
   - Removed references to "JavaScript fallback remains available"
   - Changed "Graceful degradation" to "No JS fallback on default path"
   - Corrected environment variable from `NEAT_AI_USE_JS=1` to
     `NEAT_AI_USE_JS_ACTIVATION=1`
   - Updated test plan descriptions to reflect throw behaviour instead of
     fallback

2. **docs/pr-summary-1206.md** (optional WASM in workers)
   - Replaced "gracefully falls back to JavaScript-based activation" with
     accurate description of #1229 behaviour
   - Added note that `null` payload leads to failure unless
     `NEAT_AI_USE_JS_ACTIVATION=1` is set

3. **test/CreatureWasmActivation.ts** (top-of-file comment)
   - Changed "WASM is used when supported, with JS fallback otherwise" to
     "WASM is required on the default path; unsupported squash functions throw"
   - Added note about #1229 removing default-path JS fallback

4. **src/multithreading/workers/WorkerHandler.ts** (comment for
   `loadWasmActivationInitPayload`)
   - Changed "allowing graceful fallback to JavaScript-based activation" to
     accurate description noting that null is only valid in
     verification/optional-WASM mode

5. **docs/pr-summary-1229.md** (NEW – migration doc)
   - Created missing migration document for #1229 describing:
     - WASM is the default with no JS fallback
     - `initWasmActivation()` or `NEAT_AI_WASM_AUTO_INIT=1` required
     - `useJs: true` or `NEAT_AI_USE_JS_ACTIVATION=1` for verification only
     - Unsupported squash functions throw on the default path

6. **README.md**
   - Added note under "Efficient Model Utilisation" that activation uses WASM
     by default, requires init, and that `useJs`/`NEAT_AI_USE_JS_ACTIVATION`
     are for verification

7. **Other PR summaries** (one-line notes added)
   - docs/pr-summary-1143.md – Note about #1229 removing default-path fallback
   - docs/pr-summary-1137.md – Updated "JS fallback preserved" to reflect
     verification-only JS path
   - docs/pr-summary-1118.md – Note about unsupported functions throwing on
     default path
   - docs/pr-summary-1116.md – Note about #1229 removing default-path fallback

8. **test/Learn.ts** – Added `initWasmForTests()` call to fix test that was
   missing WASM initialisation

## Evidence

Unable to generate screenshot: This is a CLI-only library with no visual
interface.

All 1819 tests pass with `./quality.sh`:

```
ok | 1819 passed (2 steps) | 0 failed | 1 ignored (57s)
```

## Test Plan

- **test/Learn.ts** – Added `initWasmForTests()` to initialise WASM before
  training, fixing the test that was failing due to missing WASM initialisation
- All 1819 existing tests pass without modification (beyond the Learn.ts fix)
- `./quality.sh` passes cleanly
