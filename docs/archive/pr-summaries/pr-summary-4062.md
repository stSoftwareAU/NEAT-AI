# Record the remaining evidence for dangling memetic checkpoints

## Summary

Updated the #4062 evidence record against the current `Develop` code and the
complete available private log archive history for the requested week. The
writer and load-time protections are already merged. The original GRQ-21
producer remains unidentified, and the archive has sampler-activity gaps, so
this is Part of #4062.

Version bump: none; this documentation-only update changes no version.

## Spec

### Intent and Rationale

- Re-check the two remaining evidence gaps after the earlier fixes landed, using
  the complete available archive history and the current deadline-abandon path.

### Essential Design Decisions

- No production change is made because the original producer or a dangling
  reference from the current production path was not reproduced. The checkpoint
  writer already prunes dangling references from exported JSON.
- Keep the remaining criteria open where the production cause or continuous
  sampler coverage is not demonstrated.

### Undiscoverable Facts

- The private `Develop` log archive keeps rotating snapshots. Its current head
  is `0e6caba2fa580a4793b9b238a6386837d294c7e5`.
- `.creatures/10.json` is not in that repository's history. Read-only SSH
  retrieval was attempted; the host could not be resolved in this environment.

## Evidence

Backend and documentation-only. The current `Develop` tree already contains
these merged changes:

- PR #4064 (`d7c8f722`): `writeCreatures` prunes dangling memetic references
  from the exported JSON; `CheckpointWriteDanglingMemetic_test.ts` covers the
  writer boundary.
- PR #4100 (`71faa1f8`): expanded the checkpoint regression coverage.
- PR #4131 (`a4adf05b`): load-time pruning prevents a stale persisted reference
  from surviving `loadFrom`.
- PR #4135 (`30f4117f`): recorded the interim log search and its remaining
  limits.

`src/NEAT/NeatEvolution.ts` returns an abandoned generation immediately after
fitness detects the changed abandon epoch, before breeding and mutation. If an
abandon lands during the later deduplication await, the generation's population
commit has already happened; the post-await guard leaves the previous members
undisposed. `test/NEAT/EvolveAbandonedAfterFitness.ts` exercises the real
`Neat.evolve` path, and
`test/creature/EvolveDirGenerationTwoAbandonCaller_test.ts` uses a held promise
in the `evolveDir` path. The latter reached bounded teardown and the
generation's mid-commit abandon guard. Neither test produces a dangling memetic.
The checkpoint test that does produce a dangling reference uses a real
`SubConnection` mutation injected between writer batches; it is not the
production generation producer.

**Private log archive search.** Retrieved with the authenticated GitHub CLI. The
archive head was `0e6caba2fa580a4793b9b238a6386837d294c7e5`. The requested
window was `2026-11-01T09:05:00Z` through `2026-11-08T09:05:00Z`; 2,202 archive
commits fall in that range. The first and last in-window snapshot commits were
`0c1bbdf9dad383488501883efab481912b682254` at `2026-11-01T09:05:56Z` and
`9524befc952c88ac4995a39f35fc53abdf3abb8e` at `2026-11-08T09:03:46Z`.

The following history searches returned zero matching commits. Snapshot trees
immediately before and after the requested window were also checked for the same
repair and prune phrases (zero matches):
`54c7cc44558304db3b51d427d9d2a43dca02bf98`,
`0c1bbdf9dad383488501883efab481912b682254`,
`9524befc952c88ac4995a39f35fc53abdf3abb8e`, and
`dceca64ab7eaf49b1d26d719265995862bc67134`.

- `git -C /tmp/log-archive-4062 log --since='2026-11-01T09:05:00Z' --until='2026-11-08T09:05:00Z' -G 'rule=ValidationError/MEMETIC|INVALID CREATURE|repairing an INVALID creature' --format='%H' -- '*.log'`
- `git -C /tmp/log-archive-4062 log --since='2026-11-01T09:05:00Z' --until='2026-11-08T09:05:00Z' -G 'loadFrom.*Pruned .*dangling memetic' --format='%H' -- '*.log'`
- `git -C /tmp/log-archive-4062 log --since='2026-11-01T09:05:00Z' --until='2026-11-08T09:05:00Z' -G 'CheckpointWriter.*Pruned .*dangling memetic' --format='%H' -- '*.log'`

Positive controls found 58 commits changing `option=sampler` lines and 44
changing `copyNetworks:` lines. Sampler activity was present in these ten log
files, covering eight hosts: `GRQ-3` (rocket, sloth), `GRQ-10` (rocket),
`GRQ-11` (nigel), `GRQ-13` (rocket), `GRQ-18` (rocket, sloth), `GRQ-19`
(rocket), `GRQ-22` (rocket), and `GRQ-24` (rocket). The first sampler marker was
at `2026-11-01T12:52:11Z`; the last was at `2026-11-08T08:57:59Z`. Thus the
positive-control markers span 6 days, 20 hours, 5 minutes and 48 seconds, with
no marker in the first 3 hours 47 minutes or last 7 minutes of the target
window. GRQ-21 is absent.

The positive-control and version commands were:

