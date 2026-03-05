## Summary

Add test coverage for the worker and multithreading modules, covering 7 new test
files across `test/workers/` and `test/multithreading/`. Closes #1698.

### New test files

**test/workers/**

- `WasmActivationPayload.ts` — Tests sync/async payload loading, caching,
  de-duplication, and availability checking
- `WasmWorkerInit.ts` — Tests WASM initialisation with missing payloads,
  idempotent init, and error types
- `workerEntryPoint.ts` — Tests message processing, error handling, and init via
  MockWorker round-trips
- `WorkerHandlerBaseInitTimeout.ts` — Tests `getInitTimeoutMs()` with various
  env configurations

**test/multithreading/**

- `MockWorker.ts` — Tests echo processing, structured clone validation, error
  responses, termination, and sequential messages
- `WorkerHandler.ts` — Tests construction, echo round-trip, busy/idle state, and
  termination in direct mode
- `WorkerProcessor.ts` — Tests `buildDiscoverResponsePayload` mapping and
  `clearDiscoverResultForGC` array nullification

## Evidence

Backend/CLI change — no visual output to screenshot. All 4512 tests pass
(including 33 new tests) via `./quality.sh`.

## Test Plan

- 33 new tests added across 7 test files
- Tests exercise real code paths: message handling, initialisation, error cases,
  caching, structured clone safety
- MockWorker tested to ensure it correctly simulates worker behaviour
- All tests use `Deno.test()` with `@std/assert`
- Tests run in parallel without timing dependencies
- Australian English used in all descriptions and comments
- `./quality.sh` passes cleanly
