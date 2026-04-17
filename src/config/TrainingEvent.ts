/**
 * TrainingEvent.ts - Structured event types for training lifecycle logging.
 *
 * Issue #1615: Defines a discriminated union of training lifecycle events
 * that can be emitted via the optional `onTrainingEvent` callback in
 * NeatOptions. Events are fire-and-forget with zero cost when no callback
 * is registered.
 */

/**
 * Sub-phase timing breakdown within the breeding phase.
 *
 * Issue #2284: Finer-grained instrumentation within `ParallelBreeding`
 * and `Offspring.breed()` to measure where time is spent within the
 * dominant breeding bottleneck (50–60% of wall-clock time).
 *
 * Times are aggregated across all offspring produced in a generation.
 */
export interface BreedingSubPhaseTiming {
  /** Time spent selecting parent pairs via FitnessRanking in ms. */
  readonly parentSelectionMs: number;
  /** Time spent computing genetic compatibility in ms. */
  readonly geneticCompatibilityMs: number;
  /** Time spent on genome alignment and crossover (neuron map building, population) in ms. */
  readonly alignmentCrossoverMs: number;
  /** Time spent in sortNeurons() dependency-aware ordering in ms. */
  readonly sortNeuronsMs: number;
  /** Time spent building batch connections with dedup in ms. */
  readonly batchConnectionMs: number;
  /** Time spent on post-breeding topology repair (forward-only, UUID uniqueness) in ms. */
  readonly postBreedingRepairMs: number;
  /** Number of offspring successfully produced. */
  readonly offspringCount: number;
}

/**
 * Snapshot of worker utilisation captured at a phase boundary.
 *
 * Issue #2312: Measures how many workers were active vs idle during each
 * evolution phase, providing the data needed to understand low CPU usage
 * in production clusters.
 */
export interface WorkerUtilisationSnapshot {
  /** Number of fast-pool workers that were active (busy) during the phase. */
  readonly fastActive: number;
  /** Total number of fast-pool workers. */
  readonly fastTotal: number;
  /** Fast-pool utilisation as a percentage (0–100). */
  readonly fastUtilisationPct: number;
  /** Number of heavy-pool workers that were active (busy) during the phase. */
  readonly heavyActive: number;
  /** Total number of heavy-pool workers. */
  readonly heavyTotal: number;
  /** Heavy-pool utilisation as a percentage (0–100). */
  readonly heavyUtilisationPct: number;
}

/**
 * Per-phase worker utilisation breakdown for a single generation.
 *
 * Issue #2312: Records a utilisation snapshot at the start and end of each
 * phase so callers can see which phases leave workers idle.
 */
export interface PhaseWorkerUtilisation {
  /** Worker utilisation during the fitness evaluation phase. */
  readonly fitness?: WorkerUtilisationSnapshot;
  /** Worker utilisation during the breeding phase. */
  readonly breeding?: WorkerUtilisationSnapshot;
  /** Worker utilisation during the sort phase (main thread only). */
  readonly sort?: WorkerUtilisationSnapshot;
  /** Worker utilisation during the write-scores phase (main thread only). */
  readonly writeScores?: WorkerUtilisationSnapshot;
  /** Worker utilisation during the speciation phase (main thread only). */
  readonly speciation?: WorkerUtilisationSnapshot;
  /** Worker utilisation during the mutation phase (main thread only). */
  readonly mutation?: WorkerUtilisationSnapshot;
  /** Worker utilisation during the de-duplication phase. */
  readonly deduplication?: WorkerUtilisationSnapshot;
  /** Worker utilisation during the WASM pre-warming phase. */
  readonly preWarm?: WorkerUtilisationSnapshot;
  /** Overall estimated CPU utilisation for the generation (0–100). */
  readonly overallCpuUtilisationPct?: number;
}

/**
 * Per-phase timing breakdown for a single generation.
 *
 * Issue #2239: Lightweight timing diagnostics to identify slow phases
 * in the evolution loop. Only populated when instrumentation is active.
 */
