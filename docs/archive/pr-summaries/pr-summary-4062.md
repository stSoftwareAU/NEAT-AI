# Record the closing log evidence for the dangling-memetic fix

## Summary

Part of #4062.

This change adds no code. The fixes for this issue are already on `Develop`: the
writer-side prune (`writeCreatures` → `pruneDanglingMemeticFromExport`, PRs
#4064 and #4100) and the load-side prune (`loadFrom`, PR #4131, merge commit
`a4adf05b`). What this change does is replace the pre-change log search in
`docs/archive/pr-summaries/pr-summary-4062.md` with one run against the release
that carries both, and say plainly what is still open.

Two things remain open: the producing path on GRQ-21 is still not identified,
and the log window is about 5 days of the 7 the issue asks for.

Version bump: no `VERSION` change is made by this documentation-only change.

## Spec

### Intent and Rationale

- The issue asks for a week of sampler-host logs on the fixed release with no
  `rule=ValidationError/MEMETIC` repair lines. That evidence now partly exists,
  so it is recorded rather than left as "logs only exist after a week".

### Essential Design Decisions

- No code is changed: earlier rounds fuzzed every mutation operator,
  `fineTuneImprovement` and real `evolveDataSet` runs and found no producer, so
  a further speculative change would be fixing a fault that was not reproduced.

### Undiscoverable Facts

- The logs live in a separate repository that only holds rotating snapshots, so
  the search below is bounded by what was snapshotted.
- Because load now repairs a stale memetic before downstream code sees it, a
  downstream `rule=ValidationError/MEMETIC` repair line can no longer appear for
  a load that goes through `Creature.fromJSON`; the `[loadFrom] Pruned` and
  `[CheckpointWriter] Pruned` warnings are the signal to search for as well.

## Evidence

Backend, documentation-only. The searches ran in a clone of the downstream
production log repository's `Develop` branch:
`git clone --single-branch --branch Develop --shallow-since=2026-10-31`, 1971
snapshot commits from 2026-10-31 to 2026-11-06.

**Release carrying the fix.** `a4adf05b` (merged 2026-10-31T17:23Z) has
`deno.json` version 7.1.2. Hosts logged `[neat-ai] running version 7.1.2` from
2026-11-01T09:05Z to 2026-11-05 and `7.1.3` from 2026-11-05 to 2026-11-06
(`git log -S"running version 7.1.2"`, likewise 7.1.3). Version 7.1.1 appears
only on 2026-11-01, for about 1.5 hours before 7.1.2, and is outside the window.

- Search 1:
  `git log -G"ValidationError/MEMETIC|INVALID CREATURE|repairing an INVALID creature" --format=%h`
  found 0 commits, and `grep -c` for the same terms over the two files at the
  head was 0.
- Search 2: `git log -G"Pruned [0-9]+ memetic" --format=%h` (the `[loadFrom]`
  and `[CheckpointWriter]` warnings) found 0 commits, and
  `git log -S"[creature-repair]"` found 0.
- Control that the search can see sampler loads: `git log -S"option=sampler"`
  found 32 commits and `git log -S"copyNetworks:"` found 29, spanning 2026-10-31
  to 2026-11-06.
- Window on 7.1.2 and 7.1.3: about 5 days (2026-11-01T09:05Z to 2026-11-06). A
  full week is reached on 2026-11-08.

Limits: the repository keeps rotating snapshots, so a line written and rotated
out between two snapshots would not be seen.

Earlier evidence from PR #4100, before the load-side prune, release 7.0.57:
`grep -c "ValidationError/MEMETIC" *.log` was 0 in all 25 files at the head, and
`git log -S"rule=ValidationError/MEMETIC"` found only the two commits that
carried and rotated out the line quoted in the issue.

Issue numbers cited as provenance, each read with `gh`: #4062 (this issue, "a
dangling memetic reference"), #3844 and #4052 (named in the issue body), #4064,
#4100 and #4131 (the earlier PRs for this issue).

## Reproduction

- **symptom** — a population file loads with
  `Memetic from id X to id Y has no
  matching synapses`, so GRQ repairs it and
  calls it an upstream defect.
- **status** — `partial` — reason: persistence of a stale memetic through load,
  export and `memeticUpdate` was reproduced against the base code in #4131; the
  original producer on GRQ-21 is not, and `.creatures/10.json` was not available
  to load.
- **regression test** —
  `test/creature/LoadPrunesDanglingMemetic.ts::a loaded dirty creature passes core creatureValidate (#4062)`

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **missing** — Identify the producing path. Load `.creatures/10.json` from
  rocket@GRQ-21 if it still exists, or reproduce with a checkpoint write during
  a deadline-abandoned generation — reviewer: missing — reason: the first writer
  of the stale record is not identified; fuzzing every mutation operator,
  `fineTuneImprovement` and `evolveDataSet` runs (recorded in #4131) found none,
  and the file is not available
- **met** — `writeCreatures` (or the producing mutation) never persists a
  creature whose `memetic` references a missing synapse: either
  validate-before-write, or prune at the mutation site — evidence:
  `src/creature/CheckpointWriter.ts::writeCreatures` and
  `test/creature/CheckpointWriteDanglingMemetic_test.ts`, merged in #4064 —
  reviewer: met
- **partial** — Regression test: run the identified path (e.g. abandon
  generation N while its mutations are in flight, then write the checkpoint) and
  assert every written creature passes `ValidationError/MEMETIC` validation —
  evidence: `test/creature/CheckpointWriteDanglingMemetic_test.ts` and
  `test/creature/LoadPrunesDanglingMemetic.ts` — reviewer: partial — reason: no
  path was identified, so the test runs a real `SubConnection` mutation between
  checkpoint batches rather than the producing path
- **partial** — Closing evidence: a week of logs from the downstream production
  sampler hosts with no `rule=ValidationError/MEMETIC` repair lines on the fixed
  release, quoted with the search used — evidence: Evidence above (0 repair
  lines and 0 prune warnings on 7.1.2 and 7.1.3, sampler loads logged
  throughout) — reviewer: partial — reason: the window is about 5 days of the 7
  asked for; the week completes on 2026-11-08

## Test Plan

No test is added or edited; this change is documentation only. The tests named
above exist at the head (`git ls-files` from the repository root lists
`test/creature/LoadPrunesDanglingMemetic.ts` and
`test/creature/CheckpointWriteDanglingMemetic_test.ts`). `deno fmt --check` on
the summary was run.

<!-- vibe-quality-gate-skipped reason="documentation-only change; no code, lint or test input changed" -->

Skipped or unverified: the producing path on GRQ-21 and `.creatures/10.json`,
the last two days of the seven-day log window, and the full quality gate (CI
runs it).
