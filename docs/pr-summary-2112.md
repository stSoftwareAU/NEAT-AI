## Summary

Fix WASM 404 errors when consuming NEAT-AI from JSR. Closes #2112.

Commit `f13b97e6` (#2101) added `wasm_activation/pkg` to the global `exclude` in
`deno.json` to prevent `deno fmt` from reformatting generated WASM files.
However, the global exclude also prevented `deno publish` from including these
files in the JSR package. Consumers on version 2.7.2 received 404 errors when
the library tried to load `wasm_activation.js` and `wasm_activation_bg.wasm`
from JSR, causing worker initialisation failures and uncaught crashes.

### Root cause fix

Moved `wasm_activation/pkg` from the global `exclude` (which affects all
operations including publish) to operation-specific `fmt.exclude` and
`lint.exclude` sections. This ensures:

- `deno fmt` and `deno lint` still skip generated WASM files (no CI/local
  formatting discrepancy)
- `deno publish` includes the WASM files in the JSR package (no more 404s)

### Resilience fix

Updated `WorkerHandler` constructor to gracefully handle WASM payload load
failures for direct/mock workers when WASM is already available in the main
thread. Previously, if `loadWasmActivationInitPayloadAsync()` threw (e.g. 404),
the fallback to direct execution also crashed because the constructor
unconditionally awaited the payload. Now, direct workers proceed without the
payload when the main thread's WASM is already initialised.

## Evidence

Verified with `deno publish --dry-run` that WASM files are now included:

- `wasm_activation/pkg/wasm_activation.js`
- `wasm_activation/pkg/wasm_activation_bg.wasm`
- `wasm_activation/pkg/wasm_activation.d.ts`
- `wasm_activation/pkg/wasm_activation_bg.wasm.d.ts`

Existing `FormatConsistency` tests confirm WASM files are still excluded from
formatting.

## Test Plan

- Added `test/wasm/WasmPublishIncluded.ts`:
  - Verifies `deno publish --dry-run` includes WASM .js and .wasm files
  - Verifies WASM files exist on disk for local consumers
- Added `test/wasm/WasmPayloadAvailability.ts`:
  - Verifies `isWasmActivationPayloadAvailable()` returns true
  - Verifies sync payload loading succeeds
  - Verifies async payload loading succeeds
- All 5173 existing tests pass with 0 failures
