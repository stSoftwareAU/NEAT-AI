# Record the remaining evidence for dangling memetic checkpoints

## Summary

Updated the #4062 evidence record against the current `Develop` code and the
complete available private log archive history for the requested week. The
writer and load-time protections are already merged. The original GRQ-21
producer remains unidentified, and the archive has sampler-activity gaps, so
this is Part of #4062.

Version bump: `deno.json` updated for this change; the merged commit records the
final version.

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

This change records evidence in documentation and includes a package version
bump; it changes no production behaviour. The current `Develop` tree contains
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
A checkpoint test injects a real `SubConnection` mutation between writer
batches; it does not reproduce a dangling reference or identify the production
generation producer.

**In-process synapse-removal audit (run on 2026-11-09).** To look for a producer
other than the abandoned-generation path, every in-process site that removes a
synapse without going through core's `prune_synapse` was read for memetic
handling: `SubSelfCon`, `SubBackCon`, `SubNeuron` and `SwapNeurons` each
`delete creature.memetic`; `CreatureTraining.applyLearnings` (the only caller of
the `IF`/`MAXIMUM`/`MINIMUM` `applyLearnings` that calls `Creature.disconnect`)
deletes `memetic` whenever it reports a structural change; and `Creature.fix`
runs `pruneOrphanMemeticReferences` and drops `memetic` when the content hash
moves. `Creature.disconnect` itself does not touch `memetic` or `uuid`, so a
caller outside those sites is the only remaining candidate, and none was found.
This narrows the search but does not identify the GRQ-21 producer, so criterion
1 stays `missing`.

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
changing `copyNetworks:` lines. Sampler activity was present in ten log files,
covering eight sampler hosts. The first sampler marker was at
`2026-11-01T12:52:11Z`; the last was at `2026-11-08T08:57:59Z`. Thus the
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

**Post-window extension (run on 2026-11-09).** The same repair and prune
patterns were searched from `2026-11-08T09:05:00Z` to the archive head
`760850fd41babb1c6a8e4ad5aba567f6493f03ef` (`2026-11-09T02:08:27Z`):
`git log --since='2026-11-08T09:05:00Z' -G 'rule=ValidationError/MEMETIC|repairing an INVALID creature|Pruned .*dangling memetic' --format='%H %aI' -- '*.log'`
returned zero commits, with eight commits in the same range changing
`option=sampler` lines as a positive control. The original 2026-10-13 repair
line is no longer in the archive (the same search over
`2026-10-13T00:00Z`–`02:00Z` returned zero commits), and no path mentioning
GRQ-21 exists at the archive head, so the original producer and its file cannot
be recovered from this source.

The archive search is over snapshot diffs, including file rotations; it cannot
prove that no log line existed between snapshots. The observed zero repair and
prune warnings are further limited because PR #4131 prunes on load, which can
prevent a downstream `ValidationError/MEMETIC` repair line. The absence of
`[CheckpointWriter] Pruned` warnings is useful evidence about the writer,
subject to the same snapshot and host-coverage gaps.

