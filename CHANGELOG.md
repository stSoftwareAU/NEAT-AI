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

- **Issue #3808:** Compaction now merges redundant constant neurons. IF-squash
  tree generation left one `type:"constant"` neuron per branch, each with its
  own bias (277 of them, 263 distinct biases, in the worst production creature),
  because the constant fold cannot absorb a producer feeding an aggregate
  consumer. The new safe pass (`src/compact/ConstantMerge.ts`) re-points them at
  up to three canonical bias-1 constants with the fleet-wide well-known UUIDs
  `constant-0` … `constant-2`, moving each bias onto the outgoing weight
  (`b × w` → `1 × w·b`). The rewrite is exact — identical error — while the
  score improves as the redundant neurons are removed. Frozen constants,
  consumers and synapses are untouched.

- **Issue #3797:** New `squashBudget.fixedOutputSquash` option — pins every
  output neuron to one activation (e.g. `"TANH"` for a -1..1 bounded target).
  Output neurons are seeded with the pin, `MOD_SQUASH` and every other squash
  rewrite skip them, and an imported seed carrying a different output squash is
  normalised with a single `🔒 [loadFrom]` warning instead of silently
  diverging. Hidden neurons are unaffected, unknown names fail loud at
  configuration time, and leaving it unset keeps today's behaviour exactly.

- **Issue #3796:** New `squashBudget.squashWeights` option — a **soft** bias on
  squash selection (`{"IF": 10, "MINIMUM": 10, "MAXIMUM": 10, "*": 1}`).
  `Activations.pickRandomSquash` samples proportionally to the weights, `"*"`
  supplies the default weight for unlisted squashes and `0` excludes, so a team
  can strongly prefer a few activations without hard-excluding the rest. Weights
  apply within `allowedSquashes` when both are set; an absent or empty map keeps
  the existing behaviour exactly. Invalid budgets fail loud at config time.

