# Discovery Pipeline Internal Architecture

This document describes the internal architecture of the discovery pipeline —
how modules interconnect, the two-phase evaluation strategy, cache architecture,
and candidate lifecycle. For user-facing configuration and distributed setup
guidance, see [DISCOVERY_GUIDE.md](DISCOVERY_GUIDE.md) and
[DiscoveryDir.md](DiscoveryDir.md).

## Pipeline Overview

The discovery pipeline is a **two-phase, cache-aware structural evolution
system** that proposes, filters, evaluates, and caches candidate improvements to
neural network topology. Each iteration targets small incremental gains
(typically 0.5–3%) that compound over repeated runs.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Discovery Pipeline                           │
│                                                                     │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────────────┐ │
│  │   Rust FFI   │───▶│  Candidate   │───▶│      Phase 1            │ │
│  │  Recording   │    │  Creation    │    │  Single Evaluation      │ │
│  │  & Analysis  │    │  & Filtering │    │  (parallel via workers) │ │
│  └─────────────┘    └──────────────┘    └──────────┬──────────────┘ │
│                                                     │                │
│                           ┌─────────────────────────▼──────────┐    │
│                           │           Caching                   │    │
│                           │  Success Cache ◀──▶ Failure Cache   │    │
│                           └─────────────────────────┬──────────┘    │
│                                                     │                │
│                                          ┌──────────▼──────────┐    │
│                                          │      Phase 2         │    │
│                                          │  Combined Evaluation │    │
│                                          │  (from Phase 1 wins) │    │
│                                          └──────────┬──────────┘    │
│                                                     │                │
│                                          ┌──────────▼──────────┐    │
│                                          │   Best Improvement   │    │
│                                          │   Selection          │    │
│                                          └─────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

## Two-Phase Evaluation Strategy

### Phase 1: Single Candidate Evaluation

Phase 1 evaluates individual structural changes proposed by the Rust analysis
engine. Each candidate represents a single atomic modification to the creature.

**Data flow:**

1. **Rust FFI recording** — Training data is recorded to Parquet via the Rust
   library (`recordDiscovery()`), capturing neuron activations and errors.
2. **Rust FFI analysis** — GPU-accelerated parallel analysis
   (`analyzeParallel()`) produces a `DiscoverResult` containing:
   - Synapse addition suggestions with expected score gains
   - Neuron addition suggestions with expected score gains
   - Squash (activation function) change suggestions
   - Coordinated structural candidates (epistatic multi-operation groups)
   - Low-impact neuron removal candidates
   - Harmful neuron/synapse removal candidates
3. **Candidate building** — `buildDiscoveryCandidates()` constructs concrete
   candidate creatures from each suggestion. Each candidate applies one change
   to the base creature.
4. **Failure cache filtering** — Candidates matching previously failed keys are
   removed before consuming evaluation slots.
5. **Category diversity** — Minimum slots are reserved per change type
   (add-neurons, add-synapses, change-squash, remove-low-impact) to ensure
   breadth of exploration.
6. **Weighted sampling** — Remaining slots are filled via roulette-wheel
   selection weighted by expected improvement.
7. **Parallel evaluation** — Filtered candidates are scored in parallel across
   worker threads. The original creature is also re-scored for baseline
   comparison.
8. **Result caching** — Successful candidates (score > original) go to the
   success cache; failures go to the failure cache.

### Phase 2: Combined Candidate Evaluation

Phase 2 builds multi-step combinations from Phase 1 successes, targeting
**epistatic improvements** — cases where individual changes are marginal but
combinations are powerful.

**Entry threshold:** Phase 2 requires at least **1 successful single** from
Phase 1. This threshold was lowered from 2 in enhancement #1734 to capture more
combination opportunities.

**Supplementation:** When Phase 1 produces only 1 success, the pipeline
supplements with up to 5 historical successes from the success cache
(`supplementFromCache()`). Supplemented entries are filtered for relevance to
the current creature and checked against already-applied changes.

**Combination strategies:**

| Strategy        | Description                              |
| --------------- | ---------------------------------------- |
| All successful  | Every Phase 1 success applied together   |
| All removal     | Only removal candidates combined         |
| All non-removal | Only additive/squash candidates combined |
| Pairwise        | Every pair of successful candidates      |
| Triple          | Every triple (when pool is large enough) |

**Exclusion rule:** Coordinated-structural candidates are never combined with
other candidates — they are already epistatic groups designed to be applied
atomically.

