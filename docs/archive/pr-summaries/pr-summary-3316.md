## Summary

Removed the `export` keyword from `readV8HeapLimitMb` in
`src/workers/WorkerHandlerBase.ts`, making it module-private. A repo-wide
word-boundary search confirmed the symbol has no importer anywhere: it is
referenced only within its own module as the default `heapLimitMb` argument of
`verifyWorkerHeapBudget`, and it is not re-exported from any barrel
(`src/workers/mod.ts`) nor injected by any test. Dropping the `export` removes
dead public surface while preserving behaviour. Closes #3316.

## Evidence

Backend-only change with no web interface — verified via the test suite. The
function is now declared `function readV8HeapLimitMb()` and remains wired as the
default parameter at the call site, so `verifyWorkerHeapBudget()` still resolves
the isolate heap limit when no reader is supplied.

```mermaid
flowchart LR
    A[verifyWorkerHeapBudget] -->|heapLimitMb default| B[readV8HeapLimitMb]
    B -->|module-private| C[v8.getHeapStatistics]
```

Test run (affected file):

```
running 11 tests from ./test/workers/WorkerHeapBudget.ts
...
verifyWorkerHeapBudget: uses the module-private readV8HeapLimitMb default when no heap reader is supplied (Issue #3316) ... ok
ok | 11 passed | 0 failed
```

`deno lint` and `deno check` pass cleanly on both changed files.

## Test Plan

- Added `test/workers/WorkerHeapBudget.ts` →
  `"verifyWorkerHeapBudget: uses the module-private readV8HeapLimitMb default
  when no heap reader is supplied (Issue #3316)"`, which calls
  `verifyWorkerHeapBudget` with no `heapLimitMb` argument, forcing the internal
  `readV8HeapLimitMb` default path, and asserts the configured budget is
  resolved and logged. This guards the internal default now that the symbol is
  no longer exported.
- All pre-existing `WorkerHeapBudget.ts` and `WorkerHeapBudgetCore.ts` tests
  continue to pass (24 passed / 0 failed).
