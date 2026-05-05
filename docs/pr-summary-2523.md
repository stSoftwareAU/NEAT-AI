# Breed-time fail-soft for corrupt parents

## Summary

`findFather` now skips a corrupt parent rather than throwing out of the
whole breed batch. A `TopologyError` raised by the per-candidate
`Creature.fromJSON(...)` call is caught, the candidate is logged via a
structured `[breed-skip-corrupt-parent]` warning, and the loop selects
the next-best candidate. The retry is capped at `min(10, populationSize)`;
exhaustion raises a recoverable `BreedExhaustionError` so the batch can
carry on with the next mother instead of killing the entire generation.

The producer-side throw added in #2514 keeps doing its job — it surfaces
upstream corruption — and the new consumer-side resilience means a
single bad apple no longer poisons the breed batch (or the whole
evolutionary run). Operators can opt back into legacy fail-fast for
diagnostic runs via `NeatOptions.tolerateCorruptParents: false`.

Closes #2523.

## Evidence

This is a backend/library change with no UI surface, so screenshots do
not apply. The behaviour is verified by the new TDD unit tests in
`test/breed/ParentSelectionTolerantLoad.ts`, which stub
`Creature.fromJSON` to deterministically reproduce the production
`TopologyError` from `GRQ-10-rocket.log` and assert on the new
fail-soft semantics. All 6,423 existing tests continue to pass.

### Flow

```mermaid
flowchart TD
    A[breedBatch starts] --> B[selectParentPairs]
    B --> C[findFather candidate i]
    C --> D{Creature.fromJSON throws<br/>TopologyError?}
    D -->|no| E[continue with parent]
    D -->|yes & tolerate=true| F[log [breed-skip-corrupt-parent]<br/>increment corruptParentSkips]
    F --> G{retries < cap?}
    G -->|yes| H[try next-best candidate]
    G -->|no| I[BreedExhaustionError<br/>recoverable]
    H --> C
    D -->|yes & tolerate=false| J[re-throw TopologyError<br/>legacy behaviour]
    E --> K[breedBatch completes]
    I --> L[mother slot skipped<br/>batch continues]
```

## Test Plan

Added `test/breed/ParentSelectionTolerantLoad.ts` covering the four
acceptance criteria from the issue plus the default-on config check:

- `findFather - skips one corrupt candidate and breeds successfully` —
  population of N where 1 candidate is corrupt; breeding succeeds and
  `corruptParentSkips >= 1`.
- `findFather - throws BreedExhaustionError when every candidate is
  corrupt` — recoverable error, distinguishable from `TopologyError`,
  with the correct skip count surfaced.
- `findFather - tolerateCorruptParents: false re-throws TopologyError` —
  legacy fail-fast behaviour preserved.
- `findFather - non-TopologyError exceptions are re-thrown unchanged` —
  e.g. simulated disk read failure propagates without wrapping.
- `config - tolerateCorruptParents defaults to true` — confirms the
  default is fail-soft.

Verification:

- `deno test test/breed/ParentSelectionTolerantLoad.ts` → 5 passed, 0
  failed (16 ms).
- `./quality.sh --skip-discovery --skip-wasm` → 6,423 passed, 0 failed,
  4 ignored (2 m 45 s).

## Surface area

- `src/errors/BreedExhaustionError.ts` (new) — typed recoverable error
  with `reason` (`ALL_CANDIDATES_CORRUPT` | `RETRY_CAP_EXHAUSTED`) and
  `corruptParentSkips` count.
- `src/breed/ParentSelection.ts` — `findFather` accepts an optional
  `BreedSelectionStats` accumulator and runs the tolerant retry loop.
- `src/breed/ParallelBreeding.ts` & `src/breed/Breed.ts` — thread the
  accumulator through `selectParentPair(s)`; expose
  `lastCorruptParentSkips` for diagnostics.
- `src/NEAT/ThroughputMetrics.ts` & `src/config/TrainingEvent.ts` —
  add `corruptParentSkips` to `GenerationThroughputMetrics`.
- `src/NEAT/NeatEvolution.ts` — feeds the count from
  `parallelBreeding.lastCorruptParentSkips` into the throughput
  payload and the `[Throughput]` log line.
- `src/config/NeatArguments.ts` & `src/config/NeatConfig.ts` — adds
  `tolerateCorruptParents` (default `true`).
- `mod.ts` — re-exports `BreedExhaustionError` and
  `BreedExhaustionReason`.
- `deno.json` — minor bump `3.2.3` → `3.3.0` (new public API surface).
- `CHANGELOG.md` — Unreleased entry under **Added**.

## Pre-PR Security Self-Check

- [x] Input validation — new code only inspects already-validated
  `Creature` instances and config booleans; no new external input
  surface.
- [x] Secrets — no `.env`, `.config.json`, or credential files staged.
- [x] Injection surface — no new SQL/shell/HTTP/filesystem calls.
- [x] Output encoding — log line is structured key=value only,
  encoding-safe.
- [x] AuthN/Z — no auth surface touched.
- [x] Error handling — surfaces a typed `BreedExhaustionError` with no
  internal paths leaked; the legacy diagnostic write to `./.invalid_father.json`
  is now best-effort and cannot mask the original error.
- [x] Dependencies — none added.
