# Changelog

All notable changes to `@stsoftware/neat-ai` are documented here.

The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

**Sibling docs:** [`README.md`](./README.md) — overview;
[`AGENTS.md`](./AGENTS.md) — coding conventions;
[`CONTRIBUTING.md`](./CONTRIBUTING.md) — contributor guide;
[`SECURITY.md`](./SECURITY.md) — vulnerability disclosure policy;
[`docs/README.md`](./docs/README.md) — topic index.

## [Unreleased]

### Added

- **Issue #2736:** New `"CATEGORICAL_ERROR"` built-in cost function for
  multi-class one-hot targets. It reports the argmax misclassification rate
  (`error = 1 - accuracy`) so `evolveDir` `error`/`score`, champion selection
  and the `targetError` early-stop reflect real classification quality instead
  of the trivial MSE floor (~`0.1` for ten balanced classes) that a chance-level
  classifier can reach. Distance-based costs such as `"MSE"` can decouple from
  argmax accuracy on one-hot layouts; documented in
  [`docs/API_REFERENCE.md`](./docs/API_REFERENCE.md). The cost is
  non-differentiable and intended for scoring/early-stop — gradients are derived
  independently of `costName`, so training is unaffected.

### Security

- **Issue #2704:** `CreatureSerialization.fromJSON` (the default JSON-load path)
  now rejects creature JSON whose `bias` or synapse `weight` is not a finite
  number with a `TopologyError` (`INVALID_NEURON_BIAS` /
  `INVALID_SYNAPSE_WEIGHT`). Previously these fields were template-interpolated
  into `new Function()` bodies by the activation compilers
  (`NeuronActivation.ts`, `aggregate/IF.ts`, `aggregate/MINIMUM.ts`,
  `aggregate/MAXIMUM.ts`, deprecated `HYPOT*`), so a crafted string such as
  `"bias": "0); evil(); //"` could reach the function compiler and execute
  arbitrary JS in the host process. The `Neuron` constructor now also asserts a
  finite bias for non-input neurons as defence-in-depth.

## [5.0.0]

### Added

- **Issue #2630 (closes milestone #2624):** First-class reinforcement-learning
  evolution surface. Wires `Creature.evolveRL(adapter, options)` and the
  class-shaped `EpisodeAdapter` contract through the public entry point and the
  reference documentation.
  - **`Creature.evolveRL(adapter, options)`** — library-supplied way to evolve a
    population against an `EpisodeAdapter`. Reuses the population manager,
    plateau detector, lifecycle events, and stop conditions from `evolveDir()`;
    the only difference is the scorer.
  - **`EpisodeAdapter` base class** — abstract `reset`, `step`,
    `observationLength`, and `decodeAction`; overridable termination guards
    (`maxSteps`, `wallClockMs`). Contract is validated lazily on first use via
    `assertContract()`.
  - **Default termination guards** — 60 s wall-clock and 5000 steps per episode.
    Whichever guard fires first truncates the episode (Gym/Gymnasium
    `terminated` vs `truncated` semantics).
  - **3 episodes per creature** averaged for fitness, with per-generation seed
    rotation so within-generation comparisons stay fair and the population
    cannot over-fit a single seed.
  - **Opt-in evolution statistics** — when `EvolveRLOptions.statistics === true`
    the run collects a per-milestone payload (best score, neuron/synapse counts,
    mean episode steps, wall-clock) at generations
    `1, 2, 5, 10, 20, 50, 100, 200, 500, 1000` and beyond at powers of ten.
    Payloads ship on the existing `onTrainingEvent` channel as
    `EvolveRLMilestoneEvent` and are returned as `milestones` on the run
    summary.
  - **Public re-exports from `mod.ts`** — `EpisodeAdapter`, `StepResult`,
    `EpisodeResult`, `EvolveRLOptions`, and `EvolveRLMilestone` are now
    importable from the package root so downstream consumers (notably
    NEAT-AI-Examples) do not have to reach into `src/`.
  - **Docs** — `docs/REINFORCEMENT_LEARNING.md` gains a "Driving evolution with
    `evolveRL`" worked example, and `docs/API_REFERENCE.md` lists `evolveRL`
    alongside `evolveDir` / `evolveDataSet`.

