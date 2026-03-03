/**
 * @module
 *
 * Helpers for working with the AI
 *
 * This module provides various utilities and classes to facilitate the development,
 * manipulation, and evolution of AI entities within the NEAT (NeuroEvolution of Augmenting Topologies) framework.
 *
 * Backends (e.g. WASM, future GPU) are implementation details; callers use the same API and do not
 * initialise or configure backends (Issue #1256).
 *
 * @example
 * ```ts
 * import { Creature } from "./mod.ts";
 *
 * const creature = new Creature(2, 1);
 * creature.evolveDir('.training',{});
 * ```
 */

/**
 * Creature Class
 *
 * This class represents an AI entity in the system. It encapsulates the neural network and its associated behaviors.
 *
 * @see {@link module:src/Creature}
 */
export { Creature } from "./src/Creature.ts";

/**
 * Creature Interfaces
 *
 * These types define the structure of data used for exporting and tracing Creature instances.
 *
 * @see {@link module:src/architecture/CreatureInterfaces}
 */
export type {
  CreatureExport,
  CreatureTrace,
} from "./src/architecture/CreatureInterfaces.ts";

/**
 * Creature Utilities
 *
 * This utility class provides additional functions and helpers for manipulating and working with Creature instances.
 *
 * @see {@link module:src/architecture/CreatureUtils}
 */
export { CreatureUtil } from "./src/architecture/CreatureUtils.ts";

/**
 * NEAT Options
 *
 * This type defines the configuration options available for setting up the NEAT algorithm.
 *
 * @see {@link module:src/config/NeatOptions}
 */
export type {
  NeatOptions,
  NeatOptionsInput,
} from "./src/config/NeatOptions.ts";

/**
 * Output Range Constraints
 *
 * Issue #1620: Per-output range constraints for evolution. When specified,
 * creatures that produce outputs outside these ranges receive a fitness
 * penalty proportional to the excess.
 *
 * @see {@link module:src/config/OutputRangeConfig}
 */
export type {
  OutputRange,
  RequiredOutputRange,
} from "./src/config/OutputRangeConfig.ts";
export { DEFAULT_OUTPUT_RANGE_PENALTY_WEIGHT } from "./src/config/OutputRangeConfig.ts";
export { calculateOutputRangePenalty } from "./src/architecture/OutputRangePenalty.ts";

/**
 * Cost Interface
 *
 * This interface defines the contract for cost functions used in neural network training.
 * External programs can implement this interface to create custom cost functions.
 *
 * @see {@link module:src/costs/CostInterface}
 */
export type { CostInterface } from "./src/costs/CostInterface.ts";

/**
 * Costs Class
 *
 * This class provides a registry for cost functions used in neural network training.
 *
 * @see {@link module:src/Costs}
 */
export { Costs } from "./src/Costs.ts";

/**
 * Selection Class
 *
 * This class handles the selection process within the NEAT algorithm, responsible for selecting the fittest individuals for reproduction.
 *
 * @see {@link module:src/methods/Selection}
 */
export { Selection } from "./src/methods/Selection.ts";

/**
 * Mutation Class
 *
 * This class manages the mutation processes within the NEAT algorithm, allowing for genetic variations in the population.
 *
 * @see {@link module:src/methods/Mutation}
 */
export { Mutation } from "./src/NEAT/Mutation.ts";

/**
 * CRISPR Class
 *
 * This class provides methods for targeted genetic modifications, inspired by the CRISPR gene-editing technology.
 *
 * @see {@link module:src/reconstruct/CRISPR}
 */
export { CRISPR, type CrisprInterface } from "./src/reconstruct/CRISPR.ts";
export { validateDNA } from "./src/reconstruct/validateDNA.ts";

/**
 * Upgrade Class
 *
 * This class facilitates the process of upgrading and evolving AI entities, ensuring the continued improvement of the population.
 *
 * @see {@link module:src/reconstruct/Upgrade}
 */
export { Upgrade } from "./src/reconstruct/Upgrade.ts";

/**
 * Connects missing neurons in the creature's brain.
 * @see {@link module:src/reconstruct/ConnectMissing}
 */
export { randomConnectMissing } from "./src/reconstruct/ConnectMissing.ts";

/**
 * Neuron Class
 */
export { type NeuronExport } from "./src/architecture/NeuronInterfaces.ts";

/**
 * Synapse Class
 */
export { type SynapseExport } from "./src/architecture/SynapseInterfaces.ts";

/**
 * Upgrade to version 2.0.0
 */
export { upgradeTwo } from "./src/upgrade/UpgradeTwo.ts";

/**
 * Discovery formatting utilities
 *
 * These utilities format discovery evaluation summaries consistently.
 * Use them when logging evaluation results yourself after disabling
 * the library's internal logging with `discoveryDisableEvaluationSummaryLogging: true`.
 *
 * @see {@link module:src/discovery/DiscoveryRunner}
 */
export {
  formatErrorDelta,
  formatPercentWithSignificantDigits,
} from "./src/discovery/DiscoveryRunner.ts";

/**
 * Discovery evaluation summary type
 *
 * @see {@link module:src/discovery/DiscoveryRunner}
 */
export type { DiscoveryEvaluationSummary } from "./src/discovery/DiscoveryRunner.ts";

/**
 * Intelligent Design Module
 *
 * This module provides utilities for optimising neural network creatures by
 * systematically testing different squash (activation) functions for each neuron
 * and applying tacit knowledge (learned neuron-to-squash mappings).
 *
 * @see {@link module:src/intelligentDesign/mod}
 */