- **Issue #3779:** New `skipTrainingAfterPopulationNoProgress` option — a
  run-level gate that stops dispatching training once the **whole population**
  has produced N consecutive no-progress outcomes (default `0`, opt-in). The
  per-creature `skipTrainingAfterConsecutiveRegressions` guard rarely trips,
  because a creature is trained at most once per run (#3553). One dispatch is
  still let through every 20 skips so a recovered population reopens the gate.
  Every skip now emits a `training_skipped` event, and every `evolve*` result
  carries `trainingOutcomes` (`improvements`, `regressions`, `noChange`,
  `skipped`, `regressionRate`) so a run-end summary can report skips without
  `verbose`.

### Changed

- **Issue #3873:** Synapses are keyed by `(from, to, type)`, so one source can
  feed both branches of an `IF` without an IDENTITY relay standing in as a
  second distinct source. An ordered pair may appear at most once per role, and
  **only an `IF` target** may carry more than one role from the same source —
  every other squash still has `(from, to)` uniqueness, because two roles there
  are exactly one synapse with the summed weight. Canonical sort order is the
  same triple (role rank from NEAT-AI-core's `SynapseType`). The wire format
  does not change; every previously valid creature stays valid. TypeScript
  `connect()` and `rust_scorer` now agree about `A→B positive` plus
  `A→B negative`. Pins NEAT-AI-core #577 (`validate_topology_typed`). Companion:
  NEAT-AI-core #577, NEAT-AI-scorer parity fixture, NEAT-AI-Forests graft
  cleanup.

### Fixed

- **Issue #3886:** `./quality.sh` is green again on any machine with a built
  NEAT-AI-Discovery library. The `analyzeParallel` GPU-guard stub described
  itself as structurally valid but omitted the creature's `input` / `output`
  widths behind an `as` cast, and Discovery's `CreatureJson` requires both — so
  the payload was rejected with `missing field 'input'` /
  `errorKind: "data_validation"` before GPU availability could be classified.
  The widths are back and the stub is type-annotated rather than cast. The
  production payload was never affected (`creatureToRustFormat()` always emits
  both widths) and there is no `{ input: … }` envelope on the wire; a new
  FFI-mocked test pins that flat shape so the contract is checked in CI, where
  no Discovery library exists.

- **Issue #3883:** `./quality.sh` is green again on any machine with a current
  `rust_scorer`. `test/score/RustScorerDatasetParity.ts` still carried the RMSE
  `KNOWN_DIVERGENCES` entry from Issue #3853, and those entries are asserted to
  _still_ disagree — so once both engines were fixed the guard fired exactly as
  designed. Removing the entry puts RMSE back under the ordinary
  `PARITY_REL_TOLERANCE` assertions on both topology styles, where the engines
  now agree to 1e-9 relative. The failure never reached CI because
  `resolveRustScorerBinary()` finds no binary there and the whole live lane is
  skipped.

- **Issue #3880:** `IF.fix` no longer hands a source a role it already carries,
  and no longer leaves a `(from, to)` run out of ascending role order. The pass
  types an untyped inward synapse by writing `synapse.type` in place, which both
  repeated a `(from, to, type)` triple the source already held and moved that
  row within its canonically-sorted run — the
  `duplicate synapse
  input-1216 -> …-if0` and
  `synapses not sorted … type: condition last type:
  negative` pairs the GRQ
  fleet saw on 6.6.42, from one rewrite. Assignment now prefers a role the
  source still has free; where none is, the row is summed into the row it would
  duplicate (an untyped row into an `IF` already fed the positive branch, so the
  sum is exact). The producer restores the canonical order and sums any
  duplicate before it returns (`src/architecture/CoalesceInwardSynapses.ts`), so
  the next stage never sees either — one such creature reaching the native
  scorer failed the whole batch.

- **Issue #3873 follow-up:** Leaving `IF` (via `MOD_SQUASH` / `neuron.fix()`, or
  `IF.fix` when it cannot keep the three roles) now coalesces a shared source's
  roles into one untyped synapse. Stripping `type` without merging turned a
  legal `(from, to, positive)` plus `(from, to, negative)` pair into an exact
  duplicate, which is what `evolve_SIN_function` reported as
  `duplicate synapse … -> output-0`.

- **Issue #3854:** Dataset scoring no longer off-loads to the native
  `rust_scorer` in cases it cannot reproduce. A single predicate
  (`src/score/NativeDatasetScoringEligibility.ts`) now owns the decision for
  both the per-creature (`evaluateDir`) and the once-per-generation batch
  (`Fitness.calculate`) call sites, and refuses three previously silent
  divergences: **`outputRanges`** — the quadratic out-of-range penalty (Issue
  #1620) has no native equivalent and was dropped entirely whenever the scorer
  was enabled; **`feedbackLoop` on a recurrent creature** — the native recurrent
  path resets network state per record, i.e. `feedbackLoop: false` semantics;
  and **a configured `customCost` module** on the batch path — `costName` keeps
  its `"MSE"` default in that case (Issue #3776), so the batch scorer was handed
  `--cost MSE` while the workers evaluated the user's cost, breaking the
  documented "custom costs are never off-loaded" promise. New
  `test/score/RustScorerDatasetParity.ts` runs the real binary against the
  TypeScript path over the same dataset for all seven built-in costs × two
  topology styles — the first test anywhere that compares the two engines'
  actual numbers. Its `KNOWN_DIVERGENCES` map records any cost the two engines
  are known to disagree on and asserts each entry still reproduces, so an entry
  cannot go stale (Issue #3883); the map is empty today, meaning every built-in
  cost — RMSE included — is covered by the ordinary parity assertions.

- **Issue #3853:** `RMSE` scoring is now the root of the mean squared error on
  both engines. `evaluateDir` accumulated `RMSE.calculate` per record and
  divided by the record count, reporting `mean(sqrt(e))`, while the native
  `rust_scorer` roots the shared MSE sum once at finalisation and reports
  `sqrt(mean(e))` — so the number a caller got depended on whether
  `NEAT_AI_RUST_SCORER_ENABLED` was set. The TypeScript path now accumulates
  MSE's squared-error sum and roots once at finalisation
  (`src/costs/CostAggregation.ts`), which also lets RMSE ride MSE's fused WASM
  batch kernel. Output-range penalties are accumulated separately and added in
  error units after the root, unchanged for every mean-style cost.
  **Consumer-visible:** reported RMSE magnitudes rise on the TypeScript path
  (the two aggregations differ by a few percent on real data), so GRQ scores
  computed with `costName: "RMSE"` will move. New
  `test/score/RustScorerLiveCostParity.ts` runs the real `rust_scorer` binary
  against `evaluateDir` over one dataset for all seven built-in costs on
  forward-only and recurrent creatures, so a future divergence fails a test
  instead of hiding.

- **Issue #3851:** The Creature Factory no longer emits an `IF` hidden neuron
  without its `condition` / `positive` / `negative` role edges. When
  `hiddenSquash` selects `IF` (e.g. a caller's activation allow-list forces it),
  `creatureForProblem` / `creatureForDataset` now wire the roles themselves — a
  deterministic round-robin over each neuron's inward synapses ordered by source
  — so the seed passes `validate()` with no repair pass. A seed too narrow to
  carry `IF` (fewer than three sources per neuron) throws a `TopologyError`
  (`reason: "INVALID_SQUASH"`) naming the squash and the spec field that chose
  it, instead of emitting a node that only survives because a downstream `fix()`
  invents its wiring.

- **GRQ #4241:** A failed discovery temp-dir removal is no longer reported as a
  clean cleanup. `DiscoverStructureBase.cleanUp()` swallowed the removal error
  into one warn line and resolved, so
  `Failed to cleanup discovery temp dir:
  Directory not empty (os error 66)`
  was followed immediately by `Discovery <id> cleanup complete.` and the leaked
  directories accumulated under `.discovery/` until the host ran out of disk.
  The removal now lives in `src/discovery/DiscoveryTempDirRemoval.ts`: it
  retries the recursive remove (the failure is a race with a writer still
  creating files), positively confirms the directory is gone, and otherwise
  throws an error naming the leftover entries so the writer can be found.
  `DataRecorder.runCleanup()` logs
  `❌ CRITICAL: … cleanup failed - potential resource leak` on both the awaited
  and the fire-and-forget path and never logs a completion line for a cleanup
  that failed.

- **Issue #3844:** `restoreSource` no longer hands back a creature whose
  `memetic` record names structure the creature does not have. The restore is a
  structural change — it re-adds synapses the record names but the live creature
  had lost — and the whole record rides along onto the restored creature. Its
  two restore loops bail out the moment a _top-level_ key fails to resolve, but
  nothing checked `ancestry[]`, and `memeticUpdate` propagates that subtree to
  offspring by reference without ever touching it, so an ancestor snapshot
  routinely outlives the neurons it was keyed to. A stale key of that kind is
  not harmless: a runtime integer is copied through import as "already a numeric
  key" and written to the wire verbatim, where the Rust reader fails loud on a
  neuron uuid the creature does not carry. `restoreSource` now runs the existing
  `pruneOrphanMemeticReferences` helper over the restored creature, dropping
  only the keys that resolve to nothing — ancestry included — and keeping the
  surviving neurons' fine-tuning deltas, which is the history the function
  exists to carry forward.

- **Issue #3840:** The "exact, behaviour-preserving" structural passes no longer
  lower a creature's score, and the guarantee is enforced rather than asserted
  in a doc comment. On a grafted `IF` forest — decision-tree patches whose
  thresholds and leaf values ride as weights on three bias-1 constants shared
  across every patch — `compactCreature` cost 0.0244 of score, `simplify` cost
  0.0422 and a `removeLowImpactNeuron` advertised at `impact: 0.00%` cost
  0.1676. Five defects: the compaction chain fold dropped the `IF` role
  (`condition`/`positive`/`negative`) from the merged synapse, so `fix()`
  re-invented it at random; the same fold was inexact even without `IF` — it
  folded `LOGISTIC` relays (not an identity: a two-LOGISTIC chain moved from
  0.512 to 0.211) and wrote the removed neuron's bias back onto the neuron it
  was about to delete, dropping the `w_out · b` term; `Simplify.removeKnownSign`
  spliced out an `ABSOLUTE`/`ReLU` neuron feeding an `IF` condition and the
  bypass edge carried no role; discovery removal deleted a shared bias-1
  constant that a contribution-based impact metric reads as 0.00% while it backs
  the routing of every grafted node; and `CreatureUtil.getTopologyHash` omitted
  the synapse role, so two creatures differing only in which branch an edge
  feeds shared a WASM compilation-cache entry and the second was activated with
  the first's routing. Each fold is now role-aware, the topology hash includes
  the role (appended only when present, so creatures with no typed synapse hash
  unchanged), and `buildSafeCompact`, `simplify` and the discovery removals
  verify behaviour over a deterministic probe matrix (`BehaviourGuard`) — gated
  on the creature carrying role-typed `IF` edges, so nothing else pays an
  activation — rejecting the candidate and logging the pass, creature and
  deviation when behaviour moved. **Behaviour change for creatures without
  `IF`:** `LOGISTIC → LOGISTIC` single-in/single-out chains are no longer folded
  (they were folded incorrectly), and an `IDENTITY` chain fold now moves the
  removed neuron's bias onto the consumer instead of dropping it.

- **Issue #3823:** The over-run finish-up path no longer spins, flooding the log
  with `Waiting for additional generation`. `additionalGenerationCount` ("do at
  least one more loop") was only decremented by `evolve()`, but the over-run
  guard added in #3795 stops starting generations and re-enters `finishUp()`
  directly — so the counter never cleared, `awaitInFlightTasks()` returned
  immediately (nothing was in flight) and the loop ran flat out until the hard
  deadline, up to the full 15-minute grace window. `finishUp()` now drains the
  counter in its wait branch (as the neighbouring `cleanUpDelayCount` branch
  already did), and the over-run stop clears it outright.

- **GRQ #4238:** The `[WasmWorkerInit]` timeout diagnostic no longer bills the
  parent's own stall to the child. `handshakeMs` was a raw elapsed-time read
  taken inside the timeout callback, so a blocked parent event loop fired the
  timer late and the overshoot was reported as handshake time — a GRQ-13 run
  logged `handshakeMs=895250` against a 60s deadline. The window is now split
  into `handshakeMs` (capped at the deadline), `parentStallMs` (how late the
  callback fired), `loopBlockedMs` (longest block sampled _inside_ the window by
  a new parent watchdog) and `spawnToInitMs`. Because a blocked parent cannot
  receive the child's start heartbeat either, `heartbeat=none` is now only read
  as "the child never reached its entry point" when the parent stayed
  responsive; otherwise the line says the parent was blind. The init timeout and
  watchdog timers are also cleared when the init-error promise wins the race,
  which previously left the timeout pending.

- **Issue #3827:** An Intelligent Design squash substitution can no longer
  produce a creature this library's own validator refuses. A substitution
  changes only `squash`, so it cannot give a neuron the three inward connections
  — nor the `condition` / `positive` / `negative` synapse roles — that
  `CreatureValidate` demands of an `IF` neuron; handing `IF` to an ineligible
  neuron killed the ID worker on
  `ValidationError: 'IF' should have at least 3 inward connections
  was: 2`
  before it scored anything. The new
  `src/intelligentDesign/SquashSubstitutionEligibility.ts` gate makes
  `scanForSquashImprovements` skip those (neuron, squash) pairs with a logged
  reason and keep scanning, and `makeModifiedCreatureWithPrevious` /
  `makeModifiedCreature` refuse such a substitution outright. `IF` stays in the
  substitution table for the neurons that can carry it.

- **Issue #3779:** A training result inside the evaluate noise floor (the `🫥`
  outcome) no longer counts as an improvement, so it stops resetting the
  no-progress streaks.

- **Issue #3776:** Scheduled per-generation training now runs two epochs instead
  of one, so the training loop can revert an epoch that made the creature worse.
  A configured `customCost` now keeps the evolution-only `trainPerGen` default
  of `1` rather than inheriting the MSE-shaped ~20%-of-population default from
  the untouched `costName`.

### Changed

- **Issue #3803:** `creatureValidate` now calls NEAT-AI-core's
  `creature_validate` instead of running its own copy of the rules, so NEAT-AI
  and its sibling consumers read one set of validation rules rather than four
  ports of them. The exported signature, the `stats` return value and every
  thrown error class, `reason` and message are unchanged — the #3801 conformance
  corpus is replayed against the new path. What stays in TypeScript is the
  host-only half from #3802 (`neuron.validate()`, `neuron.index`,
  `neuron.creature`), marshalling, failure rehydration and the `DEBUG`
  diagnostics dump. There is **no fallback**: an unloadable bundle throws a
  `WasmError` carrying the loader's own failure, so a creature is never treated
  as valid because validation could not run.

- The vendored `wasm_activation/pkg` bundle advances from NEAT-AI-core `4db5b9b`
  (0.9.11) to `2ba8437` (0.10.1), picking up five upstream commits:
  - **GRQ #4261** (core #571) — creature weights now parse to the exact `f64`
    the JSON literal names, instead of the nearest value a lossy intermediate
    produced. This is the only change of the five with numeric reach into
    NEAT-AI.
  - **NEAT-AI #3812** (core #570) — the empty memetic weight array and the
    ancestry snapshot are pinned by test.
  - **GRQ #4257** (core #569) — `memetic.weights` parses and validates in both
    valid wire forms.
  - **Issue #555 / #562** (core #568) — `if_graft` emits creatures the shared
    validator accepts.
  - **NEAT-AI #3803** (core #567) — `creature_validate` accepts the runtime
    creature shape, so a host's defect reaches the rules.

  No NEAT-AI source change is required: the bundle is consumed through the
  existing WASM boundary and no exported signature moved.

- **GRQ #4141:** Training over-run is now enforced, not warn-only. When elapsed
  wall-clock exceeds `timeoutMinutes` by the configured factor (default `1`),
  the evolve loop stops starting new generations and finishes cleanly with the
  evolved population committed — well before GRQ's 3-hour wall-clock cap. The
  hard-deadline watchdog names an in-flight fitness stall _while it is
  happening_ and interrupts it; `abandoning 0 in-flight task(s)` after the fact
  is no longer the only signal. Discovery remaining budget honours
  `GRQ_TASK_DEADLINE_EPOCH` / `GRQ_TASK_MAX_SECONDS` when set; unset env is
  unchanged.
- **GRQ #4138:** `memory.nativeBudgetBytes` is forwarded into the Discovery
  `analyze_parallel` FFI budget (`maxAnalysisMemoryMb` / Rust `budget_mb`) and
  clamped to host-reported memory so a 5.47 GB budget on a 3.4 GB host cannot be
  trusted verbatim.

## [7.0.0] - 2026-08-26

### Removed

- **Issue #3874:** Retired three off-by-default experimental options that no
  consumer ever set — `crossValidation` (#1865), `dataFuzzing` (#1900) and
  `dataQuantisation` (#1901). Each was gated behind its own `enabled` flag and a
  fresh usage audit found zero adopters, so the default path was already
  byte-identical to the feature not existing. #1943 closed the same three as
  `NOT_PLANNED`. Removed the option surfaces (`NeatOptions`, its `CoerceNumeric`
  mirror, both `keyof` unions, the `NeatArguments` fields, the `TrainOptions`
  fields), the parsers (`parseCrossValidation`, `parseDataFuzzing`,
  `parseDataQuantisation` with their re-exports and
  `src/config/parsers/DataParsers.ts`), the config modules
  (`CrossValidationConfig.ts`, `DataFuzzingConfig.ts`,
  `DataQuantisationConfig.ts`), the implementations
  (`CrossValidationTrainer.ts`, `KFoldSplitter.ts`, `DataFuzzing.ts`,
  `DataQuantisation.ts`, `applyDataAugmentation` and `trainDirSingleFold`), the
  training gates in `Training.ts`, `TrainingSetup.ts`, `TrainingEpoch.ts`,
  `PredictiveCodingTrainer.ts`, `NeatScheduling.ts` and the three Rust-trainer
  skip reasons in `RustTrainDirBridge.ts`, plus the public docs. **Breaking for
  embedders:** `DataFuzzingConfig`, `RequiredDataFuzzingConfig` and
  `DEFAULT_DATA_FUZZING_CONFIG` are no longer exported from `mod.ts`, and
  setting any of the three keys is now a type error. No call-site change is
  expected — the default path is unchanged.

## [6.6.0] - 2026-08-16

### Added

- **Issue #3765:** Eligible `trainDir` prefers in-process Deno FFI
  (`libneat_ai_backpropagation`, sibling NEAT-AI-Backpropagation #84) over
  spawning the CLI. Resolve via `NEAT_AI_BACKPROP_LIB_PATH` or well-known
  `target/release` paths. CLI spawn remains a fallback when the cdylib is
  absent; `./quality.sh --next` sets `NEAT_AI_BACKPROP_REQUIRE_FFI=1` and fails
  if the library cannot load. Random `trainingSampleRate` and `traceStore` are
  forwarded (Backpropagation #77 / #78).

### Changed

- Document which `TrainOptions` the Rust `trainDir` path honours (FFI and CLI).
  `hardDeadlineTS` / `targetError` remain TypeScript-only until wired through
  the ABI.
- Merge Develop's 6.5.0 package-version floor and no-downgrade gate while
  retaining the FFI-first `trainDir` path.

## [6.5.0] - 2026-08-16

### Changed

- **Package version floor restored to 6.5.0** after a merge conflict briefly
  regressed `deno.json` below the earlier 6.4.0 line. A quality-gate test and
  the update-package-version workflow now refuse any PR whose version sits
  behind `origin/Develop`.

## [6.4.0] - 2026-08-15

### Changed

- Eligible `trainDir` now defaults to sibling `neat_ai_backpropagation`
  (production-scale creature + corpus slice: rust matched WASM quality and was
  ~10× faster). Set `NEAT_AI_BACKPROP_ENABLED=0` to force the TypeScript / WASM
  loop. `./quality.sh` without `--next` still sets `=0` so that path stays
  covered; `--next` sets `=1` and requires the binary.

### Removed

- On-Policy Distillation (`opd`), Knowledge Distillation
  (`KnowledgeDistillationStrategy`), and the Specialist Pipeline
  (`SpecialistPipeline` / `SpecialistConfig`). Default-off experiments that no
  public embedder wired into the score/hour path; removed to keep that path
  simple. Memetic `trainDir`, Discovery, and Muon remain. **Breaking for
  embedders:** those symbols and `NeatOptions.opd` are no longer exported.

### Added

- `./quality.sh` records in-flight `Deno.test` names under `.quality-in-flight`
  (override with `NEAT_AI_IN_FLIGHT_DIR`). `deno test --parallel` only prints a
  file when it finishes, so a jetsam SIGKILL used to leave evolution spam and no
  test name. Leftover files after the runner stops name the cases that were
  still running.
- **Issue #3741:** Eligible `trainDir` uses the Rust app
  (`neat_ai_backpropagation`) by default. Per-sample WASM `propagateTopological`
  remains for in-process callers. Options that are not backpropagation (custom
  cost, dropout, fuzzing, quantisation, Muon, predictive coding,
  cross-validation, recurrent / `feedbackLoop`) stay on the TypeScript loop —
  Rust is not called with those options. `trainingSampleRate` is forwarded as
  `--max-records`. A missing binary is an error when Rust is enabled. Override
  with `NEAT_AI_BACKPROP_BINARY_PATH`; apply step scale with
  `NEAT_AI_BACKPROP_STEP_SCALE` (default `0.01`). Set
  `NEAT_AI_BACKPROP_ENABLED=0` to force the TypeScript / WASM loop.
  `./quality.sh --next` builds the sibling binary and sets `=1`. The in-process
  `libneat_core` C ABI is a separate path
  (`./quality.sh --native-core-backprop`) and is not what `--next` enables.
- Coverage CI (`coverage.yaml`) is the PR test gate: the merge job fails the
  pull request when any shard reports test failures or crashes. `quality.yml`
  still does not run tests (fmt/lint/`deno check` only).
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

- `./quality.sh` now runs the test suite with the Rust `rust_scorer` enabled by
  default. Pass `--wasm-scorer` for a comparison run on the legacy WASM scorer.
  The gate fails loud if `rust_scorer` cannot be resolved (no silent WASM
  fallback). Test runs force `NEAT_SCORER_GPU=off` so parallel `rust_scorer`
  processes do not create Metal/wgpu contexts (the default `--gpu auto` path
  OOMs the suite). `./quality.sh --wasm-scorer` forces native backprop off and
  sizes `DENO_JOBS` from host RAM and keeps an 8192 MB V8 heap (1 × 8192 MB on a
  24 GB laptop). Capping the heap at 4096 MB makes V8 abort evolve tests
  (`Ineffective mark-compacts near heap limit`, SIGTRAP 133) while RSS is still
  only ~5.7 GB. `./quality.sh --next` fails if `neat_ai_backpropagation` cannot
  be resolved; `./quality.sh --native-core-backprop` fails if `libneat_core`
  cannot be loaded.
- **Issue #3674:** `deno.json` now declares the `Apache-2.0` SPDX identifier and
  lists `LICENSE` in `publish.include`, so the published package carries its
  licence text and metadata explicitly instead of relying on whatever
  `deno publish` auto-includes.
- **Issue #3427:** The `requestedOptions` echo (Issue #3422) no longer records
  non-serialisable options with a `"[function]"` / `"[unserialisable]"` marker —
  such entries are now dropped entirely, since the markers carry no tuning value
  and are pure noise in every production snapshot. The one exception is
  `creatures`: instead of dropping the seed-creature array it is echoed as its
  **count** (a number, e.g. `"creatures": 12`; an empty seed array echoes as
  `0`), because seed size can matter when comparing runs. The
  `OPTION_FUNCTION_MARKER` / `OPTION_UNSERIALISABLE_MARKER` exports are removed.

### Fixed

- `NEAT_AI_BACKPROP_ENABLED` keeps default-on semantics for unrecognised values
  (`on`, `enabled`, …). Only an explicit off (`0` / `false` / `no`) forces the
  TypeScript / WASM `trainDir` loop; a stray affirmative no longer silently
  disables Rust training.
- `./quality.sh` native backprop opt-in is CLI-only (`--next`,
  `--native-core-backprop`). Leftover `NEAT_AI_BACKPROP_ENABLED=1` /
  `NEAT_AI_NATIVE_CORE_BACKPROP=1` exports no longer trigger a cargo build that
  the test suite then discarded by forcing both flags to `0`.
- `evaluateDir` honours a vanished file in a cached list when `rust_scorer` is
  enabled. The native binary scores the directory itself and was silently
  dropping missing paths that the WASM path reported as `DatasetError`
  `FILE_MISSING`. The file list is now checked on both backends before scoring.
- Nested `quality.sh` behaviour tests no longer inherit native backprop from
  leftover env; pass `--next` or `--native-core-backprop` to opt in.
- Worker evaluate failures no longer dump the creature and full request payload
  into `.diagnostics/` on every miss. That catch ran on operational errors
  (empty dataset, WASM trap, corrupt creature) across every worker retry and
  filled the directory with hundreds of thousands of `evaluate-*` files. The
  error is still logged and rethrown; producer-gate dumps (`offspring-` /
  `mutator-` compile traps) are unchanged.
- Training no longer treats ~1e-9 evaluate noise as a memetic regression.
  Fitness error (from `evaluateDir`) and the training loop's `bestError` can
  disagree at f32 ulp on small datasets; the old `train.error > fitnessError`
  test plus Issue #2382 skip-after-two-regressions then turned off training, so
  `evolve_AND_gate` could sit at error ~0.07 for tens of thousands of
  generations until `quality.sh --trace-leaks` jetsammed the host.
- `quality.sh` no longer defaults to four 8 GB `deno test` workers. It keeps the
  8 GB heap each evolve test needs and sizes `DENO_JOBS` from host RAM (12 GiB
  reserved for the OS/editor), so a 24 GB laptop is 1 × 8192 MB instead of a 32
  GB request that jetsams mid-suite. `--trace-leaks` is off by default on hosts
  with less than 32 GiB — it retains every allocation until each test ends,
  which jetsammed `evolve-MT` on a 24 GB Mac even with a single worker. Force it
  with `QUALITY_TRACE_LEAKS=1`. Per-iteration "training made the error worse"
  warnings are now logged on the first failure and every 100th afterwards, so a
  stuck 10 000-iteration train no longer floods the quality-gate log.
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

- **Issue #3569:** Removed per-creature evolvable hyperparameters (#3505 audit,
  slice F). The feature (Issue #1863) was fully implemented and tested, but
  `hyperparameterEvolution.enabled` defaulted to `false` and no consumer ever
  turned it on, so `Mutator` never created a hyperparameter block, no creature
  ever carried a `hyperparameters` genome field, and the `Offspring` crossover
  and carry-through branches were both unreachable. Removed the 13-field option
  surface (`NeatOptions.hyperparameterEvolution`, its `CoerceNumeric` mirror,
  both `keyof` unions, the `NeatArguments` field, the `NeatConfig` wiring, and
  `parseHyperparameterEvolution` with its re-export), the `hyperparameters`
  genome field and its export/import/clone plumbing, the `hyperparameters` entry
  in `docs/snapshot-schema.json`, and the `hyperparameterEvolution` row from the
  `bench/EvolutionPaceLeverComparison.ts` lever matrix.
  `computeSpeciesDiversity` — the one live consumer of the removed module —
  moved to `src/NEAT/SpeciesDiversity.ts`; adaptive population sizing is
  unchanged. **Breaking for embedders:** `NeatOptions.hyperparameterEvolution`
  is now a `deno check` error, and `EvolvableHyperparameters`,
  `HyperparameterEvolutionConfig`, `RequiredEvolvableHyperparameters`,
  `RequiredHyperparameterEvolutionConfig`, `DEFAULT_EVOLVABLE_HYPERPARAMETERS`
  and `DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG` are no longer exported. Existing
  creature JSON that carries a `hyperparameters` field still loads — the field
  is ignored and dropped on the next export.
- **Issue #3568:** Removed the `specialist` option surface (#3505 audit, slice
  F). The key was declared on `NeatOptions`, parsed by `parseSpecialist` and
  stored on `NeatArguments`, but never read — neither `Neat` nor `NeatEvolution`
  ever constructed a `SpecialistPipeline` from it, so
  `specialist: { mode: "auto", … }` was inert at every value, not just at its
  `"off"` default. **The feature itself is unchanged:** `SpecialistPipeline`,
  `SpecialistConfig`, `RequiredSpecialistConfig`, `SpecialistMode` and
  `DEFAULT_SPECIALIST_CONFIG` are still exported, and the pipeline still takes
  its own `Partial<RequiredSpecialistConfig>` constructor argument. **Breaking
  for embedders that set it:** `NeatOptions.specialist` is now a `deno check`
  error, and `parseSpecialist` is no longer exported — construct
  `SpecialistPipeline` directly instead.
- **Issue #3554:** Retired the `dnaSharingMode` knob preset and
  `KnobTuningStrategy` (#3505 audit, slice A). No consumer set the option, and
  its `"default"` preset was defined to equal the per-knob defaults
  `createNeatConfig()` already applied, so the whole preset layer was inert;
  those defaults are now inline literals and are unchanged. The only non-default
  value, `"aggressive"`, measured **zero lift** in the #2496 bake-off.
  **Breaking for embedders that set it:** `dnaSharingMode` is now a `deno check`
  error, and `KnobTuningStrategy`, `KNOB_TUNING_TAG_NAME`,
  `readDnaSharingModeTag`, `getDnaSharingPreset`, `DEFAULT_DNA_SHARING_PRESET`,
  `AGGRESSIVE_DNA_SHARING_PRESET`, `DnaSharingMode` and `DnaSharingPresetValues`
  are no longer exported. Set `diversityBreedingRate`,
  `interSpeciesCrossoverThreshold`, `geneticCompatibilityThreshold` and
  `compatibilityGating.*` directly instead.
- **Issue #3552:** Removed the unused `maxConns` and `maximumNumberOfNodes`
  growth-cap options (#3505 audit, slice A). No consumer set either key and both
  defaulted to `Number.MAX_SAFE_INTEGER`, so the two `Mutator`
  mutation-candidate guards they fed were inert in every production run — the
  `ADD_CONN` guard could never fire and the `ADD_NODE` guard was always true.
  **Breaking for embedders that set them:** setting either key is now a
  `deno check` error, and there is no config cap on neuron or synapse count.
  `ADD_CONN` is still bounded by the structural `maxSynapses` ceiling, and
  `costOfGrowth` remains the lever for discouraging topology growth.
- **Issue #3556:** Removed the unused `discoveryReplayDiagnostics` option and
  the replay timing payload it gated (#3505 audit, slice B). No consumer set it
  and it defaulted to `false`, so every `performance.now()` site in
  `DiscoveryReplayRunner` short-circuited and `result.diagnostics` was never
  assigned. **Breaking for embedders that opted in:** the
  `DiscoveryReplayDiagnostics` type and the optional `diagnostics` field on
  `DiscoveryReplayDirResult` are gone, so `Creature.discoveryReplayDir()` no
  longer reports per-phase timings.
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
- **Issue #3559:** Removed the `novelty` (behavioural-diversity) selection
  option and its six fields (#3505 audit, slice C). Unlike the other slice-C
  removals this was a **working, benchmarked, documented feature** — the
  keep-or-remove decision was resolved as remove because no consumer ever
  adopted it in the seven weeks since #2932 delivered it, and an opt-in lever
  nobody sets still costs type surface, documentation and maintenance on every
  config change. `DEFAULT_NOVELTY_CONFIG.enabled` was `false` and the feature
  additionally required a problem-supplied behaviour descriptor, so ranking
  already used raw fitness in every production run and **behaviour is
  unchanged**. **Breaking for embedders that opted in:** setting `novelty` is
  now a `deno check` error. `src/config/NoveltyConfig.ts`,
  `src/NEAT/NoveltySearch.ts` (engine, archive and `blendScores`), the
  `noveltySearch` argument threaded through `Neat` into `Breed`,
  `bench/NoveltyDeceptiveEscape.ts` and `docs/NOVELTY_SEARCH.md` are all gone.
  The unrelated `noveltyEscalationActive` Discovery drought signal (#3072) is
  untouched.
- **Issue #3562:** Removed the `stabilityAdaptation` option and its ten fields
  (#3505 audit, slice D). Like its slice-C sibling `ensembleDiversity`, it was
  parsed into `NeatArguments` but never read by any code path — no
  `StabilityAdaptation*` implementation module ever existed — so setting
  `enabled: true` changed nothing. Neither GRQ nor NEAT-AI-Examples set it. The
  option surface (`src/config/StabilityAdaptationConfig.ts`, the `NeatArguments`
  / `NeatOptions` entries), the `parseStabilityAdaptation` parser, the
  `LARGE_NETWORK_PRESET` block that advertised "adapt mutation to stability",
  and the documentation and troubleshooting advice describing it as a working
  lever are all gone.
- **Issue #3566:** Removed `parallelEvaluation.maxConcurrentEvaluations` (#3505
  audit, slice E). It defaulted to `0`, and `0` made the only branch reading it
  a no-op, so evaluation already ran on every supplied worker — the removal is
  **behaviour-preserving**. Its purpose (reserving workers for training and
  discovery) was superseded by the #2245 fast/heavy worker-pool split, which
  hands evaluation only fast-pool workers; size the heavy pool with
  `heavyTaskWorkerCount` instead. **Breaking for embedders that set it:**
  passing `parallelEvaluation.maxConcurrentEvaluations` is now a `deno check`
  error. `parallelEvaluation.topologyGrouping` and the parent
  `parallelEvaluation` key are untouched.

### Security

- **Issue #3672 (CWE-1284, improper validation of a quantity used as a loop
  bound):** `Creature.fromJSON` / `loadFrom` now validate the `input` and
  `output` counts **before** the input-neuron allocation loop runs. `json.input`
  bounded that loop straight from the file, and the `creatureValidate` check
  that would have rejected a bad count ran only at the _end_ of the load — so
  `"input": -1` looped forever (`while (i--)` tests before decrementing, so it
  ran away from zero, allocating a `Neuron` and two Map entries per iteration
  and never returning control to the caller), and `"input": 100000000` requested
  a hundred million neurons before any check fired. Each count must now be an
  integer in `[1, MAX_NEURON_COUNT]` (1,000,000 — the hidden/constant neuron id
  floor in `NeuronId.ts`, above which input ids would collide) or loading throws
  `ValidationError` (`reason: "OTHER"`). The loop itself is now an explicit
  `for (let i = json.input - 1; i >= 0; i--)`.
- **Issue #3671 (CWE-20, improper input validation):** `Creature.fromJSON` /
  `loadFrom` now validate a synapse's resolved `from` / `to` endpoint. When
  neither `fromUUID`/`toUUID` nor `fromId`/`toId` resolved, the loader fell
  through to the raw parsed value with a bare `as SynapseInternal` assertion
  (erased at runtime) — no type check and no bounds check — and that value is
  template-interpolated into `new Function()` bodies by the activation compilers
  (`activations[${from}] * ${weight}` in `NeuronActivation.ts`). It completes
  the `bias` / `weight` hardening from Issue #2704: `from` and `to` were the
  remaining two interpolated values without a guard. Each endpoint must now be
  an integer in `[0, neuronCount)` or loading throws `TopologyError`
  (`INVALID_SYNAPSE_REFERENCE`, a new `TopologyErrorReason`). This also closes a
  missing bounds check — an out-of-range index previously surfaced downstream as
  a bare `TypeError` from `creatureValidate` rather than a typed error. Not
  exploitable as shipped (every production activation path routes through WASM,
  so the compiled function is never invoked), but the sink is one refactor away
  from being live.
- **Issue #3670 (CWE-22, path traversal):** `Creature.fromJSON` / `loadFrom` now
  validate the creature `uuid` taken from untrusted model JSON. The value was
  previously copied out with a bare `as CreatureInternal` assertion (erased at
  runtime), never recomputed — `CreatureUtil.makeUUID` short-circuits on any
  truthy existing value — and then concatenated into filesystem paths, one of
  which is deleted with `Deno.remove(..., { recursive: true })`. A shared
  checkpoint carrying `"uuid": "../../.."` could therefore delete a directory
  outside the discovery base. A present `uuid` must now match the canonical
  8-4-4-4-12 hexadecimal UUID layout or loading throws `ValidationError`
  (`reason: "OTHER"`); an absent `uuid` is unchanged, since `exportJSON()` omits
  it by design. Validating at the deserialisation boundary closes the discovery
  temp-directory, trace-store, failed-training-dump, and score-file sinks at
  once. As defence in depth, `DiscoverStructure` also asserts its temp directory
  resolves inside its base directory before creating or removing it. **Breaking
  only for callers that persisted a non-UUID creature `uuid`.**
- **Issue #3680 (CWE-353, missing integrity check):** WASM activation bundle
  bytes are now verified against a pinned SHA-256 **at runtime**, not only at
  build time. `deno.json` `neatCore.assetSha256` pins the release _tarball_ and
  is checked by `build.sh` alone, so bytes read back from the
  environment-controlled disk cache (`NEAT_AI_WASM_CACHE_DIR` / `XDG_CACHE_HOME`
  / `$HOME/.cache/neat-ai/wasm`) were instantiated unchecked — anyone able to
  write there could plant a `<key>.wasm` file that ran on the next start.
  `./build.sh` now also generates `src/wasm/WasmBundleSha256.ts`, whose
  `EXPECTED_WASM_BUNDLE_SHA256` constant travels with the published package, and
  `WasmBundleCache` compares it on both the cache-hit and post-fetch paths: a
  poisoned cache entry is logged, deleted, and re-fetched, while substituted
  network bytes are a hard error that is never cached or instantiated. The local
  (`file:`) build path is unchanged.

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
