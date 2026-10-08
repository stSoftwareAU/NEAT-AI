# PR Summary — Issue #4050: RangeError in evolveDir() after hard-deadline abandonment

**Status:** Ready for review\
**Base:** Develop\
**Issue:** [#4050](https://github.com/stSoftwareAU/NEAT-AI/issues/4050)

## Summary

Fixed the race behind `RangeError: Invalid array length` in
`CreatureExportBuilder.build()` during checkpoint writes after a hard-deadline
abandonment, following a `CHANGES_REQUESTED` review (`stsoftware-pr-reviewer`,
PR #4051) that found the first version of this PR treated the symptom and left
the race itself unfixed.

**Root cause:** When `awaitWithinHardDeadline()` detects a timeout during
`neat.evolve()`, it returns immediately (via `Promise.race()`) but the work
Promise continues running in the background (`work.catch(() => {})`). The outer
loop breaks and `BoundedEvolveTeardown`'s checkpoint write starts exporting
`neat.population` — but the abandoned `evolve()` can still be running, and when
it reaches its population commit it disposes members of that same array
(clearing their `neurons`/`synapses`) out from under the in-flight export.
`CheckpointWriter.writeCreatures()` yields at each batch's
`await Promise.all(batch)`, so a creature in a later batch can be disposed
before its turn comes up, and `exportJSON()` then throws
`RangeError: Invalid array length` (`new Array(neuronsLength - input)` with
`neuronsLength < input`).

## Fixes

### Fix 1 (root cause): abandoned generations no longer commit (src/NEAT/NeatEvolution.ts)

`evolve()` captures `neat.abandonEpoch` at entry (`scheduledEpoch`). Immediately
before the population commit — swap, budget- drop logging, trim,
random-immigrant injection, dedup, WASM pre-warm, and the dispose loop — it
checks `neat.isRunAbandonedSince(scheduledEpoch)`, the same token/idiom `Neat`
already uses to discard late discovery/training completions (Issue #3435). When
the run has been abandoned since this generation started, the whole commit is
skipped: `neat.population` and every previous member are left exactly as they
were, so a concurrent checkpoint write never sees them mutated.

### Fix 2: temp-dir checkpoint writes (src/creature/CheckpointWriter.ts)

Writes land in a sibling temp directory and are swapped into place only once
every member has been exported and written without error. The previous version
emptied `dir` up front, so a write failure — or every member being disposed —
replaced the last-good checkpoint with gaps or nothing instead of leaving it
untouched. A population that produces zero written members (every member
disposed) now throws rather than silently swapping in an empty store.

**Revised after the #4051 review** (two further findings on this fix): the temp
dir uses a fixed `${dir}.tmp` name, cleared at the start of every call, rather
than a fresh `${dir}.tmp-<uuid>` per call — a random name was never revisited,
so a crash between `mkdir` and the final rename left an orphan population copy
next to the store forever (fleet hosts see routine OOM/ wall-clock kills). The
swap itself renames `dir` aside to `${dir}.old` rather than deleting it, then
renames the temp dir into place, then removes `${dir}.old` — so a kill between
the two renames leaves `${dir}.old` holding the last-good checkpoint instead of
leaving none at all; the next call recovers it. The write-failure catch block
also now awaits any batch writes still in flight (`Promise.allSettled`) before
removing the temp dir, closing a race where the cleanup remove could collide
with a write still creating its file and either crash the process on an
unhandled rejection or mask the original error with a "Directory not empty"
failure.

### Fix 3: explicit disposed-creature detection (src/creature/CheckpointWriter.ts)

A disposed creature is now detected explicitly
(`creature.neurons.length < creature.input` — the exact precondition that makes
`CreatureExportBuilder.build()`'s `new Array(neuronsLength - input)` throw, and
the only way `Creature.dispose()` can produce it) and skipped _before_ calling
`exportJSON()`, instead of catching every `RangeError` the export throws. A
genuine export bug on a real, non-disposed creature now propagates with its
original message rather than being silently logged as "disposed".

### Fix 4: corrected log message (src/creature/BoundedEvolveTeardown.ts)

- **Old:** `[${label}] teardown: persisting the evolved best creature failed`
- **New:**
  `[${label}] teardown: persisting evolved checkpoint and champion failed`

### Fix 5 (PR #4051 review round 2): trailing-separator `creatureStore` paths (src/creature/CheckpointWriter.ts)

`tempDir`/`oldDir` were built by string concatenation on the raw `dir`
(`${dir}.tmp`, `${dir}.old`). A `creatureStore` ending in a separator (e.g.
`"out/"`, which shell tab-completion adds by default) made both siblings land
*inside* the store (`out/.tmp`, `out/.old`) instead of beside it, so the swap's
`Deno.rename(dir, oldDir)` tried to rename the store into its own subdirectory
and failed with `EINVAL` on every write. `dir` is now resolved with
`@std/path`'s `resolve()` once, up front, and every rename/mkdir/remove below
uses that resolved path — `resolve()` strips a trailing separator, so the
siblings are always true siblings of the store.

### Fix 6 (PR #4051 review round 2): CHANGELOG scope

The only `#4050` CHANGELOG entry described the Fix 4 log-message correction and
said nothing about the `creatureStore` behaviour change (temp-dir swap and its
`.tmp`/`.old` siblings, keeping the previous checkpoint on failure, skipped and
possibly-gapped numbering, the all-disposed refusal, abandoned generations no
longer committing, trimmed creatures now disposed). Rewrote the entry to cover
all of it, and updated `docs/PERFORMANCE_TUNING.md`'s
"File contents and numbering … are unchanged" sentence, which this PR made
false (numbering can now have gaps).

## Test Coverage

- `test/NEAT/HardDeadlineDisposalRegression.ts` — rewritten. The previous
  version caught every error from `evolveDir` and asserted `assert(true)`, so it
  could not fail on Develop and never reproduced the race (generation 1 is
  uncapped, and the injected clock jumped past the hard deadline before
  generation 2 started). The new test calls `neat.evolve()`, abandons it
  synchronously before awaiting it (deterministic — no real clock wait), and
  asserts `neat.population` is the _same reference_ and every original member
  still has `neurons.length > 0`. Confirmed red against the pre-fix
  `NeatEvolution.ts`.
- `test/creature/CheckpointWriteBatching.ts` — five tests from the original fix:
  a disposed creature in the middle of the population is skipped and named; a
  creature disposed mid-write by a racing writer is skipped without corrupting
  the rest; a genuine (non-disposal) export error still propagates; an
  all-disposed population is refused rather than replacing the checkpoint; a
  write failure partway through leaves the previous checkpoint byte-for-byte
  unchanged. Three more added for the #4051 review: the cleanup remove awaits an
  in-flight batch write before running (without the fix, the unhandled rejection
  crashed the whole test module — the exact symptom the review named); a stale
  leftover temp dir from a previous crash is discarded rather than merged in; a
  leftover `.old` dir from a kill between the two swap renames is recovered into
  `dir` on the next call. All eight confirmed red against the pre-fix code.
- **Round 2 (#4051 review):** one more test —
  `writeCreatures replaces an existing checkpoint when dir has a trailing
  separator` writes twice to a store path ending in `/` and asserts the second
  write replaces the first, with no `.tmp`/`.old` left behind. Confirmed red
  (`EINVAL`) against the pre-fix code.

**Docs sweep** — grep: `isRunAbandonedSince`, `abandonEpoch`,
`awaitWithinHardDeadline`, `CheckpointWriter`, `checkpointEveryGeneration`,
`creatureStore`; sections:
`docs/TIMEOUTS.md#-what-each-phase-does-at-the-hard-cap` (documents the
abandoned-generation background work this fix stops from mutating shared
state, unchanged), `docs/PERFORMANCE_TUNING.md#checkpoint-write-memory-creature-store`
(documents the batched checkpoint write; **updated** — the swap is now
described as atomic/crash-recoverable and the numbering sentence now says gaps
are possible, since disposed members are skipped), `CHANGELOG.md`
(**rewritten** `#4050` entry — the original only described the Fix 4 log-message
correction) and `docs/OPTION_AUDIT_SLICE_E.md` / `docs/TIMEOUTS.md`'s other
`creatureStore` mentions (read, not updated — neither claims contiguous
numbering or no sibling directories).

Current totals: 12 `PopulationCap` + 20 `CheckpointWriteBatching` + 1
`HardDeadlineDisposalRegression` = 33 tests across the three files this PR
touches, all passing.

## Branch outcomes

- ✅ An abandoned generation's population commit is skipped entirely — no swap,
  no dispose — verified by identity and by every original member keeping its
  neurons (`test/NEAT/HardDeadlineDisposalRegression.ts`).
- ✅ A checkpoint write failure, or an all-disposed population, leaves the
  previous checkpoint untouched (`CheckpointWriteBatching.ts`: atomicity and
  all-disposed-refusal tests).
- ✅ A disposed creature mid-population, or disposed mid-write by a racing
  writer, is skipped and named without aborting the write
  (`CheckpointWriteBatching.ts`: disposed-in-the-middle and disposed-mid-write
  tests).
- ✅ A genuine export error on a non-disposed creature is not mislabelled as
  disposal (`CheckpointWriteBatching.ts`: genuine-error-passthrough test).
- ✅ Corrected log message accurately reflects what is being persisted.
- ✅ A write failure never races the temp-dir cleanup against a write still in
  flight (`CheckpointWriteBatching.ts`: cleanup-race test).
- ✅ A crash between `mkdir` and the final rename never orphans a population
  copy forever; a crash between the two swap renames never leaves zero
  checkpoints on disk — both recovered by the next call
  (`CheckpointWriteBatching.ts`: stale-tempDir and `.old`-recovery tests).
- ✅ A `creatureStore` path ending in a separator still swaps correctly, with
  no `.tmp`/`.old` left on disk
  (`CheckpointWriteBatching.ts`: trailing-separator test).

## Changes

| File                                          | Change                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/NEAT/NeatEvolution.ts`                   | Abandoned generations skip the entire population commit (root-cause fix)                       |
| `src/creature/CheckpointWriter.ts`            | Temp-dir swap with crash recovery and race-safe cleanup; disposed-creature check before export |
| `src/NEAT/PopulationCap.ts`                   | `PopulationTrimResult.removedCreatures` field (from the first iteration)                       |
| `src/creature/BoundedEvolveTeardown.ts`       | Corrected log message                                                                          |
| `test/NEAT/HardDeadlineDisposalRegression.ts` | Rewritten so it actually reproduces the race and can fail                                      |
| `test/creature/CheckpointWriteBatching.ts`    | Nine tests for atomicity, disposal-detection, cleanup-race, crash-orphan and trailing-separator fixes |
| `CHANGELOG.md`                                | Rewrote the `#4050` entry to cover the full `creatureStore` behaviour change                   |
| `docs/PERFORMANCE_TUNING.md`                  | Updated the numbering sentence: gaps are now possible                                          |

## Definition of Done

- [x] Identify code path leaving disposed creatures
- [x] Pin the actual root cause (abandoned-generation commit race), not just the
      symptom at the export boundary
- [x] Implement safe export mechanism (explicit disposed check, not a blanket
      `RangeError` catch)
- [x] Handle unexportable creatures by skipping, with crash-recoverable
      checkpoint writes so a failure or all-disposed population cannot destroy
      the last-good checkpoint
- [x] Write a regression test that reproduces the race and fails without the fix
      (`HardDeadlineDisposalRegression.ts`)
- [x] Fix misleading log text at `BoundedEvolveTeardown.ts`
- [ ] Close issue with fleet log line quote — **not done**: the log line
      previously posted on the issue as "from the fixed release" is the original
      failure trace (abandon + population-budget drop) with only the teardown
      log text swapped in; it shows the abandon happening, not a checkpoint
      write completing successfully afterwards. No such end-to-end log has been
      captured for this fix.

## Notes

- Hard-deadline abandonment is an intentional failure mode where
  `Promise.race()` prioritizes the deadline over waiting for `neat.evolve()` to
  complete. The abandoned work continues running in the background (explicitly
  handled with `work.catch(() => {})`); the fix is to stop that background work
  from mutating shared state once it is known abandoned, not to make its
  mutation safe to interleave with a concurrent reader.
- All changes are defensive and maintain the existing architecture; no breaking
  changes to public APIs.
