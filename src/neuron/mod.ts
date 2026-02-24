/**
 * Neuron module - focused submodules extracted from Neuron.ts.
 *
 * Issue #1599: Extract Neuron.ts (1,339 lines) into focused modules.
 *
 * Each module handles a single responsibility:
 * - NeuronActivation.ts    - Activation function management and computation
 * - NeuronPropagation.ts   - Backpropagation and error distribution
 * - NeuronRecord.ts        - Error recording for structural discovery
 * - NeuronTopology.ts      - Topology fixing, mutation, and connectivity
 * - NeuronSerialization.ts - JSON import/export
 */

export {
  applyLearnings,
  hasApplyLearnings,
  isFixableActivation,
  isNodeActivation,
  makeFunction,
  prepare,
} from "./NeuronActivation.ts";

export {
  adjustedActivation,
  propagate,
  propagateUpdate,
  rawAdjustedActivation,
} from "./NeuronPropagation.ts";

export { record } from "./NeuronRecord.ts";

export { fix, mutate } from "./NeuronTopology.ts";

export { exportJSON, fromJSON, internalJSON } from "./NeuronSerialization.ts";
