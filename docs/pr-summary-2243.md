## Summary

Add configurable `heavyTaskWorkerCount` option to `NeatConfig` and `NeatOptions`
that controls how workers are partitioned between fast (fitness evaluation) and
heavy (discovery, training, recording) task pools. Closes #2243.

Previously the partition was hardcoded to reserve 1 worker for heavy tasks. This
change makes it configurable with a default of 2 (one for discovery, one for
training), so both can run in parallel without blocking fast tasks.

- Fast worker count = `threads - heavyTaskWorkerCount`, ensuring all CPUs are
  fully utilised
- Default `threads` = `navigator.hardwareConcurrency` (number of CPUs)
- When `threads <= 2`, partitioning is automatically disabled (all workers
  shared)
- Validation: `heavyTaskWorkerCount` must be >= 1 and < threads (when threads
  > 2.

## Changes

- `src/config/NeatArguments.ts` — added `heavyTaskWorkerCount` field
- `src/config/NeatOptions.ts` — exposed option in `NumericOptionKeys`
- `src/config/NeatConfig.ts` — parse with default 2, integer, min 1
- `src/config/NeatConfigValidation.ts` — cross-field validation (< threads when
  threads > 2)
- `src/creature/CreatureTraining.ts` — use config value instead of hardcoded `1`
- `docs/CONFIGURATION_GUIDE.md` — documented new option and worker pool
  partitioning section

## Evidence

This is a backend configuration change with no UI. Verified by:

- 13 dedicated unit tests covering all acceptance criteria
- Full quality gate: 5711 tests passed, 0 failed

## Test Plan

- Added `test/config/HeavyTaskWorkerCount.ts` with 13 tests:
  - Default value is 2
  - User can override the value
  - Accepts string from CLI (coercion)
  - Rejects 0, negative values, and non-integer values
  - Rejects value >= threads when threads > 2
  - Allows value up to threads - 1 when threads > 2
  - Skips upper-bound validation when threads <= 2
  - Works with threads = 1 (partitioning disabled at runtime)
  - Default behaviour preserved with no options
  - Config is frozen (immutable) after creation