A read-only SSH probe of the original producer host for `.creatures/10.json` was
attempted with a short connect timeout. It failed with
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
  generation path did not reproduce a dangling reference. In addition, with the
  writer's prune disabled, the real-`SubConnection` race test still passes: a
  genuine `SubConnection` removal racing the export leaves a consistent memetic
  (core's `prune_synapse` owns the memetic cleanup), so that test guards the
  writer boundary but does not reproduce the fault. Only the synthetic-fault
  writer tests fail without the prune. reason: the original file was unreachable
  and no production path was found that leaves a dangling memetic, so a
  fail-before observation exists only for the synthetic injection.
- **regression test** —
  `test/creature/CheckpointWriteDanglingMemetic_test.ts::a checkpoint written while an abandoned generation prunes a synapse holds only valid creatures (#4062)`

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **missing** — Identify the producing path. Load `.creatures/10.json` from
  rocket@GRQ-21 if it still exists, or reproduce with a checkpoint write during
  a deadline-abandoned generation. — reviewer: missing — reason: the file was
  unreachable; the real `Neat.evolve` and `evolveDir` abandon tests, and a real
  `SubConnection` race, produce no dangling memetic (the last re-checked with
  the writer prune disabled), so the producer is still inferred, not identified.
- **met** — `writeCreatures` (or the producing mutation) never persists a
  creature whose `memetic` references a missing synapse: either
  validate-before-write, or prune at the mutation site. — evidence:
  `src/creature/CheckpointWriter.ts::writeCreatures` and
  `test/creature/CheckpointWriteDanglingMemetic_test.ts::writeCreatures never writes a memetic row naming a missing synapse (#4062)`
  — reviewer: met
- **partial** — Regression test: run the identified path (e.g. abandon
  generation N while its mutations are in flight, then write the checkpoint) and
  assert every written creature passes `ValidationError/MEMETIC` validation. —
  evidence:
  `test/creature/CheckpointWriteDanglingMemetic_test.ts::a checkpoint written while an abandoned generation prunes a synapse holds only valid creatures (#4062)`
  — reviewer: partial — reason: the path is simulated at the writer boundary,
  not an identified production path, and with the prune disabled this test still
  passes, so it does not discriminate; the `Neat.evolve`/`evolveDir` abandon
  tests do not assert memetic validity on their checkpoints.
- **partial** — Closing evidence: a week of downstream production logs from
  sampler hosts with no `rule=ValidationError/MEMETIC` repair lines, quoted with
  the search used. — evidence: the archive searches above (zero repair,
  `[loadFrom] Pruned` or `[CheckpointWriter] Pruned` commits across 2,202
  in-window commits) — reviewer: partial — reason: sampler markers span 6 days
  20 hours 5 minutes, leaving about 3 hours 54 minutes uncovered; GRQ-21 is
  absent; snapshots can miss lines; load-time pruning can hide the repair line.
- **unrequested** — `docs/archive/handover/issue-4062.md` and this summary are
  process documents, with no behaviour change — reviewer: unrequested — reason:
  worker-generated handover note and the closure document the process requires.

## Standards Review

<!-- vibe-standards-review inputs="diff+CODING-STANDARDS.md" -->

`CODING-STANDARDS.md` does not exist in this repository; the reviewer used
`AGENTS.md`, `docs/ENGINEERING_PRINCIPLES.md` and `docs/DOC_STYLE.md`.

- **violation** — application-agnostic documentation (principle 11): a list of
  private production hosts, their login names and a runnable `ssh` probe —
  evidence: former `pr-summary-4062.md` lines 83-86 and 110 — reason: fixed in
  this diff; the host list is now "eight sampler hosts" and the probe is
  described without host or login.
- **violation** — the previous Standards section claimed no reviewer had run —
  evidence: former `pr-summary-4062.md:162-165` — reason: fixed in this diff;
  replaced by this review.
- **clean** — Australian English; the NEAT versus NEAT-AI rule;
  `test/docs/ArchiveDocsNoPrivateRepoSlugs.ts` passes; `deno fmt --check` passes
  on both files; the summary follows the `pr-summary-NNNN.md` structure; the
  diff changes documentation and the package version, so the test, logging, UUID
  and semantic-version rules do not apply.

## Test Plan

- `timeout 900 ./quality.sh --rust-scorer-bin=/var/tmp/vibe-cargo-target/NEAT-AI-5d15f9f9/release/rust_scorer < /dev/null`
  — passed; 10,296 passed, 0 failed, 50 ignored. Discovery verification was
  skipped because the sibling NEAT-AI-Discovery checkout was unavailable. The
  first gate attempt found this summary's private-repository references; those
  were reworded, and this full rerun passed.
- `deno test -A test/docs/ArchiveDocsNoPrivateRepoSlugs.ts < /dev/null` —
  passed, 1 passed / 0 failed.
- `timeout 180 deno test -A test/creature/CheckpointWriteDanglingMemetic_test.ts test/NEAT/EvolveAbandonedAfterFitness.ts < /dev/null`
  — passed, 15 passed / 0 failed.
- `timeout 180 deno test -A test/creature/EvolveDirGenerationTwoAbandonCaller_test.ts < /dev/null`
  — passed, 1 passed / 0 failed. The mock worker emitted
  missing-`neat_ai_backpropagation` errors while still reaching the
  deadline-abandon teardown path; this test does not inspect memetic references.
- No tests were added or edited. A temporary local edit disabling the writer's
  prune was used to check which tests fail without it, then reverted: the
  synthetic-fault writer tests fail; the real-`SubConnection` race test passes.
  These runs exercise the existing writer boundary, fitness-abandon and
  controlled `evolveDir` paths.

Skipped or unverified: a full week of continuous sampler coverage, GRQ-21 and
its original checkpoint, and the production producer. Discovery-library
verification was also skipped by the quality gate because its sibling checkout
was unavailable.
