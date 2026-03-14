## Summary

Standardised multithreading worker error handling to use `toError()` from
`ErrorSerialisation.ts`, consistent with the intelligent design worker and
MockWorker patterns. Error responses now preserve error name, message, and stack
trace instead of losing error details. Addresses #1761.

## Changes

- Added standardised `error` field (with `name`, `message`, `stack`) to the
  multithreading `ResponseData` interface, matching the intelligent design
  worker pattern
- Updated `src/multithreading/workers/deno/worker.ts` to use `toError()` for
  proper error serialisation
- Updated `src/multithreading/workers/MockWorker.ts` to use `toError()` and
  `toErrorMessage()` for consistent error handling
- Operation-specific error fields are preserved for backwards compatibility

## Test Plan

- Added `MockWorker: evaluate error response preserves error details` test
- Added `MockWorker: train error response preserves error details` test
- Added `MockWorker: discover error response preserves error details` test
- All 4899 existing tests continue to pass
