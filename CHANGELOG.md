# Changelog

All notable changes to `@stsoftware/neat-ai` are documented here.

The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

> [!NOTE]
> Patch releases are cut automatically: every pull request merged into `Develop`
> bumps the patch version (`.github/workflows/update-package-version.yml`) and
> publishes a GitHub release (`.github/workflows/github-release.yml`). The
> published `@stsoftware/neat-ai` version therefore advances faster than this
> file. This changelog records **notable** changes grouped under the minor or
> major version that introduced them; the routine auto-patch releases in between
> are not listed individually.

**Sibling docs:** [`README.md`](./README.md) — overview;
[`AGENTS.md`](./AGENTS.md) — coding conventions;
[`CONTRIBUTING.md`](./CONTRIBUTING.md) — contributor guide;
[`SECURITY.md`](./SECURITY.md) — vulnerability disclosure policy;
[`docs/README.md`](./docs/README.md) — topic index.

## [Unreleased]

### Added

- **Issue #3422:** Every `evolve*` result now carries a run-level `statistics`
  block for throughput tuning, so the production run's `result.json` is
  self-contained enough to compare configurations across the fleet. It records
  the configured `populationSize` (plus the final actual size when adaptive
  population sizing is enabled), host `hardware` descriptors (CPU cores, total
  memory, host id), a JSON-safe echo of the caller's `requestedOptions` (see the
  #3427 note under Changed for how non-serialisable options are handled), and an
  `improvement` milestone summary — the generation / elapsed time / creatures
  scored at which the run reached 25/50/75/90% of its total score improvement
  (no per-generation series). New public type exports: `EvolveRunStatistics`,
  `HardwareDescriptor`, `OptionsEcho`, `ImprovementSummary`,
  `ImprovementMilestone`.
- **Issue #3412:** New `DatasetError` typed error (exported from the public
  barrel) makes a vanished training dataset fail loud and clear. When the
  dataset directory or a `.bin` file is deleted out from under a running
  discovery (files vanish mid-read), the dataset I/O boundaries now throw a
  `DatasetError` naming the missing file/directory (reasons `DIRECTORY_MISSING`,
  `FILE_MISSING`, `NO_DATA_FILES`) instead of letting the fault propagate into
  scoring and surface as a misleading
  `AssertionError: Error is not finite:
  Infinity`. The translation lives in
  `src/architecture/DatasetIO.ts` and is applied to every binary-dataset read
  path (`evaluateDir`, `dataFiles`, the training epoch loop, cross-validation,
  and k-fold splitting).
- **Issue #3175:** Benchmarks in `bench/` are now runnable via a single
  documented command. `deno.json` gains a `bench` task (`deno task bench`, full
  suite) and a `bench:smoke` task (fast subset), plus a `bench` config whose
  `include`/`exclude` widen `deno bench` discovery to the PascalCase
  `Deno.bench` files while skipping the standalone profiling harnesses. A new
  `.github/workflows/bench.yaml` runs the smoke pass in CI so benchmarks are
  actually executed. Verification confirmed the "Performance"-named files under
  `test/` (`FatherPerformance.ts`, `OffspringBreedPerformance.ts`,
  `DiscoveryPerformanceSummary.ts`, `PerformanceGuide.ts`, and the `test/bench/`
  harness tests) are genuine, fast correctness tests — their timing counterparts
  already live in `bench/` — so they remain in the unit suite with no coverage
  regression.
- **Issue #3053:** New `trainingTaskTimeoutMinutes` option caps the wall-clock
  budget of any **single** training task independent of the overall
  `timeoutMinutes` run budget (default `5`; `0` disables). Previously a task
  inherited the entire remaining run budget, so a stuck creature could burn
  10–13 minutes before timing out. The per-task budget is now
  `min(remainingRunMinutes, trainingTaskTimeoutMinutes)` and the worker-side
  loop evaluates the deadline on **every sample** (not only behind the 60s
  progress-log gate), so a task that exceeds its cap is abandoned promptly. An
  incremental Neat-level watchdog (`Neat.abandonStuckTrainingTasks()`) also
  abandons each task whose worker promise never settles individually once it
  overruns its own per-task deadline (plus a small grace), instead of clearing
  them all in one batch at the hard deadline. See
  [`docs/config/TRAINING.md`](./docs/config/TRAINING.md).