- **Issue #2529:** Optional Muon-inspired orthogonalised gradient update step in
  the local backprop pass. New module `src/propagate/MuonOrthogonalisation.ts`
  implements the quintic Newton-Schulz iteration plus Frobenius rescaling, and
  `src/propagate/MuonGradientHook.ts` wires it into the backprop pipeline. Gated
  by `BackPropagationArguments.gradientOrthogonalisation: "none" | "muon"`,
  defaulting to `"none"` so existing pipelines are unchanged.

- **Issue #2545:** JSR-hosted-worker WASM bootstrap is now documented and the
  helper functions it relies on are exported from the public entry point. Fixes
  the production worker startup failure described in #2543 without forcing
  consumers onto unstable Deno worker options or inlining the WASM bytes.

- **Issue #2546:** Writer-side forward-only assertion for
  `exportJSONWithRuntimeIds()`. Production GRQ logs continued to show
  `[loadFrom] Recurrent synapse … source=fromJSON` `TopologyError` throws on
  every load even after Issue #2515 wired
  `assertNoRecurrentSynapseOnForwardOnly` into the discovery combiners and the
  public `exportJSON` save path. The audit missed `exportJSONWithRuntimeIds` —
  the internal export that worker training (`WorkerProcessor`), evolution
  scheduling (`NeatScheduling`), training teardown / outcome / setup, compaction
  (`CompactUnused`), discovery replay (`ReplayEntryApplication`), knowledge
  distillation, and the worker→main wire all route through. A forward-only
  creature that gained a recurrent synapse upstream could be persisted by any of
  those paths and surfaced only as a load-side throw on the next worker.
  Mirroring the assertion at `exportJSONWithRuntimeIds()` pins the producer's
  stack frame so the offending pipeline is named directly. Repair tools and
  legacy upgrade paths that legitimately need to serialise a not-yet-repaired
  creature use the new `exportJSONWithRuntimeIdsUnchecked()` companion (the
  `upgrade()` / `upgradeTwo()` legacy 1.x/2.x repair pipeline, and the
  `NeatScheduling` training-failure diagnostic write that already runs after a
  thrown training error and must not chain a second throw that masks the root
  cause), each with a code comment naming the bypass.

- **Issue #2523:** Breed-time fail-soft for corrupt parents. `findFather` now
  wraps the per-candidate `Creature.fromJSON(...)` call in a
  `try/catch (TopologyError)` block: a single corrupt parent is skipped with a
  structured
  `[breed-skip-corrupt-parent] hash=<h> reason=<r>
  source=findFather` warning,
  the loop tries the next-best candidate, and the run continues. After all
  candidates are skipped (capped at `min(10, populationSize)` retries) a
  recoverable `BreedExhaustionError` is raised so the breeding batch can carry
  on without killing the generation. The new
  `NeatOptions.tolerateCorruptParents` (default `true`) controls the behaviour;
  setting `false` restores the legacy fail-fast throw for diagnostic runs.
  Non-`TopologyError` exceptions are always re-thrown unchanged. The
  corrupt-parent skip count is surfaced in the per-batch `[Throughput]` summary
  as `corruptParentSkips=N` and on `ParallelBreeding.lastCorruptParentSkips` /
  `Breed.lastCorruptParentSkips`. Complements the producer-side throw added in
  Issue #2514: producers continue to fail fast, and the consumer-side breeding
  loop soldiers on through transient corruption.

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

### Changed

- **Issue #2630:** Library version bumped to `5.0.0`. The change is additive —
  no existing 4.x APIs were removed or modified — but the new `evolveRL` surface
  and the `EpisodeAdapter` contract are large enough that consumers should
  consciously adopt them. The UUID-stability and semantic-version-stability
  invariants from `AGENTS.md` are unaffected.
- **Issue #2513:** Discovery throughput-stall guard in
  `DataRecorderAnalysis.runAnalysisLoop` is deferred until a warm-up window of
  two completed chunks has elapsed, and only trips when the average per-chunk
  elapsed time still exceeds `perChunkMaxMs`. Warm-up time is no longer counted
  against subsequent chunks. Removes false stall trips on cold-start runs.

### Documentation

- **Issue #2566:** Added `docs/README.md` topic-by-topic index and refreshed the
  documentation map in the project `README.md`.
- **Issue #2569:** Refreshed Discovery and TypeScript ↔ Rust FFI documentation.
- **Issue #2570:** Consolidated the core dependency and parity audit doc
  cluster.
- **Issue #2565:** Refreshed `COMPARISON.md` with features merged since
  2026-04-12.

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
