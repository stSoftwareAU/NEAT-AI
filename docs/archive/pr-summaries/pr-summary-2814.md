## Summary

Migrated wall-clock timestamp call sites in the Discovery cache, diagnostics,
cleanup state, validation reports, and focus-selection analysis from
`new Date().toISOString()` to `Temporal.Now.instant().toString()`, matching the
date/time policy adopted in #2813. Closes #2814.

Per-phase elapsed-time measurements (e.g. `Date.now() - start` profiling) were
deliberately left untouched — those are monotonic-style measurements where
`Date.now()` remains the correct tool.

### Files migrated

| File                                                                         | Lines              | Change                                                                                                                                            |
| ---------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/discovery/SuccessCache.ts`                                              | 140                | `metadata.timestamp ?? Temporal.Now.instant().toString()`                                                                                         |
| `src/discovery/FailureCache.ts`                                              | 151                | `timestamp: Temporal.Now.instant().toString()`                                                                                                    |
| `src/discovery/DiscoveryEvaluationSummary.ts`                                | 60                 | archive-filename timestamp now derived from `Temporal.Now.instant()`                                                                              |
| `src/discovery/DiscoveryDiagnostics.ts`                                      | 136                | `timestamp: Temporal.Now.instant().toString()`                                                                                                    |
| `src/discovery/DiscoveryCleanup.ts`                                          | 35                 | lock-file `startedAt` now uses `Temporal.Now.instant().toString()`                                                                                |
| `src/architecture/ErrorGuidedStructuralEvolution/DiscoveryValidation.ts`     | 107, 148, 190, 230 | held `Date` instance replaced with a single `Temporal.Now.instant().toString()` ISO string; printed `Timestamp:` field now reads from that string |
| `src/architecture/ErrorGuidedStructuralEvolution/FocusSelectionWeighting.ts` | 136                | `timestamp: Temporal.Now.instant().toString()`                                                                                                    |

The on-disk wire format remains a plain ISO-8601 string. `Temporal.Instant`
serialises with nanosecond precision (e.g. `2026-05-30T03:21:09.123456789Z`)
which is still ISO-8601-conformant and round-trips through both
`Temporal.Instant.from()` and `new Date()`.

The Australian-format `YYYYMMDD-HHMMSS` issue-directory prefix in
`DiscoveryValidation.ts` still slices to 15 characters; this works identically
with the nanosecond-precision Temporal string because the extra digits land
after the slice cutoff.

### Deno regression avoided

This repo is a Deno repo (`deno.json`, `deno.lock` present). Per the AGENTS.md
date/time policy, no `@js-temporal/polyfill` and no `@std/datetime` dependency
was added — the migration uses Deno 2.7+'s native `Temporal`.

## Evidence

Backend-only change; no UI to screenshot. Verified via:

- New regression test `test/discovery/CacheTemporalTimestamps.ts` asserts that
  the persisted `timestamp` field written by both `SuccessCache` and
  `FailureCache` is a string parseable by `Temporal.Instant.from()` and that the
  parsed instant falls inside the recording window.
- Full `./quality.sh` run: 6990 passed | 0 failed | 4 ignored (2m31s).

## Test Plan

- New: `test/discovery/CacheTemporalTimestamps.ts`
  - `SuccessCache persists timestamp as Temporal.Instant-parseable ISO string`
  - `FailureCache persists timestamp as Temporal.Instant-parseable ISO string`
- Existing tests still pass — most notably `test/discovery/SuccessCache.ts`,
  `test/discovery/FailureCacheOperations.ts`,
  `test/discovery/DiscoveryCleanup.ts`,
  `test/discovery/DiscoveryDiagnostics.ts`, and
  `test/ErrorGuidedStructuralEvolution/ValidateAndFixIfNeeded.ts` (which
  exercises the issue-directory timestamp filename code path).
