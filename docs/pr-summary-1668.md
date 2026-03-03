## Summary

Replace assert-based error handling in CRISPR with dedicated `CrisprError` type. Closes #1668.

- Created `CrisprError` class (extending `Error`) in `src/errors/CrisprError.ts` with a `code` property supporting `INVALID_DNA`, `MISSING_UUID`, `INVALID_CONNECTION`, and `TOPOLOGY_ERROR` codes
- Replaced all `assert()` calls in `insert()` and `append()` with `throw new CrisprError(...)` using appropriate error codes
- Updated `cleaveDNA()` to catch `CrisprError` separately from other errors — operational errors (invalid DNA, missing UUIDs) are logged and return the original creature; non-CRISPR errors during validation are logged with creature JSON for debugging; programming bugs re-throw
- Removed `Deno.writeTextFileSync()` side effect from the catch block — debug information is now logged via the structured logger instead of written to the working directory
- Exported `CrisprError` and `CrisprErrorCode` from `mod.ts` so consumers can catch specific error types

## Evidence

This is a backend/library change with no visual output. All existing tests continue to pass (4380 tests), and new tests verify the error handling behaviour.

## Test Plan

- Added `test/CRISPR/CrisprError.ts` with 15 tests covering:
  - `CrisprError` class construction and properties
  - All error code variants
  - `insert()` throws `CrisprError` with `INVALID_DNA` for output neurons, relative synapses, static indices, missing synapse UUIDs
  - `insert()` throws `CrisprError` with `MISSING_UUID` when fromUUID/toUUID not found in creature
  - `append()` throws `CrisprError` with `INVALID_CONNECTION` for unresolvable from/to
  - `cleaveDNA()` catches operational `CrisprError` and returns original creature
- Added `CrisprError` export test in `test/PublicAPI.ts`
- All 4380 existing tests continue to pass
