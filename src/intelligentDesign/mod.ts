/**
 * Intelligent Design module for NEAT-AI.
 *
 * This module provides utilities for optimising neural network creatures by
 * systematically testing different squash (activation) functions for each neuron
 * and applying tacit knowledge (learned neuron-to-squash mappings).
 *
 * ## Key Features
 *
 * - **Squash Improvement Scanning**: Systematically test alternative activation
 *   functions for each hidden neuron to find improvements.
 *
 * - **Tacit Knowledge**: Store and apply learned neuron-to-squash mappings that
 *   work well, supporting both local (machine-specific) and hive (shared) knowledge.
 *
 * - **Worker Pool**: Parallel scoring using worker threads for efficient evaluation.
 *
 * - **Safe File Writing**: Atomic file writes to prevent corruption.
 *
 * ## Example Usage
 *
 * ```ts
 * import {
 *   scanForSquashImprovements,
 *   combineImprovements,
 *   safeWriteJson,
 * } from "@stsoftware/neat-ai/intelligentDesign";
 *
 * // Scan for squash improvements
 * const result = await scanForSquashImprovements({
 *   creature: creatureExport,
 *   targetSquash: "GELU",
 *   outputDir: "./creatures",
 *   dataDir: "./training-data",
 *   bestScore: currentScore,
 * });
 *
 * // Combine improvements into a single creature
 * if (result.improvements.size > 0) {
 *   const { creature, message } = combineImprovements(
 *     creatureExport,
 *     result.improvements,
 *     "./training-data",
 *     currentScore,
 *   );
 *   console.log(message);
 *   await safeWriteJson("./best.json", creature);
 * }
 * ```
 *
 * @module
 */

// Alternative squash functions
export { alternativeSquashes } from "./AlternativeSquashes.ts";

// Best neuron squash type
export type { BestNeuronSquash } from "./BestNeuronSquash.ts";

// Safe write utilities
export {
  safeWriteJson,
  safeWriteJsonSync,
  safeWriteText,
  safeWriteTextSync,
} from "./SafeWrite.ts";

// Tacit knowledge utilities
export {
  applyNeuronChanges,
  cleanKnowledge,
  combineKnowledge,
  getNeuronsToTest,
  getValidNeuronSquashes,
  makeModifiedCreature,
} from "./TacitKnowledge.ts";
export type {
  ApplyTacitKnowledgeOptions,
  TacitKnowledgeMap,
  TacitKnowledgeResult,
} from "./TacitKnowledge.ts";

// Squash improvement utilities
export {
  combineImprovements,
  makeModifiedCreatureWithPrevious,
  scanForSquashImprovements,
  shuffle,
} from "./ImproveSquash.ts";
export type {
  ImproveSquashOptions,
  ImproveSquashResult,
} from "./ImproveSquash.ts";

// Worker utilities
export { WorkerHandler } from "./workers/WorkerHandler.ts";
export type { RequestData, WorkerInterface } from "./workers/WorkerHandler.ts";
export { WorkerProcessor } from "./workers/WorkerProcessor.ts";
export type { ResponseData } from "./workers/ResponseData.ts";
