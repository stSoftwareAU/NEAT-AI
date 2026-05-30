## Summary

Migrated the remaining wall-clock `new Date()` / `Date.now()` call sites in
`src/transfer/Checkpoint.ts`, `src/utils/Diagnostics.ts`, and
`src/wasm/WasmActivation.ts` to native `Temporal`, matching the date/time policy
in #2813 and the sibling migration in #2814. Closes #2815.

### Files migrated

| File                         | Line            | Before                                           | After                                                     |
| ---------------------------- | --------------- | ------------------------------------------------ | --------------------------------------------------------- |
| `src/transfer/Checkpoint.ts` | 71              | `createdAt: new Date().toISOString()`            | `createdAt: Temporal.Now.instant().toString()`            |
| `src/utils/Diagnostics.ts`   | 58              | `new Date().toISOString().replace(/[:.]/g, "-")` | `Temporal.Now.instant().toString().replace(/[:.]/g, "-")` |
| `src/wasm/WasmActivation.ts` | 190–193, 72, 79 | `timestamp: Date.now()` (number)                 | `timestamp: Temporal.Now.instant().toString()` (string)   |

`lastCreateFailure.timestamp` was a `number` (epoch ms). An audit of every
caller (`getLastWasmCreateFailure` consumers in `ProducerCompileGuard.ts`,
`WasmCompilationCache.ts`, and the `WasmCompileFailureRecovery` test) showed no
caller reads the field as a numeric delta — they only check the record's
presence or render `failure.message`. The field is therefore now an ISO-8601
string, consistent with how every other persisted/reported timestamp in the
codebase represents wall-clock instants. The type annotation was updated at both
the declaration and the public getter so TypeScript catches any future numeric
consumer at compile time.

`CheckpointMetadata.createdAt` was already typed as `string` and is part of the
persisted checkpoint wire format — switching its producer to
`Temporal.Now.instant().toString()` preserves the on-disk contract (ISO-8601
string) while bringing it under the Temporal policy. The string gains nanosecond
precision, which remains ISO-8601-conformant and round-trips through both
`Temporal.Instant.from()` and `new Date()`.

Per-phase elapsed-time measurements (`MemoryMonitor`, `ThroughputMetrics`,
`NeatEvolution` profiling) were explicitly out of scope per the policy in #2813.

### Deno regression avoided

This repo is a Deno repo (`deno.json`, `deno.lock` present). Per the AGENTS.md
date/time policy, no `@js-temporal/polyfill` and no `@std/datetime` dependency
was added — the migration uses Deno 2.7+'s native `Temporal`.

## Evidence

Backend-only change; no UI to screenshot. Verified via:

- New regression test in `test/transfer/Checkpoint.ts`:
  `Issue #2815: checkpoint createdAt is a Temporal.Instant-parseable
  ISO-8601 string`
  — round-trips `metadata.createdAt` through `Temporal.Instant.from()` (which
  throws on malformed input) and asserts the resulting instant falls inside the
  recording window.
- Existing tests covering the migrated paths still pass:
  `test/transfer/Checkpoint.ts` (full file), `test/utils/Diagnostics.ts` (writes
  / filename pattern), `test/wasm/WasmCompileFailureRecovery.ts` (failure-cache
  behaviour for `WasmCreatureActivation.create`).
- Full `./quality.sh` run: **6991 passed | 0 failed | 4 ignored (2m47s)**.

## Test Plan

- New regression test
  `test/transfer/Checkpoint.ts::Issue #2815: checkpoint createdAt is a
  Temporal.Instant-parseable ISO-8601 string`.
- Existing tests must continue to pass:
  - `test/transfer/Checkpoint.ts` — every export/import scenario.
  - `test/utils/Diagnostics.ts` — verifies the `.diagnostics/` filename pattern
    using the new Temporal timestamp.
  - `test/wasm/WasmCompileFailureRecovery.ts` — covers
    `getLastWasmCreateFailure()` with the new string `timestamp` type.
- `./quality.sh` (lint, format, type-check, full test suite) passes.