export interface GenerationPhaseTiming {
  /** Time spent on fitness evaluation (neat.fitness.calculate) in ms. */
  readonly fitnessMs: number;
  /** Time spent on parallel breeding (parallelBreeding.breedBatch) in ms. */
  readonly breedingMs: number;
  /** Time spent processing completed training/discovery results in ms. */
  readonly resultProcessingMs: number;
  /** Total time for the entire evolve() call in ms. */
  readonly totalMs: number;
  /**
   * Time spent on proactive memory monitoring and cache eviction in ms.
   * Issue #2263: Pre-fitness eviction reduces GC pressure during fitness.
   */
  readonly memoryEvictionMs?: number;
  /**
   * Time spent writing checkpoint files (writeCreatures) in ms.
   * Issue #2251: Present only when a checkpoint ran that generation.
   */
  readonly checkpointWriteMs?: number;
  /**
   * Time spent writing score files to the experiment store in ms.
   * Issue #2274: Per-creature synchronous file I/O every generation.
   */
  readonly writeScoresMs?: number;
  /**
   * Time spent mutating the offspring population in ms.
   * Issue #2274: Sequential iteration over newPopulation in Mutator.mutate().
   */
  readonly mutationMs?: number;
  /**
   * Time spent on single-pass de-duplication of the combined population in ms.
   * Issue #2274: Bloom filter + Set-based dedup with optional replacement breeding.
   */
  readonly deduplicationMs?: number;
  /**
   * Time spent on speciation (Genus.addCreature) in ms.
   * Issue #2274: Assigns each creature to a species for breeding selection.
   */
  readonly speciationMs?: number;
  /**
   * Time spent sorting creatures by score in ms.
   * Issue #2274: O(n log n) sort after fitness evaluation.
   */
  readonly sortMs?: number;
  /**
   * Sub-phase timing breakdown within the breeding phase.
   * Issue #2284: Identifies which sub-operation within breeding is the hotspot.
   */
  readonly breedingSubPhases?: BreedingSubPhaseTiming;
  /**
   * Time spent pre-warming the WASM compilation cache in ms.
   * Issue #2287: Pre-computes topology hashes and pre-compiles WASM templates
   * for unique topologies before the next generation's fitness evaluation.
   */
  readonly preWarmMs?: number;
  /**
   * Wall-clock time saved by overlapping independent phases in ms.
   * Issue #2314: When phases run concurrently (breeding + result processing,
   * dedup + pre-warming), individual phase durations sum to more than totalMs.
   * This field captures the overlap so consumers can reconcile the difference.
   */
  readonly pipelineOverlapMs?: number;
  /**
   * Per-phase worker utilisation breakdown.
   * Issue #2312: Shows how many workers were active during each evolution phase,
   * exposing where workers sit idle and guiding concurrency improvements.
   */
  readonly workerUtilisation?: PhaseWorkerUtilisation;
}

/**
 * Emitted when a generation completes evaluation and selection.
 */
export interface GenerationCompleteEvent {
  readonly kind: "generation_complete";
  /** ISO-8601 timestamp when the event was emitted. */
  readonly timestamp: string;
  /** The generation number (1-based). */
  readonly generation: number;
  /** The best fitness score in this generation. */
  readonly bestFitness: number;
  /** The average fitness score across the population. */
  readonly averageFitness: number;
  /** Current population size. */
  readonly populationSize: number;
  /** Time elapsed for this generation in milliseconds. */
  readonly elapsedMs: number;
  /**
   * Per-phase timing breakdown for this generation.
   * Issue #2239: Identifies which phase of evolution consumed the most time.
   */
  readonly phaseTiming: GenerationPhaseTiming;
}

/**
 * Emitted when the plateau detector identifies fitness stagnation.
 */
export interface PlateauDetectedEvent {
  readonly kind: "plateau_detected";
  /** ISO-8601 timestamp when the event was emitted. */
  readonly timestamp: string;
  /** The generation number when the plateau was detected. */
  readonly generation: number;
  /** Number of consecutive generations on the plateau. */
  readonly stagnationCount: number;
  /** The configured plateau detection window size. */
  readonly plateauThreshold: number;
  /** The current improvement rate (may be null if insufficient data). */
  readonly improvementRate: number | null;
  /** The mutation multiplier being applied in response to stagnation. */
  readonly mutationMultiplier: number;
}

