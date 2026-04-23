/**
 * Re-exports from focused compact utility modules.
 *
 * This file maintains backward compatibility by re-exporting all public
 * symbols from the decomposed modules:
 * - OrphanedNeuronCleanup.ts — orphaned neuron detection and removal
 * - SynapsePruning.ts — duplicate and zero-weight synapse pruning
 * - DeadSubgraphPruning.ts — unreachable subgraph removal
 * - MemeticCleanup.ts — memetic data cleanup for removed structures
 * - CloneCreatureExport.ts — fast shallow clone of a CreatureExport
 */

export { cloneCreatureExport } from "@compact/CloneCreatureExport.ts";

export {
  cleanupOrphanedNeurons,
  cleanupOrphanedNeuronsInCreature,
  COMPACT_UNITY_SLOT_TAG,
  createConstantOne,
  removeHiddenNeuron,
} from "@compact/OrphanedNeuronCleanup.ts";
export type { CleanupOrphanedResult } from "@compact/OrphanedNeuronCleanup.ts";

export {
  mergeDuplicateSynapses,
  mergeDuplicateSynapsesInCreature,
  pruneZeroWeightSynapses,
} from "@compact/SynapsePruning.ts";
export type {
  MergeDuplicateSynapsesResult,
  PruneZeroWeightSynapsesResult,
} from "@compact/SynapsePruning.ts";

export {
  pruneDeadSubgraphs,
  pruneDeadSubgraphsInCreature,
} from "@compact/DeadSubgraphPruning.ts";
export type { PruneDeadSubgraphsResult } from "@compact/DeadSubgraphPruning.ts";

export {
  cleanupMemeticForRemovedNeuron,
  cleanupMemeticForRemovedSynapse,
  pruneOrphanMemeticReferences,
} from "@compact/MemeticCleanup.ts";
