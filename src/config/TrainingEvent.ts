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
  | SpeciesAdjustedEvent;

/**
 * Callback type for receiving structured training lifecycle events.
 *
 * Issue #1615: When registered via `onTrainingEvent` in NeatOptions,
 * this callback is invoked for each lifecycle event. The callback
 * should be non-blocking; exceptions thrown by the callback are
 * silently caught to avoid disrupting the training loop.
 */
export type TrainingEventCallback = (event: TrainingEvent) => void;