After building, Phase 2 candidates pass through the same filtering and
evaluation pipeline as Phase 1. Results are cached identically.

### Final Selection

All Phase 1 and Phase 2 improvements are pooled, sorted by score (descending),
and the best is returned as the primary improvement. Remaining improvements are
available as `additionalImprovements`.

## Module Dependency Map

### `src/discovery/` — Pipeline Orchestration (37 files)

```
DiscoveryRunner.ts                    ← Main orchestrator (entry point: discoverDir)
├── DiscoveryRunnerTypes.ts           ← Pipeline I/O types
├── DiscoveryRunnerEvaluation.ts      ← Batch evaluation + cache recording
│
├── DiscoveryCandidates.ts            ← Candidate building coordinator
│   ├── CandidateCreation.ts          ← Single-step candidate builders
│   │   └── CandidateApplicationOps.ts ← Low-level structural operations
│   ├── CombinedCandidates.ts         ← Multi-step combination builders
│   │   └── CombinedCandidateBuilders.ts ← Per-category combination logic
│   ├── CombinedFromSuccessful.ts     ← Phase 2 combination orchestrator
│   ├── CacheInformedRemovalCandidates.ts ← Multi-removal from cache (#1731)
│   ├── SupplementFromCache.ts        ← Historical success supplementation (#1734)
│   └── CandidateApplication.ts       ← Validate-then-fix strategy
│
├── CandidateFiltering.ts             ← Slot allocation, diversity, weighted sampling
├── CandidateScoring.ts               ← Expected improvement calculations
├── CandidateDescriptions.ts          ← Human-readable descriptions & emoji
│
├── SuccessCache.ts                   ← Successful candidate storage + metadata (#1733)
├── FailureCache.ts                   ← Failed candidate lookup & storage
├── FailureCacheKey.ts                ← Deterministic cache key generation
├── FailureCacheTypes.ts              ← Cache type definitions
├── FailureCacheDiagnostics.ts        ← Cache analysis & prediction tracing
├── DiscoveryCacheEviction.ts         ← Cache pruning & retention policies
│
├── DiscoveryDiagnostics.ts           ← Per-changeType success/failure rates (#1735)
├── DiscoveryEvaluationSummary.ts     ← Per-candidate evaluation records
├── DiscoveryFormatting.ts            ← Formatting utilities
├── DiscoveryPostValidate.ts          ← Post-evaluation validation
│
├── ReplayEntryApplication.ts         ← Reconstruct candidates from cache entries
├── ReplayHelpers.ts                  ← Cache replay utilities
├── DiscoveryReplayRunner.ts          ← Replay orchestration
├── DiscoveryReplayRunnerTypes.ts     ← Replay type definitions
│
├── PriorityDiscoveryQueue.ts         ← Task queue management
├── BrittlenessScorer.ts              ← Robustness scoring
├── NeuronErrorImpactEstimator.ts     ← Error impact estimation
├── DiskSpaceMonitor.ts               ← Pre-flight disk space checks
├── DiscoveryTimeout.ts               ← Timeout management
└── DiscoveryCleanup.ts               ← Post-run cleanup
```

### `src/architecture/ErrorGuidedStructuralEvolution/` — Rust FFI & Structure Operations (38 files)

