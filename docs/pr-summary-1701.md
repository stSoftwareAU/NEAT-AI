## Summary

Add configurable size limits and TTL-based eviction to the on-disk discovery
success and failure caches. Previously these caches grew unboundedly; now
entries are automatically pruned by age and count after each discovery
evaluation. Closes #1701.

### Changes

- **New `DiscoveryCacheConfig`** (`src/config/DiscoveryCacheConfig.ts`):
  Configurable `successMaxEntries` (default 10,000), `failureMaxEntries`
  (default 50,000), `ttlDays` (default 30), and `obsoleteTTLDays` (default 7).
- **New `DiscoveryCacheEviction` module**
  (`src/discovery/DiscoveryCacheEviction.ts`): Implements TTL-based and
  size-based (oldest-first) eviction, obsolete directory cleanup, and cache
  statistics collection with logging.
- **Integrated into config pipeline**: Added to `NeatArguments`, `NeatOptions`,
  `NeatOptionsInput`, `NeatConfigParsers`, and `NeatConfig` following the
  established config pattern.
- **Pruning after evaluation**: `cacheEvaluationResults()` now prunes both
  caches and the obsolete directory after writing new entries, with statistics
  logged.

## Evidence

This is a backend/config change with no UI. All behaviour is verified through
unit tests and the full quality gate (4523 tests pass).

## Test Plan

- `test/discovery/DiscoveryCacheEviction.ts` (8 tests):
  - TTL-based eviction removes old entries
  - Size-based eviction removes oldest when exceeding max
  - Combined TTL + size eviction
  - Obsolete directory pruning
  - Empty/missing directory handling
  - Cache statistics collection
  - Log output does not throw
- `test/config/DiscoveryCacheConfig.ts` (3 tests):
  - Default config values applied
  - Partial overrides merged correctly
  - String values from CLI coerced to numbers
- All 4523 existing tests continue to pass