- **Issue #2932:** Optional novelty (behavioural-diversity) selection to escape
  deceptive landscapes. A new self-contained module
  (`src/NEAT/NoveltySearch.ts`) adds a per-creature behaviour descriptor
  (problem-supplied via a `behaviour` tag), a bounded novelty archive, a
  k-nearest-neighbour novelty score, and a configurable blend
  `score' = (1 - weight)·fitness + weight·novelty` used in parent-selection
  ranking. **OFF by default** (`novelty: { enabled: false }`), so existing
  behaviour and tests are unchanged. A deterministic deceptive-task benchmark
  (`bench/NoveltyDeceptiveEscape.ts`) and acceptance test show novelty escaping
  a local optimum in far fewer generations than fitness-only search. See
  [`docs/NOVELTY_SEARCH.md`](./docs/NOVELTY_SEARCH.md).

### Changed

- **Issue #3427:** The `requestedOptions` echo (Issue #3422) no longer records
  non-serialisable options with a `"[function]"` / `"[unserialisable]"` marker —
  such entries are now dropped entirely, since the markers carry no tuning value
  and are pure noise in every production snapshot. The one exception is
  `creatures`: instead of dropping the seed-creature array it is echoed as its
  **count** (a number, e.g. `"creatures": 12`; an empty seed array echoes as
  `0`), because seed size can matter when comparing runs. The
  `OPTION_FUNCTION_MARKER` / `OPTION_UNSERIALISABLE_MARKER` exports are removed.

### Fixed

- **Issue #3541:** The WASM fallback is no longer used as a "fallback" for
  corrupt training data. A native scorer failure whose stderr identifies a
  malformed/truncated dataset (`Trailing N bytes (incomplete record)` and
  friends) is now classified by `src/score/ScorerFailureClassification.ts` and
  raised as a `DatasetError` with the new `CORRUPT_DATA` reason, preserving the
  scorer's own message and exit code — previously that diagnostic was demoted to
  a warning and the run died on the WASM re-read of the same bytes with a bare
  `AssertionError: Invalid number of bytes read`. Backend failures (missing
  binary, GPU init, process crash) still fall back to WASM unchanged, and
  `Fitness.calculate` no longer absorbs a data fault into its per-creature
  retry. Both dataset readers (`evaluateDir`, the training loop) now report the
  offending file, the bytes read, the record size, and the trailing byte count
  via `assertWholeRecordRead` (`src/architecture/DatasetIO.ts`).
- **Issue #3508:** The population can no longer exceed the configured
  `populationSize`. Each generation is assembled from several slices (elites,
  completed training / discovery results, fine-tuned creatures, bred offspring,
  CRISPR variants) but only the bred slice was budgeted, so several heavy-pool
  tasks completing in one generation grew the population — and the next
  generation's fitness queue — to several times the configured size (depth 48
  for `populationSize: 15` on a contended CI runner). The assembled population
  is now trimmed back to the effective population size by `trimPopulationToSize`
  (`src/NEAT/PopulationCap.ts`), dropping the weakest non-elite creatures and
  never an elite. See
  [`docs/config/POPULATION.md`](./docs/config/POPULATION.md).
- **Issue #3419 (recurrence of #3230):** WASM activation bundle loading is now
  cache-first, removing the runtime network dependency on process start. The
  loader previously let wasm-bindgen fetch
  `wasm_activation/pkg/wasm_activation_bg.wasm` from jsr.io on **every** start,
  so a transient DNS/network blip left the bundle unloaded and later crashed
  breeding uncaught in `WasmTopologyOps.validateTopology` → `requireWasm`. The
  bundle for a given version is immutable, so the network is only needed when
  the version changes. `initWasmActivation` now loads the bytes via
  `loadWasmBundleBytes` (`src/wasm/WasmBundleCache.ts`): a JSR (`https:`)
  install reads the bytes from a version-keyed on-disk cache with **no network**
  on a cache hit, and a cache miss fetches with **bounded exponential backoff**
  before erroring; the fetched bytes are persisted for the next start. Local
  (`file:`) checkouts are unchanged (direct read, no cache). Fail-loud is
  preserved: when the bytes genuinely cannot be obtained, the existing "requires
  the NEAT-AI-core WASM bundle" error still surfaces.