```
RustDiscovery.ts                      ← Barrel re-export for Rust FFI
├── RustDiscoveryTypes.ts             ← Complete FFI type definitions
├── RustDiscoveryInput.ts             ← Creature → Rust format conversion
├── RustDiscoveryLibrary.ts           ← Library loading & availability checks
└── RustDiscoveryOperations.ts        ← FFI call wrappers (record, analyse, merge)

DiscoverStructure.ts                  ← Facade / coordinator
├── DiscoverStructureAnalysis.ts      ← Analysis phase layer
├── DiscoverStructureRecording.ts     ← Recording phase layer
├── DiscoverStructureBase.ts          ← Base class
├── DiscoverStructureTypes.ts         ← Discovery type definitions
│
├── DiscoveryApplication.ts           ← Barrel re-export for application ops
│   ├── DiscoverySynapseOps.ts        ← Synapse add/remove operations
│   ├── DiscoveryNeuronAddition.ts    ← Neuron insertion & squash changes
│   ├── DiscoveryNeuronRemoval.ts     ← Neuron removal with bias compensation
│   └── DiscoveryValidation.ts        ← Validation & issue recording
│
├── ApplyCoordinatedStructuralCandidate.ts ← Epistatic group application
├── CoordinatedStructuralCandidate.ts  ← Coordinated operation types
├── DiscoverResult.ts                  ← FFI result wrapper
│
├── DataRecorder.ts                    ← Training data recording orchestration
├── DataRecorderRecording.ts           ← Recording phase
├── DataRecorderAnalysis.ts            ← Post-recording analysis phase
├── DiscoverDirectory.ts               ← Discovery directory management
├── DiscoverDataLoading.ts             ← Discovery data loading
│
├── FocusSelection.ts                  ← Focus neuron ranking & selection
├── FocusSelectionRanking.ts           ← Ranking algorithm
├── FocusSelectionWeighting.ts         ← Weight computation
├── NeuronImpact.ts                    ← Neuron impact analysis
│
├── RustAnalysisCache.ts               ← Analysis result caching
├── RustFlushDiagnostics.ts            ← Flush operation diagnostics
├── SubmitDiscoveryRecordBatch.ts      ← Batch recording submission
├── DiscoveryPerformance.ts            ← Performance metrics
│
├── DiscoverDiagnosticFormatting.ts    ← Diagnostic output formatting
├── DiscoverLogging.ts                 ← Logging utilities
├── DiscoverLoggingCore.ts             ← Core logging
├── PhaseDiagnostics.ts                ← Phase-specific diagnostics
└── constants.ts                       ← Pipeline constants
```

### Cross-Directory Data Flow

```
src/architecture/ErrorGuidedStructuralEvolution/
    RustDiscoveryOperations.ts
        recordDiscovery()  ──▶  Parquet files on disk
        analyzeParallel()  ──▶  DiscoverResult (suggestions)
    DiscoverStructure.ts
        addHelpfulSynapses(), addHelpfulNeurons(), changeSquash()
        removeLowImpactNeuron(), removeHarmfulNeuron()
            │
            ▼
src/discovery/
    DiscoveryCandidates.ts
        buildDiscoveryCandidates(creature, discoveryResult)
            │
            ▼
    CandidateFiltering.ts
        filterCandidatesForEvaluation(candidates, failureCache)
            │
            ▼
    DiscoveryRunnerEvaluation.ts
        evaluateDiscoveryTasks(candidates, workers)
            │
            ▼
    SuccessCache.ts / FailureCache.ts
        cacheEvaluationResults(results)
```

## Candidate Lifecycle

Each discovery candidate follows a defined lifecycle from creation through to
caching:

```
                  ┌─────────────────────────┐
                  │  1. CREATION             │
                  │  Rust analysis suggests  │
                  │  a structural change     │
                  └────────────┬────────────┘
                               │
                  ┌────────────▼────────────┐
                  │  2. APPLICATION          │
                  │  Change applied to a     │
                  │  clone of base creature  │
                  │  (validate-then-fix)     │
                  └────────────┬────────────┘
                               │
                  ┌────────────▼────────────┐
                  │  3. FILTERING            │
                  │  Failure cache lookup    │──── Cached failure? Skip.
                  │  Category diversity      │
                  │  Weighted sampling       │──── Not selected? Discard.
                  └────────────┬────────────┘
                               │
                  ┌────────────▼────────────┐
                  │  4. EVALUATION           │
                  │  Score on training data  │
                  │  via worker thread       │
                  └────────────┬────────────┘
                               │
                  ┌────────────▼────────────┐
                  │  5. CACHING              │
                  │  Success → success cache │
                  │  Failure → failure cache │
                  └────────────┬────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                                      │
┌───────────▼───────────┐           ┌──────────────▼──────────┐
│ 6a. COMBINATION       │           │ 6b. SELECTION            │
│ (Phase 2)             │           │ Best improvement         │
│ Combined with other   │           │ returned to caller       │
│ successful singles    │           │                          │
└───────────────────────┘           └─────────────────────────┘
```

### Change Types