/**
 * Emitted when a discovery (structural evolution) operation completes.
 */
export interface DiscoveryCompleteEvent {
  readonly kind: "discovery_complete";
  /** ISO-8601 timestamp when the event was emitted. */
  readonly timestamp: string;
  /** Outcome of the discovery: whether it improved the creature or not. */
  readonly outcome: "improved" | "no_change" | "timeout";
  /** Number of discovery candidates that were evaluated. */
  readonly candidateCount: number;
  /** Time elapsed for the discovery operation in milliseconds. */
  readonly elapsedMs: number;
}

/**
 * Emitted when memory pressure triggers cache eviction.
 */
export interface MemoryPressureEvent {
  readonly kind: "memory_pressure";
  /** ISO-8601 timestamp when the event was emitted. */
  readonly timestamp: string;
  /** Heap memory used in bytes. */
  readonly heapUsed: number;
  /** Heap memory limit in bytes. */
  readonly heapLimit: number;
  /** Whether cache entries were evicted. */
  readonly evicted: boolean;
  /** The pressure level that triggered the event. */
  readonly pressureLevel: "warning" | "critical";
}

/**
 * Emitted when species counts are adjusted during evolution.
 */
export interface SpeciesAdjustedEvent {
  readonly kind: "species_adjusted";
  /** ISO-8601 timestamp when the event was emitted. */
  readonly timestamp: string;
  /** The current number of species in the population. */
  readonly speciesCount: number;
  /** The genetic compatibility threshold used for speciation. */
  readonly compatibilityThreshold: number;
}

/**
 * Emitted when adaptive population sizing adjusts the effective population size.
 *
 * Issue #2316: Reports population size changes driven by diversity-based
 * adaptive sizing and/or the worker-aware minimum floor. Only emitted when
 * the effective size actually changes from the previous generation.
 */
export interface PopulationResizedEvent {
  readonly kind: "population_resized";
  /** ISO-8601 timestamp when the event was emitted. */
  readonly timestamp: string;
  /** The previous effective population size. */
  readonly previousSize: number;
  /** The new effective population size. */
  readonly newSize: number;
  /** The configured base population size. */
  readonly baseSize: number;
  /**
   * The reason for the size change:
   * - "low_diversity": population grew because diversity was below threshold.
   * - "high_diversity_plateau": population shrank due to high diversity + plateau.
   * - "worker_floor": population increased to meet the worker-aware minimum.
   * - "combined": multiple factors contributed to the change.
   */
  readonly reason:
    | "low_diversity"
    | "high_diversity_plateau"
    | "worker_floor"
    | "combined";
}

/**
 * Discriminated union of all training lifecycle events.
 *
 * Use the `kind` field to narrow the type:
 * ```ts
 * function handler(event: TrainingEvent) {
 *   switch (event.kind) {
 *     case "generation_complete":
 *       console.log(`Gen ${event.generation}: ${event.bestFitness}`);
 *       break;
 *     case "plateau_detected":
 *       console.log(`Stagnation for ${event.stagnationCount} generations`);
 *       break;
 *   }
 * }
 * ```
 */
export type TrainingEvent =
  | GenerationCompleteEvent
  | PlateauDetectedEvent
  | DiscoveryCompleteEvent
  | MemoryPressureEvent
  | SpeciesAdjustedEvent
  | PopulationResizedEvent;

/**
 * Callback type for receiving structured training lifecycle events.
 *
 * Issue #1615: When registered via `onTrainingEvent` in NeatOptions,
 * this callback is invoked for each lifecycle event. The callback
 * should be non-blocking; exceptions thrown by the callback are
 * silently caught to avoid disrupting the training loop.
 */
export type TrainingEventCallback = (event: TrainingEvent) => void;