- `git -C /tmp/log-archive-4062 log --since='2026-11-01T09:05:00Z' --until='2026-11-08T09:05:00Z' -G 'option=sampler' --format='%H' -- '*.log'`
- `git -C /tmp/log-archive-4062 log --since='2026-11-01T09:05:00Z' --until='2026-11-08T09:05:00Z' -G 'copyNetworks:' --format='%H' -- '*.log'`
- `git -C /tmp/log-archive-4062 log --since='2026-11-01T09:05:00Z' --until='2026-11-08T09:05:00Z' -G 'option=sampler' --name-only --format= -- '*.log' | sort -u`
- `git -C /tmp/log-archive-4062 log --since='2026-11-01T09:05:00Z' --until='2026-11-08T09:05:00Z' -p -G 'running version 7\.1\.[0-9]+' -- '*.log' | grep -E '^[+-].*running version 7\.1\.[0-9]+' | sed 's/^[+-]//' | sort -u`

Distinct `[neat-ai] running version` banners in the in-window log history were
7.1.2, 7.1.3, 7.1.4, 7.1.8, 7.1.10, 7.1.11 and 7.1.12. This is the set seen in
the archive, not a claim that every sampler host ran every version.

The archive search is over snapshot diffs, including file rotations; it cannot
prove that no unsnapshotted line existed between snapshots. The observed zero
repair and prune warnings are further limited because PR #4131 prunes on load,
which can prevent a downstream `ValidationError/MEMETIC` repair line. The
absence of `[CheckpointWriter] Pruned` warnings is useful evidence about the
writer, subject to the same snapshot and host-coverage gaps.

The original-file retrieval command was
`GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=5' timeout 8 ssh rocket@GRQ-21 'test -r .creatures/10.json && echo available || echo unavailable'`.
It failed with
`ssh: Could not resolve hostname grq-21: Temporary failure in name resolution`.
The archive path search
`git -C /tmp/log-archive-4062 log --all --format= --name-only -- '.creatures/10.json'`
found no matching path.

## Reproduction

- **symptom** — the reported `.creatures/10.json` has a memetic pair with no
  matching synapse and is repaired as `ValidationError/MEMETIC`.
- **status** — `partial` — the writer boundary was tested with a stale memetic,
  and controlled deadline-abandon tests exercised the production generation and
  teardown paths. The original file was unavailable, and the production
  generation path did not reproduce a dangling reference.
- **regression test** —
  `test/creature/CheckpointWriteDanglingMemetic_test.ts::a checkpoint written while an abandoned generation prunes a synapse holds only valid creatures (#4062)`

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **missing** — Identify the producing path. Load `.creatures/10.json` from
  rocket@GRQ-21 if it still exists, or reproduce with a checkpoint write during
  a deadline-abandoned generation. — reviewer: missing — reason: The file was
  not retrievable, and the controlled production-path exercise did not produce a
  dangling reference or identify the producer.
- **met** — `writeCreatures` (or the producing mutation) never persists a
  creature whose `memetic` references a missing synapse: either
  validate-before-write, or prune at the mutation site. — evidence:
  `src/creature/CheckpointWriter.ts::writeCreatures` and
  `test/creature/CheckpointWriteDanglingMemetic_test.ts` — reviewer: missing —
  reason: The independent Spec reviewer was not run; the writer protection is
  present on `Develop` from PRs #4064 and #4100.
- **partial** — Regression test: run the identified path (e.g. abandon
  generation N while its mutations are in flight, then write the checkpoint) and
  assert every written creature passes `ValidationError/MEMETIC` validation. —
  evidence: `test/creature/CheckpointWriteDanglingMemetic_test.ts` and
  `test/NEAT/EvolveAbandonedAfterFitness.ts` — reviewer: missing — reason: The
  writer test validates files after an injected `SubConnection` mutation; the
  production deadline test does not produce the fault or assert memetic validity
  on its checkpoint files.
- **partial** — Closing evidence: a week of downstream production logs from
  sampler hosts with no `rule=ValidationError/MEMETIC` repair lines, quoted with
  the search used. — evidence: the archive searches above found no repair,
  `[loadFrom] Pruned`, or `[CheckpointWriter] Pruned` warning commits; sampler
  markers span 6 days, 20 hours, 5 minutes and 48 seconds across eight hosts,
  not the full week, and do not include GRQ-21 — reviewer: missing — reason:
  sampler markers leave 3 hours 54 minutes and 12 seconds of the requested
  window uncovered; snapshots rotate and load-time pruning limits what a zero
  repair-line result proves.

## Standards Review

No independent Standards reviewer was run because the executor instruction
explicitly prohibits delegation. No reviewer provenance marker is claimed.

## Test Plan

- `timeout 180 deno test -A test/creature/CheckpointWriteDanglingMemetic_test.ts test/NEAT/EvolveAbandonedAfterFitness.ts < /dev/null`
  — passed, 15 passed / 0 failed.
- `timeout 180 deno test -A test/creature/EvolveDirGenerationTwoAbandonCaller_test.ts < /dev/null`
  — passed, 1 passed / 0 failed. The mock worker emitted
  missing-`neat_ai_backpropagation` errors while still reaching the
  deadline-abandon teardown path; this test does not inspect memetic references.
- No tests were added or edited. These runs exercise the existing writer
  boundary, fitness-abandon and controlled `evolveDir` paths.

Skipped or unverified: a full week of continuous sampler coverage, GRQ-21 and
its original checkpoint, the production producer, and independent Spec and
Standards reviews.
