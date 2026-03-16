## Summary

Investigate why the DataCloneError in WorkerHandler.discover() was not caught by
tests, and add covering tests. Closes #1428.

### Root Cause Analysis

The DataCloneError occurred when `NeatConfig` (containing `logger` and `rng`
function properties) was posted to a worker via `postMessage()`. The structured
clone algorithm cannot serialise functions, causing a runtime crash.

**Why tests missed it:** The `MockWorker` class bypassed the structured clone
constraint entirely. Its `postMessage()` method accepted the data object
directly in-process without going through the structured clone algorithm that
real `Worker.postMessage()` uses. This meant any test using `MockWorker` (i.e.
all worker tests running with `direct: true`) would silently accept
non-cloneable payloads that would fail in production.

### Changes

1. **`MockWorker.postMessage()` now validates cloneability** - Added a
   `structuredClone(data)` call at the top of `MockWorker.postMessage()` so it
   mirrors the behaviour of a real Worker. Any future non-cloneable payload will
   fail immediately in tests rather than silently passing.

2. **New test file: `test/multithreading/WorkerPayloadCloneability.ts`** - Five
   focused tests that verify:
   - Raw `NeatConfig` with `logger`/`rng` functions **cannot** be
     structured-cloned
   - Sanitised config (with `logger`/`rng` stripped) **can** be
     structured-cloned
   - Full discovery `RequestData` with sanitised config survives
     `structuredClone`
   - Full discovery `RequestData` with unsanitised config **fails**
     `structuredClone`
   - All other `RequestData` variants (echo, evaluate, train, breed, initialise)
     are structured-clone safe

### Test Audit

Audited the existing worker test suite (`test/Worker.ts`,
`test/multithreading/WorkerPool.ts`,
`test/multithreading/WorkStealingQueue.ts`). No mock/fake tests that grep source
code for patterns were found. All existing tests exercise real code with test
data and assert on outcomes. The one gap was that `MockWorker` didn't enforce
the structured clone constraint - now fixed.

## Evidence

This is a backend/test-only change with no UI impact. Evidence is the test
output:

- All 2887 tests pass (including the 5 new tests)
- `./quality.sh` passes cleanly (fmt, lint, type-check, all tests)

## Test Plan

- Added `test/multithreading/WorkerPayloadCloneability.ts` with 5 tests:
  - `NeatConfig with logger and rng cannot be structured-cloned`
  - `sanitised NeatConfig without logger/rng can be structured-cloned`
  - `discovery RequestData with sanitised config can be structured-cloned`
  - `discovery RequestData with unsanitised config fails structuredClone`
  - `all non-discover RequestData variants are structured-clone safe`
- Enhanced `MockWorker.postMessage()` to validate structured-clone safety, which
  provides ongoing regression protection for all worker tests
