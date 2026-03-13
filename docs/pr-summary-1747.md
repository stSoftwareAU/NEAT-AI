## Summary

Extracted three magic numbers in `src/utils/BloomFilter.ts` to named constants
with JSDoc comments explaining their purpose. Closes #1747.

- `8192` → `DEFAULT_BLOOM_FILTER_SIZE` — default bit array size
- `7` → `DEFAULT_HASH_COUNT` — default number of hash functions
- `5381` → `DJB2_INITIAL_HASH` — conventional DJB2 seed value

No functional changes — all existing tests continue to pass unchanged.

## Evidence

All 4706 tests pass. `./quality.sh` passes cleanly.

## Test Plan

- Added `BloomFilter - named constants have expected values` — verifies each
  constant holds the correct numeric value
- Added `BloomFilter - default constructor uses named constants` — verifies
  default filter size matches `DEFAULT_BLOOM_FILTER_SIZE`
- Added
  `BloomFilter - default constructor produces same results as explicit constants`
  — verifies default and explicit-constant construction produce identical
  behaviour
