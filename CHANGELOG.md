# Changelog

All notable changes to `@stsoftware/neat-ai` are documented here.

The format is loosely based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Issue #2517:** `Fitness.calculate` now partitions the unique creature queue
  by `forwardOnly` before invoking the external `rust_scorer` in batch
  (directory) mode. The scorer rejects directory inputs containing any
  `forwardOnly=false` creature, so a single recurrent creature in a generation
  previously poisoned the batch and forced a per-creature fallback for the whole
  population — collapsing the once-per-generation performance benefit from Issue
  #2422.

  The new flow:

  - Forward-only creatures take the batch path (one `rust_scorer` process per
    generation, as before).
  - Recurrent creatures take the per-creature worker path directly.
  - When the forward-only subset is empty, the batch is skipped entirely (no
    temp dir, no spawn).
  - Scorer telemetry (`lastBatchScorerInvocations`, `lastScorerMs`,
    `lastScoredCreatureCount`) aggregates across both paths so observability
    remains accurate.
  - One INFO log line per generation summarises the partition, e.g.
    `Batch scorer partition: 49 forwardOnly batched, 1 recurrent
    per-creature`.

## [3.2.0] - 2026-05-05

### Changed (breaking-by-default)

- **Issue #2514:** `Creature.loadFrom` and `Creature.fromJSON` now throw a
  `TopologyError` by default when a forward-only creature carries a `from >= to`
  synapse. The old strip-and-warn behaviour silently self-healed the topology on
  every load and hid the producing pipeline's stack frame, so upstream
  corruption became invisible. The new default surfaces the offending synapse,
  depth, source tag, and structural-hash identifier so the producer can be
  fixed.

  A new option, `throwOnRecurrent: "always" | "forwardOnly" | "never"`, is
  accepted on both `loadFrom` and `Creature.fromJSON` (defaults to
  `"forwardOnly"`). Repair tools and diagnostic paths that intentionally process
  corrupt input — `compactCreature`, the `applyChangeToCreature` family in
  `discovery/CandidateApplicationOps`, the legacy v0/v1/v2 upgrade pipeline, and
  the `compact:*` repair helpers — opt in to `"never"` explicitly with a code
  comment naming the bypass.

  Migration: callers that legitimately ingest corrupt forward-only JSON (e.g. a
  repair tool reading historical genomes) should pass
  `{ throwOnRecurrent: "never" }` to preserve the previous behaviour. Callers
  that produce forward-only JSON should ensure no recurrent edge ever appears —
  that is the whole point of the new default.
