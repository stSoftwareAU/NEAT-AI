## Summary

Propagate WASM cache limits to worker threads so that worker-side LRU caches
match the main thread configuration. Closes #1567.

Previously, calling `setMaxCachedWasmCreatureActivations()` or
`setWasmCompilationCacheSize()` in the main thread had no effect on worker-side
caches. Each worker ran with default cache caps regardless of the configuration
in `NeatOptions.wasmCache`.

### Changes

1. **Worker init carries cache config** — `RequestData.initialize` now includes
   an optional `wasmCache` field. `WorkerProcessor` applies the limits during
   worker startup.

2. **Dynamic cache reconfiguration** — new `configureCache` message type lets
   the main thread adjust worker cache caps at runtime (e.g. under memory
   pressure).

3. **Cache statistics reporting** — new `requestCacheStats` message type lets
   the main thread query a worker's current cache occupancy and configured
   limits.

4. **Call sites updated** — `CreatureTraining`, `DiscoveryRunner`, and
   `DiscoveryReplayRunner` now pass `config.wasmCache` when constructing
   workers.

## Evidence

This is a backend/worker-protocol change with no visual output. Verified via
unit tests and the full quality gate (4249 tests pass).

## Test Plan

- Added `test/multithreading/WorkerCacheConfiguration.ts` with 7 tests:
  - `configure-cache` and `request-cache-stats` payloads survive `structuredClone`
  - `WorkerProcessor` correctly handles `configureCache` messages
  - `WorkerProcessor` correctly handles `requestCacheStats` messages
  - Cache limits are verified to update after `configureCache`
  - Partial cache configuration (only one field) succeeds
  - `initialize` payload with `wasmCache` survives `structuredClone`