- **Issue #2871:** Evolution now always finalizes even when an optional training
  task never settles. Training is a best-effort phase, but the finish-up loop in
  `Neat.finishUp()` only bounded the wait for _discovery_ tasks — the _training_
  branch waited indefinitely, so an orphaned (never-resolving) training promise
  pinned `trainingInProgress` and the run spun until an external wall-clock cap
  killed it, discarding the whole compute window with no champion checkin. The
  training branch now uses the identical bounded-wait logic as discovery (the
  smaller of an iteration-derived and a wall-clock-derived generation cap; Issue
  #2432): once the budget is exhausted the stuck training task is abandoned and
  the run finalizes and checks in the best-so-far creature. The shared cap
  computation was extracted into `computeMaxWaitGenerations()`.
- **Issue #2831:** Carry over the higher generation count when breeding and
  loading creatures. The `currentGeneration` tag is now **monotonic** —
  `writeSeedWarmupProgressTags` never lowers an existing value. Previously the
  end-of-round tagging overwrote the fittest creature's generation with the
  local `Neat.currentGeneration` counter, so a cross-bred offspring that
  inherited a higher generation (`Math.max` of its parents) from another machine
  was reset to the lower local count. With ~1-minute generations and ~15-minute
  rounds, repeatedly losing the count meant a population evolving across
  machines never converged. Breeding already takes `Math.max` of both parents;
  the carryover now also survives the save/load and end-of-round write paths.

### Removed

- **Issue #3502:** Removed the unused `fitnessSampleRate` option added by #3257.
  No consumer ever set it (an org-wide search found references only inside this
  repository) and it defaulted to `1` — the full corpus — so production
  behaviour is unchanged. The option, its `NeatArguments` / `NeatOptions` /
  `NeatConfig` surface, `src/creature/FitnessSubsample.ts`, the `evaluateDir` /
  worker plumbing, `bench/FitnessSampleRate.ts`, and the **Fitness Corpus
  Subsampling** section of `docs/PERFORMANCE_TUNING.md` are all gone.
- **Issue #3558:** Removed the `ensembleDiversity` option and its ten fields. It
  was parsed into `NeatArguments` but never read by any code path — there was no
  `EnsembleDiversity*` implementation module at all — so setting `enabled: true`
  changed nothing. Neither GRQ nor NEAT-AI-Examples set it. The option surface
  (`src/config/EnsembleDiversityConfig.ts`, the `NeatArguments` / `NeatOptions`
  entries), the `parseEnsembleDiversity` parser, the `LARGE_NETWORK_PRESET`
  block that advertised it, and the documentation sections describing it as a
  working feature are all gone.

## [5.2.0] - 2026-05-30

### Changed

- Adopted the native `Temporal` API for wall-clock timestamps in training
  events, discovery cache entries, checkpoint metadata, diagnostics, and
  validation reports. Elapsed-time measurements continue to use `Date.now()` /
  `performance.now()`. (Issues #2814, #2815, #2816, #2817; policy in #2813.)

- **Issue #2791:** `trainPerGen` now auto-scales with the population for
  supervised costs so per-genome gradient training is no longer starved.
  Previously the default was `1`: with the default population of 50 only a
  single creature per generation received any backpropagation step (~2%
  coverage), leaving the rest to rely on slow random weight mutation. The
  default is now `max(1, round(populationSize × 0.2))` for recognised built-in
  supervised costs (`MSE`, `MAE`, `MAPE`, `MSLE`, `CROSS_ENTROPY`, `HINGE`) —
  `10` for a population of 50 — while custom / unrecognised costs keep the
  conservative default of `1`, so evolution-only tasks are unchanged. The
  per-generation training loop also now selects the fittest `trainPerGen`
  creatures from the score-sorted population (`selectTrainingCandidates`)
  instead of only the elitist slice, so raising `trainPerGen` above `elitism`
  actually increases gradient coverage. Explicit `trainPerGen` values (including
  `0` for pure evolution) always win. A new convergence benchmark
  (`bench/TrainPerGenConvergence.ts`) shows ~31% lower best error after 30
  generations at `trainPerGen=10` versus `trainPerGen=1` on a supervised task.

### Fixed

- **Issue #2746:** Incompatible (graft) crossover no longer corrupts
  forward-only offspring. When `editParentByIndex` renamed a parent's hidden
  neuron onto the other parent's UUID, the post-breed `breed:fixAliases`
  round-trip blindly restored the original UUID even when it collided with a
  UUID already present in the offspring. The collision made `loadFrom` re-point
  another neuron's synapses, turning a forward edge into a recurrent one
  (`from >= to`) and tripping the `breed:fixAliases` recurrent-synapse
  `TopologyError` (plus a downstream
  `RangeError: Maximum call stack size
  exceeded`) — the regression that forced
  NEAT-AI-Examples to pin back to 5.0.29. Alias restoration is now
  collision-aware (extracted to `src/breed/RestoreGraftAliases.ts`): an alias is
  only restored when it does not duplicate an existing UUID, otherwise the
  neuron keeps its deduplicated identity.

### Added

- **Issue #2902 (acceptance gate for #2892; builds on #2895, #2896, #2898,
  #2899, #2901):** `evolveDir(timeoutMinutes = T)` now carries a guaranteed
  upper bound on how long it can run. Once the absolute hard cap —
  `T +
  min(15, T)` minutes ("T+15") — passes, the run abandons any in-flight
  discovery, training, and replay work, keeps the best creature found so far,
  writes `creatureStore`, and returns. In practice a run configured with
  `--timeout=45` completes within the hour, leaving the caller time for its
  normal save / model check-in instead of being killed mid-write by an external
  watchdog. The external watchdog (e.g. GRQ's 3-hour `max-task-hours`) remains
  the unchanged backstop. The semantics — what each phase does at the cap and
  how the deadline propagates from `evolveDir` down to the worker clamps — are
  documented in the new [`docs/TIMEOUTS.md`](./docs/TIMEOUTS.md), and an
  end-to-end behavioural guard (`test/creature/EvolveDirHardDeadline.ts`) proves
  the bound holds in training and stubbed-discovery modes alike.
- **Issue #2787 (depends on Issue #2786):** Cost-aware `evolveDir` `targetError`
  early-stop and champion comparison. A new pure mapping helper
  `costNameToTaskDescriptor()` (`src/costs/CostDescriptor.ts`) gives every
  built-in cost a canonical descriptor (topology, range, output squash family),
  and custom JS costs collapse to the sentinel `OTHER` + neutral descriptor —
  the user's custom name is never echoed back. `evolveDir` / `evolveDataSet` /
  `evolveRL` now route their `error <= targetError` early-stop and
  `fittestScore > bestScore` champion comparison through `shouldEarlyStop()` /
  `isBetterChampion()` (`src/costs/CostAwareEarlyStop.ts`) so a `targetError` of
  `1.5` is interpreted in the cost's natural range — clamped/rejected for
  unit-range costs like `CROSS_ENTROPY`, applied directly for unbounded
  `MSE`/`MAE`, and (regression guard) passed through verbatim for `OTHER`. This
  is the caller-side counterpart to the Discovery cost-aware thresholds
  (`stSoftwareAU/neat-ai-discovery#1320`).

### Removed

- **Issue #2806 (part of Issue #2798):** Removed the `CATEGORICAL_ERROR` cost.
  Use `CROSS_ENTROPY` for multi-class training so the scorer, champion selection
  and `targetError` early-stop all reflect the classification task. Argmax /
  top-1 accuracy remains available as a reporting metric only — it is no longer
  selectable as a `costName`. As `CATEGORICAL_ERROR` was only ever in the
  unreleased changelog, no released behaviour changes.

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
