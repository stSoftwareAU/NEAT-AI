## Summary

Migrated all eight wall-clock `timestamp` emissions in
`src/creature/CreatureTraining.ts` from `new Date().toISOString()` to
`Temporal.Now.instant().toString()`, matching the date/time policy in AGENTS.md
and continuing the milestone work started in #2814–#2816. Closes #2817.

Per-phase elapsed-time measurements (`Date.now()` deltas, `performance.now()`
spans) inside `CreatureTraining.ts` were deliberately left untouched — those are
monotonic-style measurements where `Date.now()` is the correct tool, per the
AGENTS.md "do NOT migrate" guidance.

### Sites migrated

| Lines            | Event kind                                                      |
| ---------------- | --------------------------------------------------------------- |
| 521, 535         | `generation_complete`, `plateau_detected`                       |
| 798, 811         | `generation_complete`, `plateau_detected`                       |
| 1263, 1276, 1315 | `generation_complete`, `plateau_detected`, `evolverl_milestone` |
| 1390             | `evolverl_milestone` (synthetic final)                          |

The on-disk / event-bus wire format remains a plain ISO-8601 string.
`Temporal.Instant.toString()` emits nanosecond precision (e.g.
`2026-05-30T03:21:09.123456789Z`) which is still ISO-8601-conformant and
round-trips through both `Temporal.Instant.from()` and `new Date()` — existing
test assertions that parse with `new Date(timestamp)` continue to pass.

`TrainingEvent.timestamp` remains typed as `string`; no interface change was
required.

### Deno regression avoided

This repo is a Deno repo (`deno.json`, `deno.lock` present). Per the AGENTS.md
date/time policy, no `@js-temporal/polyfill` and no `@std/datetime` dependency
was added — the migration uses Deno 2.7+'s native `Temporal`.

## Evidence

Backend-only change; no UI to screenshot. Verified via:

- New regression test in `test/config/TrainingEvent.ts`:
  `TrainingEvent - timestamps are parseable by Temporal.Instant.from (Issue #2817)`
  asserts that every emitted event timestamp parses through
  `Temporal.Instant.from()` and yields an epoch after the 2020-01-01 cutoff.
- Existing `TrainingEvent` and `CreatureTrainEvolve` test suites still pass
  (`new Date(timestamp)` parsers handle the nanosecond ISO string
  transparently).
- `deno fmt`, `deno lint`, and `deno check` clean on the touched files.

## Test Plan

- Modified: `test/config/TrainingEvent.ts`
  - Added:
    `TrainingEvent - timestamps are parseable by Temporal.Instant.from (Issue #2817)`
- Re-ran:
  - `test/config/TrainingEvent.ts` — 9 passed
  - `test/creature/CreatureTrainEvolve.ts` — passes
  - `test/creature/CreatureTrainingTypedErrors.ts` — passes
  - Combined run: 30 passed | 0 failed
