## Summary

Improved CRISPR append-mode error handling to throw `MISSING_UUID` (instead of
`INVALID_CONNECTION`) when `fromId` or `toId` is specified but doesn't resolve
in the target creature's UUID map. The error message now includes the full
synapse JSON for debugging, matching insert-mode behaviour. The existing
`INVALID_CONNECTION` check remains for genuinely invalid indices (negative,
non-finite). Closes #2154.

## Evidence

- Append mode now throws `MISSING_UUID` with synapse JSON when `fromId` is
  specified but not found
- Append mode now throws `MISSING_UUID` with synapse JSON when `toId` is
  specified but not found
- `INVALID_CONNECTION` is still thrown for negative or non-finite indices
- All 5247 tests pass (0 failed, 3 ignored)

## Test Plan

- Updated `test/CRISPR/CrisprError.ts`:
  - `append throws MISSING_UUID when fromId not found` - verifies error code and
    synapse JSON in message
  - `append throws MISSING_UUID when toId not found` - verifies error code and
    synapse JSON in message
  - `append throws INVALID_CONNECTION for negative from index` - verifies
    genuine invalid index path
  - `append throws INVALID_CONNECTION for non-finite to index` - verifies
    genuine invalid index path
  - Updated integration tests (`cleaveDNA` path) to reflect `MISSING_UUID` error
    code