| Change Type              | Source          | Description                                       |
| ------------------------ | --------------- | ------------------------------------------------- |
| `add-synapses`           | Rust analysis   | Add one synapse between existing neurons          |
| `add-neurons`            | Rust analysis   | Insert one hidden neuron with connections         |
| `change-squash`          | Rust analysis   | Change a neuron's activation function             |
| `coordinated-structural` | Rust analysis   | Multi-operation epistatic group                   |
| `remove-neuron`          | Error analysis  | Remove the most harmful neuron                    |
| `remove-synapse`         | Error analysis  | Remove a harmful synapse                          |
| `remove-low-impact`      | Impact analysis | Remove a neuron with impact < costOfGrowth        |
| `cache-informed-removal` | Success cache   | Multi-neuron removal from historical wins (#1731) |
| `combo-successful`       | Phase 2         | Combination of Phase 1 successes                  |
| `combo-add-remove`       | Phase 1         | Combined addition + removal                       |
| `combo-add-change`       | Phase 1         | Combined addition + squash change                 |
| `combo-best-of-category` | Phase 2         | Best candidate from each category                 |

### Validate-Then-Fix Strategy

When a structural change is applied to a creature clone, the pipeline uses a
two-step validation approach:

1. **Validate only** — Call `validate()` without `fix()`. If validation passes,
   the modification logic is correct.
2. **Fix as fallback** — If validation fails, call `fix()` to repair structural
   issues. This indicates a bug in the modification logic worth investigating.

Creatures at version 2.x/3.x are upgraded to 4.x when forward-only topology is
confirmed. Version 4.x+ creatures enforce strict forward-only connection
ordering.

## Cache Architecture

### Success Cache

The success cache stores candidates that improved the creature's score. Each
entry preserves enough information to **replay** the candidate on a future
creature.

**Directory structure:**

```
{successCacheDir}/
├── add-neurons/
│   └── {hash}.json
├── add-synapses/
│   └── {hash}.json
├── change-squash/
│   └── {hash}.json
├── remove-neuron/
│   └── {hash}.json
├── remove-low-impact/
│   └── {hash}.json
├── remove-synapse/
│   └── {hash}.json
├── cache-informed-removal/
│   └── {hash}.json
└── coordinated-structural/
    └── {hash}.json
```

**Entry metadata** (enhanced in #1733):

| Field                  | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `key`                  | Deterministic cache key                              |
| `changeType`           | Category of structural change                        |
| `description`          | Human-readable summary                               |
| `originalScore`        | Creature score before change                         |
| `candidateScore`       | Score after change                                   |
| `scoreDelta`           | Improvement magnitude                                |
| `originalError`        | Error before change                                  |
| `error`                | Error after change                                   |
| `timestamp`            | ISO 8601 recording time                              |
| `discoveryVersion`     | Rust library version                                 |
| `rustRequest`          | Original Rust suggestion (for replay)                |
| `actualCreatureChange` | What structurally changed (for deterministic replay) |

**De-duplication:** When a key collision occurs, the entry with the higher
`candidateScore` is retained.

**Query methods:**

- `getSuccessfulRemovalNeuronUUIDs()` — Returns UUIDs of neurons that were
  successfully removed in past runs (used by cache-informed removal building).
- `getSuccessfulRemovalDetails()` — Returns structured details including score
  delta and timing for better prioritisation (#1733).

### Failure Cache

The failure cache prevents re-evaluation of candidates known to produce no
improvement. Lookups happen **before** evaluation slot allocation, so cached
failures never waste worker time.

**Caching rules:**

- Most `combo-*` types are **not** cached — their effectiveness depends heavily
  on the current base creature state, so historical failures are unreliable
  predictors.
- Exception: `combo-successful` **is** cached because it is keyed by the
  resulting creature structure, not the combination recipe.

**Entry metadata** includes prediction diagnostics — comparing expected vs
actual improvement to calibrate the Rust analysis engine's predictions.

### Cache Key Generation

Cache keys are designed to be **structurally stable** across evolutionary weight
drift while remaining discriminative enough to avoid false collisions.

| Change Type     | Key Components                          |
| --------------- | --------------------------------------- |
| Neuron removal  | Neuron UUID only                        |
| Synapse removal | From-neuron UUID → to-neuron UUID       |
| All other types | Structural signature + weight exponents |

**Weight exponent bucketing:** Weights are bucketed by their order of magnitude
(log₁₀). Two candidates with weights `0.0042` and `0.0067` share the same
exponent bucket (`-3`), producing the same cache key. This prevents cache
explosion from incremental weight drift across training iterations while still
distinguishing structurally different candidates.

### Cache-Informed Candidate Building

Introduced in #1731, this feature proactively builds **multi-neuron removal
candidates** during Phase 1 by consulting historical success cache data.

**Process:**

1. Query the success cache for neuron UUIDs that were individually removed
   successfully in past runs.
2. Filter to neurons still present in the current base creature.
3. Build 2-neuron and 3-neuron removal combinations using seeded RNG
   (`seed = 1731`) for reproducible sampling.
4. Cap at 10 pair candidates and 6 triple candidates.
5. Submit as `cache-informed-removal` change type for evaluation.

This bridges Phase 1 and the success cache — enabling multi-removal exploration
without waiting for Phase 2 combination building.

### Cache Eviction

`DiscoveryCacheEviction.ts` manages cache size and retention:

- **Pruning** removes old or low-value entries when the cache exceeds size
  thresholds.
- **Obsolete directory cleanup** removes entries for change types or creatures
  no longer relevant.
- **Statistics logging** reports cache state for operational monitoring.

## Candidate Filtering Detail

`CandidateFiltering.ts` implements a multi-stage slot allocation strategy that
balances **evaluation budget** against **exploration breadth**.

**Stage 1 — Failure cache pre-filter:** Remove candidates matching cached
failure keys before any slot allocation. This ensures failed candidates never
consume evaluation capacity.

**Stage 2 — Category diversity:** Reserve minimum slots per change type
(configurable via `discoveryMinCandidatesPerCategory`). Categories include
`add-neurons`, `add-synapses`, `change-squash`, and `remove-low-impact`. This
guarantees each type gets evaluation time regardless of expected improvement
scores.

**Stage 3 — Weighted sampling:** Fill remaining slots via roulette-wheel
selection (`weightedSampleWithoutReplacement()`), weighted by expected
creature-level improvement. Candidates with higher predicted gains are more
likely to be selected.

**Stage 4 — Removal candidate selection:** Removal candidates use a separate
slot pool. The filter prefers **novel** removal candidates over those already
present in the success cache, encouraging exploration of untested removals.

**Slot budget:** Total evaluation slots scale with available workers:
`maxCandidates = max(2 × threadCount, categoryCount)`.

## Discovery Diagnostics

Introduced in #1735, per-change-type diagnostics track evaluation outcomes
across the pipeline.

**Tracked metrics per change type:**

- Number of candidates evaluated
- Number that improved score
- Average score delta
- Success rate percentage

**Output:** Summary table logged at the end of each discovery run. Optionally
persisted to `{archiveDir}/diagnostics.json` for trend analysis across runs.

## Rust FFI Bridge

The Rust FFI layer connects TypeScript to the
[NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery) library
for GPU-accelerated structural analysis.

### FFI Operations

| Function                  | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `recordDiscovery()`       | Record training data to Parquet via Rust         |
| `analyzeParallel()`       | Run GPU/CPU parallel analysis on recorded data   |
| `readDiscoveryRecords()`  | Read Parquet data for a specific neuron          |
| `rankFocusNeurons()`      | Rank neurons by error impact for focus selection |
| `mergeDiscoveryParquet()` | Merge multiple Parquet files                     |

### Data Conversion

`creatureToRustFormat()` converts a Creature instance to the FFI-compatible
`RustRecordInput` format. This includes validation of data sizes and error
counts — corrupt data (error counts exceeding `sampleCount × outputCount × 2`)
is flagged with warnings.

### Library Management

- `isRustDiscoveryEnabled()` checks both library availability **and** GPU
  availability.
- `isRustLibraryAvailable()` checks library loading only.
- `getDiscoveryVersion()` returns the cached Rust library version string.
- Library loading is dynamic via Deno FFI (`.dylib` / `.so` / `.dll`).

### Focus Neuron Selection

Before analysis, the pipeline selects which neurons to focus on. Selection uses
weighted random sampling based on:

- **Total error** — Average absolute error for the neuron (capped by maximum
  output error).
- **Impact** — How much the neuron affects outputs through outgoing synapse
  weights (0.0–1.0).
- **Weighted score** — `totalError × (impact + ε)` — drives roulette-wheel
  selection.

Low-impact neurons (impact < costOfGrowth) are flagged separately as removal
candidates rather than analysis targets.

## Related Issues

- **#1731** — Cache-informed multi-neuron removal building during Phase 1
- **#1733** — Extended success cache metadata for better combination
  prioritisation
- **#1734** — Phase 2 threshold lowered from 2→1 successful singles, with
  historical success supplementation
- **#1735** — Per-change-type discovery diagnostics (success rates, score
  deltas)

## See Also

- [DISCOVERY_GUIDE.md](DISCOVERY_GUIDE.md) — User guide: distributed setup,
  configuration, best practices
- [DiscoveryDir.md](DiscoveryDir.md) — Integration guide: API reference for
  `Creature.discoveryDir()`
- [CONFIGURATION_GUIDE.md](CONFIGURATION_GUIDE.md) — All configuration options
  including discovery parameters
