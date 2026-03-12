## Summary

Extract shared worker error serialisation utility to eliminate duplicated
`error instanceof Error ? ...` pattern across 6 locations in worker-related
files. Closes #1746.

Two functions added to `src/utils/ErrorSerialisation.ts`:
- `toErrorMessage(error: unknown): string` — extracts message string
- `toError(error: unknown): Error` — ensures Error instance

All 6 call sites updated:
1. `src/multithreading/workers/deno/worker.ts` (3 occurrences → `toErrorMessage`)
2. `src/intelligentDesign/workers/deno/worker.ts` (1 occurrence → `toError`)
3. `src/intelligentDesign/workers/MockWorker.ts` (1 occurrence → `toError`)
4. `src/multithreading/workers/WorkerProcessor.ts` (1 occurrence → `toErrorMessage`)

## Evidence

All 4703 tests pass. `./quality.sh` passes cleanly.

## Test Plan

- Added `test/utils/ErrorSerialisation.ts` with 13 tests covering:
  - `toErrorMessage` with Error instances, Error subclasses, strings, numbers, null, undefined, objects
  - `toError` with Error instances, Error subclasses, strings, numbers, null, undefined
  - Verifies Error subclass preservation (e.g. TypeError, RangeError)
