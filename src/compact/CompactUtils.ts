/**
 * Re-exports from focused compact utility modules.
 *
 * This file maintains backward compatibility by re-exporting all public
 * symbols from the decomposed modules:
 * - OrphanedNeuronCleanup.ts — orphaned neuron detection and removal
 * - SynapsePruning.ts — duplicate and zero-weight synapse pruning
 * - DeadSubgraphPruning.ts — unreachable subgraph removal
 * - MemeticCleanup.ts — memetic data cleanup for removed structures
 */

export {
  cleanupOrphanedNeurons,
  cleanupOrphanedNeuronsInCreature,
  COMPACT_UNITY_SLOT_TAG,
  createConstantOne,
  removeHiddenNeuron,
} from "./OrphanedNeuronCleanup.ts";
export type { CleanupOrphanedResult } from "./OrphanedNeuronCleanup.ts";

export {
  mergeDuplicateSynapses,
  mergeDuplicateSynapsesInCreature,
  pruneZeroWeightSynapses,
} from "./SynapsePruning.ts";
export type {
  MergeDuplicateSynapsesResult,
  PruneZeroWeightSynapsesResult,
} from "./SynapsePruning.ts";

export {
  pruneDeadSubgraphs,
  pruneDeadSubgraphsInCreature,
} from "./DeadSubgraphPruning.ts";
export type { PruneDeadSubgraphsResult } from "./DeadSubgraphPruning.ts";

export {
  cleanupMemeticForRemovedNeuron,
  cleanupMemeticForRemovedSynapse,
  pruneOrphanMemeticReferences,
} from "./MemeticCleanup.ts";
