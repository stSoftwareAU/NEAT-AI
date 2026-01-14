/**
 * @module
 *
 * Helpers for working with the AI
 *
 * This module provides various utilities and classes to facilitate the development,
 * manipulation, and evolution of AI entities within the NEAT (NeuroEvolution of Augmenting Topologies) framework.
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
export type { NeatOptions } from "./src/config/NeatOptions.ts";

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
