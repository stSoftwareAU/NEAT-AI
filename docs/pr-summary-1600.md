## Summary

Unify the duplicated worker infrastructure between `src/multithreading/workers/` and `src/intelligentDesign/workers/` by extracting shared lifecycle management into a new `src/workers/` module. Closes #1600.

### What changed

Both worker systems (multithreading and intelligentDesign) contained structurally duplicated code for:
- Task ID management, busy state tracking, callback maps, and idle listeners
- WASM activation payload loading (sync + async variants)
- WASM bootstrap inside worker processors
- Worker message loop with init timeout in deno/worker.ts entry points
- WorkerInterface contract type

This PR extracts the shared code into `src/workers/`:

| New file | Responsibility |
|---|---|
| `WorkerHandlerBase.ts` | Base class with task lifecycle, makePromise/makePromiseDeferred, idle listeners |
| `WasmActivationPayload.ts` | Shared WASM loading (sync, async, prefetch, availability check) |
| `WasmWorkerInit.ts` | Shared WASM bootstrap for worker processors |
| `WorkerInterface.ts` | Shared worker contract types (BaseRequestData, BaseResponseData, WorkerInterface) |
| `workerEntryPoint.ts` | Shared message loop with init timeout for deno/worker.ts |
| `mod.ts` | Barrel re-exports |

Both `multithreading/WorkerHandler` and `intelligentDesign/WorkerHandler` now extend `WorkerHandlerBase`. All existing public APIs and re-exports are preserved for backwards compatibility.

### Line count impact

- **Removed**: 911 lines of duplicated code
- **Added**: 698 lines of shared code + 278 lines of new tests
- **Net source reduction**: ~213 lines

## Evidence

This is a backend/infrastructure refactoring with no visual output. Evidence is provided via test results:
- All 4380 existing tests pass unchanged
- 8 new tests validate `WorkerHandlerBase` lifecycle (busy state, idle listeners, deferred promises, init failure, concurrent tasks, termination cleanup)

## Test Plan

- Added `test/workers/WorkerHandlerBase.ts` with 8 tests:
  - `starts not busy` - verifies initial state
  - `makePromise increments busyCount and resolves` - core task lifecycle
  - `idle listener fires when work completes` - idle notification
  - `makePromiseDeferred waits for ready` - deferred posting
  - `makePromiseDeferred rejects when init fails` - error propagation
  - `terminate cleans up resources` - resource cleanup
  - `multiple concurrent tasks track busyCount` - concurrent task handling
  - `waitUntilReady resolves after init` - init synchronisation
- All existing worker tests pass (multithreading, intelligentDesign, Worker.ts)
- Full quality gate (`./quality.sh`) passes: fmt, lint, type-check, 4380 tests