export {
  alternativeSquashes,
  applyNeuronChanges,
  cleanKnowledge,
  combineImprovements,
  combineKnowledge,
  getNeuronsToTest,
  getValidNeuronSquashes,
  makeModifiedCreature,
  makeModifiedCreatureWithPrevious,
  safeWriteJson,
  safeWriteJsonSync,
  safeWriteText,
  safeWriteTextSync,
  scanForSquashImprovements,
  shuffle,
  WorkerHandler as IntelligentDesignWorkerHandler,
  WorkerProcessor as IntelligentDesignWorkerProcessor,
} from "./src/intelligentDesign/mod.ts";
export type {
  ApplyTacitKnowledgeOptions,
  BestNeuronSquash,
  ImproveSquashOptions,
  ImproveSquashResult,
  RequestData as IntelligentDesignRequestData,
  ResponseData as IntelligentDesignResponseData,
  TacitKnowledgeMap,
  TacitKnowledgeResult,
  WorkerInterface as IntelligentDesignWorkerInterface,
} from "./src/intelligentDesign/mod.ts";

/**
 * Plateau Detection Module
 *
 * Issue #1039: Fitness plateau detection with stagnation response.
 * Detects when evolution stagnates and automatically increases mutation
 * rate to help escape local optima.
 *
 * @see {@link module:src/NEAT/PlateauDetector}
 */
export {
  DEFAULT_PLATEAU_DETECTION,
  detectPlateau,
  PlateauDetector,
} from "./src/NEAT/PlateauDetector.ts";
export type {
  PlateauDetectionConfig,
  RequiredPlateauDetectionConfig,
} from "./src/NEAT/PlateauDetector.ts";

/**
 * WASM Cache Control
 *
 * Issue #1338, #1504, #1581: Control the WASM activation LRU cache size, query
 * occupancy, and flush all cached entries. Data-generation workloads that touch
 * many creatures should lower the cache cap (e.g. 64–128) to reduce WASM heap
 * retention, and call {@link disposeAllCachedWasmActivations} between training
 * runs to fully free WASM linear memory.
 *
 * @see {@link module:src/wasm/WasmCreatureActivationLRU}
 */
export {
  disposeAllCachedWasmActivations,
  getCachedWasmActivationCount,
  getMaxCachedWasmCreatureActivations,
  getWasmActivationLruStats,
  resetWasmActivationLruStats,
  setMaxCachedWasmCreatureActivations,
} from "./src/wasm/WasmCreatureActivationLRU.ts";

/**
 * Cache Diagnostics
 *
 * Issue #1616: Unified cache diagnostics API. Call {@link getCacheStats}
 * to retrieve hit/miss rates, eviction counts, and size metrics for all
 * instrumented caches. Use these metrics to tune cache configuration
 * (e.g. WasmCacheConfig, distance cache size) for your workload.
 *
 * @see {@link module:src/cache/CacheStats}
 * @see {@link module:src/cache/getCacheStats}
 */
export type { CacheStats } from "./src/cache/CacheStats.ts";
export { getCacheStats } from "./src/cache/getCacheStats.ts";

/**
 * WASM preload for workers (Issue #1285)
 *
 * Call {@link fetchWasmForWorkers} in the main thread before spawning workers
 * so WASM is fetched once and cached; workers then receive the cached payload
 * instead of each fetching separately.
 */
export { fetchWasmForWorkers } from "./src/multithreading/workers/WorkerHandler.ts";

/**
 * Structured Logger
 *
 * Issue #1398: Configurable logging abstraction. Consumers can inject a custom
 * logger via NeatOptions or call setLogger() globally.
 *
 * @see {@link module:src/utils/Logger}
 */
export {
  createConsoleLogger,
  getLogger,
  setLogger,
  SILENT_LOGGER,
} from "./src/utils/Logger.ts";
export type { Logger, LogLevel } from "./src/utils/Logger.ts";

/**
 * Random Number Generator
 *
 * Issue #1400: Reproducible random number generation with seeding support.
 * Pass a `seed` in NeatOptions for deterministic evolution runs, or inject
 * a custom RNG via the `rng` option.
 *
 * @see {@link module:src/utils/RandomNumberGenerator}
 */
export {
  createSeededRng,
  createUnseededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "./src/utils/RandomNumberGenerator.ts";
export type { RandomNumberGenerator } from "./src/utils/RandomNumberGenerator.ts";

/**
 * Structured Training Events
 *
 * Issue #1615: Structured event logging for training lifecycle. Register
 * an `onTrainingEvent` callback in NeatOptions to receive typed events
 * for generation completion, plateau detection, discovery outcomes,
 * memory pressure, and species adjustments.
 *
 * @see {@link module:src/config/TrainingEvent}
 */
export type {
  DiscoveryCompleteEvent,
  GenerationCompleteEvent,
  MemoryPressureEvent,
  PlateauDetectedEvent,
  SpeciesAdjustedEvent,
  TrainingEvent,
  TrainingEventCallback,
} from "./src/config/TrainingEvent.ts";

/**
 * Configuration Presets
 *
 * Issue #1619: Pre-built configuration presets for common training
 * scenarios. Each preset is a `NeatOptions` object that can be spread
 * into user configuration:
 *
 * ```ts
 * const config = createNeatConfig({
 *   ...QUICK_START_PRESET,
 *   populationSize: 25, // override preset value
 * });
 * ```
 *
 * @see {@link module:src/presets/Presets}
 */
export {
  DISCOVERY_FOCUSED_PRESET,
  LARGE_NETWORK_PRESET,
  MEMORY_CONSTRAINED_PRESET,
  QUICK_START_PRESET,
} from "./src/presets/Presets.ts";
