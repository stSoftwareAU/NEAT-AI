## Summary

Add `maxConcurrentDiscoveries` config option (default: 1) that replaces the
binary `discoveryInProgress.size > 0` guard in `NeatScheduling.ts` with a
configurable concurrency limit (`discoveryInProgress.size >= maxConcurrentDiscoveries`).
This allows multiple independent discoveries to run in parallel on separate heavy
workers, eliminating the serialisation bottleneck described in #2237. Closes #2238.

## Changes

- **`src/config/NeatArguments.ts`**: Added `maxConcurrentDiscoveries` field to the config interface
- **`src/config/NeatOptions.ts`**: Added to `NumericOptionKeys` for CLI string coercion
- **`src/config/NeatConfig.ts`**: Added parsing with `parseNumber()` (integer, min: 1, default: 1)
- **`src/NEAT/NeatScheduling.ts`**: Replaced `size > 0` guard with `size >= config.maxConcurrentDiscoveries`
- **`docs/CONFIGURATION_GUIDE.md`**: Documented the new option in both the summary table and detail section

## Evidence

This is a backend config/scheduling change with no UI. Verified via:
- All 5723 existing tests pass (0 failures)
- 7 new unit tests covering config parsing, guard behaviour, and backward compatibility

## Test Plan

- `test/NEAT/MaxConcurrentDiscoveries.ts` (7 tests):
  - Config defaults to 1
  - Config accepts higher values (e.g., 3)
  - Config accepts string input from CLI
  - Guard allows scheduling when below limit
  - Guard blocks scheduling at limit
  - Default of 1 preserves backward-compatible behaviour
  - `finishUp()` handles multiple concurrent discoveries correctly
