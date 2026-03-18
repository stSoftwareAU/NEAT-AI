/**
 * CheckpointInterface.ts - Defines the checkpoint format for transfer learning.
 *
 * Issue #1861: A checkpoint captures a trained creature's topology, weights,
 * and metadata so it can be reused as a seed for a different but related task.
 */

import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";

/**
 * Metadata about the source task and training history of a checkpoint.
 */
export interface CheckpointMetadata {
  /** Human-readable name for the source task */
  sourceTask?: string;

  /** Description of what the creature was trained on */
  description?: string;

  /** ISO timestamp when the checkpoint was created */
  createdAt: string;

  /** Fitness score at time of export (if available) */
  score?: number;

  /** Number of generations trained */
  generations?: number;

  /** Number of input neurons in the source task */
  sourceInputCount: number;

  /** Number of output neurons in the source task */
  sourceOutputCount: number;

  /** UUIDs of input neurons in the source task (for mapping) */
  sourceInputUUIDs: string[];

  /** UUIDs of output neurons in the source task (for mapping) */
  sourceOutputUUIDs: string[];
}

/**
 * A checkpoint is a serialised creature with transfer learning metadata.
 *
 * The `creature` field uses the standard `CreatureExport` format so existing
 * serialisation infrastructure works unchanged.
 */
export interface CheckpointInterface {
  /** Version of the checkpoint format */
  version: "1.0.0";

  /** The serialised creature (topology + weights) */
  creature: CreatureExport;

  /** Metadata about the source task and training history */
  metadata: CheckpointMetadata;

  /** Optional list of neuron UUIDs whose weights are frozen */
  frozenNeuronUUIDs?: string[];

  /** Optional list of synapse keys (fromUUID->toUUID) whose weights are frozen */
  frozenSynapseKeys?: string[];
}
