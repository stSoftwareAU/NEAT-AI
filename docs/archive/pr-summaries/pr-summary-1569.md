## Summary

Add opt-in `workerThreadCap` configuration to cap worker thread count based on
available memory. Closes #1569.

On memory-constrained machines, spawning one worker per CPU core can exhaust RAM
(e.g. 16-core, 16 GB machine with workers each consuming ~2 GB). When
`maxMemoryMB` is set, the effective thread count is capped to
`min(threads, floor(maxMemoryMB / estimatedMemoryPerWorkerMB))`, ensuring
workers fit within the memory budget.

Key design decisions:

- **Opt-in behaviour**: `maxMemoryMB` defaults to 0 (disabled), so there is no
  behaviour change for existing users
- **Minimum 1 thread**: Even with a tiny memory budget, at least 1 worker thread
  is always allowed
- **Console warning**: When threads are capped, a warning is logged with the
  original count, capped count, and memory budget details
- **Cross-field validation**: Warns if
  `threads * estimatedMemoryPerWorkerMB > maxMemoryMB`

## Evidence

This is a backend/CLI configuration change with no visual output. Evidence is
provided by the 16 unit tests that cover all capping scenarios.

## Test Plan

- Added `test/config/WorkerThreadCapConfig.ts` with 16 tests covering:
  - Default values are sensible
  - No capping when `maxMemoryMB` is not set or 0
  - Threads capped based on memory budget (various ratios)
  - Custom `estimatedMemoryPerWorkerMB` values
  - Minimum 1 thread even with tiny budget
  - Exact and non-exact division (floor behaviour)
  - Partial overrides merge with defaults
  - String values coerced from CLI
  - Validation: `estimatedMemoryPerWorkerMB >= 1`, `maxMemoryMB >= 0`
  - Backwards compatibility when not set
  - Config immutability (frozen)
- All 4291 existing tests continue to pass
