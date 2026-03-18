/**
 * Checkpoint.ts - Export and import creatures as transfer learning checkpoints.
 *
 * Issue #1861: Provides functions to:
 * 1. Export a trained creature as a checkpoint with metadata
 * 2. Import a checkpoint to create a creature for a new task
 * 3. Handle UUID mapping between different input/output configurations
 */

import { Creature } from "../Creature.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type {
  CheckpointInterface,
  CheckpointMetadata,
} from "./CheckpointInterface.ts";

/**
 * Options for exporting a creature as a checkpoint.
 */
export interface CheckpointExportOptions {
  /** Human-readable name for the source task */
  sourceTask?: string;

  /** Description of what the creature was trained on */
  description?: string;

  /** Number of generations trained */
  generations?: number;

  /** Neuron UUIDs to mark as frozen in the checkpoint */
  frozenNeuronUUIDs?: string[];

  /** Synapse keys (fromUUID->toUUID) to mark as frozen */
  frozenSynapseKeys?: string[];
}

/**
 * Exports a trained creature as a transfer learning checkpoint.
 *
 * The checkpoint includes the full creature topology and weights plus
 * metadata about the source task for UUID mapping during import.
 */
export function exportCheckpoint(
  creature: Creature,
  options?: CheckpointExportOptions,
): CheckpointInterface {
  const creatureExport = creature.exportJSON();

  // Collect input UUIDs
  const sourceInputUUIDs: string[] = [];
  for (let i = 0; i < creature.input; i++) {
    sourceInputUUIDs.push(creature.neurons[i].uuid);
  }

  // Collect output UUIDs
  const sourceOutputUUIDs: string[] = [];
  for (const neuron of creature.neurons) {
    if (neuron.type === "output") {
      sourceOutputUUIDs.push(neuron.uuid);
    }
  }

  const metadata: CheckpointMetadata = {
    sourceTask: options?.sourceTask,
    description: options?.description,
    createdAt: new Date().toISOString(),
    score: creature.score,
    generations: options?.generations,
    sourceInputCount: creature.input,
    sourceOutputCount: creature.output,
    sourceInputUUIDs,
    sourceOutputUUIDs,
  };

  const checkpoint: CheckpointInterface = {
    version: "1.0.0",
    creature: creatureExport,
    metadata,
  };

  if (options?.frozenNeuronUUIDs && options.frozenNeuronUUIDs.length > 0) {
    checkpoint.frozenNeuronUUIDs = [...options.frozenNeuronUUIDs];
  }

  if (options?.frozenSynapseKeys && options.frozenSynapseKeys.length > 0) {
    checkpoint.frozenSynapseKeys = [...options.frozenSynapseKeys];
  }

  return checkpoint;
}

/**
 * Options for importing a checkpoint as a creature for a new task.
 */
export interface CheckpointImportOptions {
  /**
   * UUID mapping from source input UUIDs to target input UUIDs.
   * Keys are source UUIDs, values are target UUIDs.
   * If not provided, inputs are mapped by position.
   */
  inputUUIDMapping?: Map<string, string>;

  /**
   * UUID mapping from source output UUIDs to target output UUIDs.
   * Keys are source UUIDs, values are target UUIDs.
   * If not provided, outputs are mapped by position.
   */
  outputUUIDMapping?: Map<string, string>;

  /**
   * Number of inputs in the target task.
   * Required when the target task has different input count.
   */
  targetInputCount?: number;

  /**
   * Number of outputs in the target task.
   * Required when the target task has different output count.
   */
  targetOutputCount?: number;

  /**
   * Whether to freeze all hidden neuron weights.
   * When true, only output weights are trainable.
   * Default: false
   */
  freezeHidden?: boolean;
}

/**
 * Imports a checkpoint and creates a creature adapted for the target task.
 *
 * Handles UUID mapping when source and target tasks have different
 * input/output configurations. Hidden layer topology and weights are
 * preserved from the checkpoint.
 */
export function importCheckpoint(
  checkpoint: CheckpointInterface,
  options?: CheckpointImportOptions,
): Creature {
  const sourceCreature = checkpoint.creature;
  const targetInputCount = options?.targetInputCount ?? sourceCreature.input;
  const targetOutputCount = options?.targetOutputCount ?? sourceCreature.output;

  // If input/output counts match and no mapping needed, simple import
  if (
    targetInputCount === sourceCreature.input &&
    targetOutputCount === sourceCreature.output &&
    !options?.inputUUIDMapping &&
    !options?.outputUUIDMapping
  ) {
    const creature = Creature.fromJSON(sourceCreature, true);
    applyFreezeFlags(creature, checkpoint, options);
    return creature;
  }

  // Build the remapped creature export
  const remapped = remapCreatureForTask(
    sourceCreature,
    checkpoint.metadata,
    targetInputCount,
    targetOutputCount,
    options?.inputUUIDMapping,
    options?.outputUUIDMapping,
  );

  const creature = Creature.fromJSON(remapped, true);
  applyFreezeFlags(creature, checkpoint, options);
  return creature;
}

/**
 * Applies freeze flags to a creature based on checkpoint and import options.
 */
function applyFreezeFlags(
  creature: Creature,
  checkpoint: CheckpointInterface,
  options?: CheckpointImportOptions,
): void {
  const frozenNeuronUUIDs = new Set<string>(
    checkpoint.frozenNeuronUUIDs ?? [],
  );

  if (options?.freezeHidden) {
    for (const neuron of creature.neurons) {
      if (neuron.type === "hidden") {
        frozenNeuronUUIDs.add(neuron.uuid);
      }
    }
  }

  // Apply frozen flags to neurons
  for (const neuron of creature.neurons) {
    if (frozenNeuronUUIDs.has(neuron.uuid)) {
      creature.setNeuronFrozen(neuron.index, true);
    }
  }

  // Apply frozen flags to synapses from checkpoint
  if (checkpoint.frozenSynapseKeys) {
    const synapseKeySet = new Set(checkpoint.frozenSynapseKeys);
    for (const synapse of creature.synapses) {
      const fromUUID = creature.neurons[synapse.from].uuid;
      const toUUID = creature.neurons[synapse.to].uuid;
      const key = `${fromUUID}->${toUUID}`;
      if (synapseKeySet.has(key)) {
        creature.setSynapseFrozen(synapse.from, synapse.to, true);
      }
    }
  }

  // When freezeHidden is on, also freeze synapses between hidden neurons
  if (options?.freezeHidden) {
    for (const synapse of creature.synapses) {
      const fromNeuron = creature.neurons[synapse.from];
      const toNeuron = creature.neurons[synapse.to];
      if (fromNeuron.type === "hidden" && toNeuron.type === "hidden") {
        creature.setSynapseFrozen(synapse.from, synapse.to, true);
      }
    }
  }
}

/**
 * Remaps a creature export for a target task with different input/output counts.
 *
 * Strategy:
 * - Inputs present in both source and target are kept (via UUID mapping)
 * - Extra target inputs get new connections to existing hidden neurons
 * - Missing source inputs have their connections removed
 * - Output mapping works similarly
 * - Hidden layer topology is fully preserved
 */
function remapCreatureForTask(
  source: CreatureExport,
  metadata: CheckpointMetadata,
  targetInputCount: number,
  targetOutputCount: number,
  inputUUIDMapping?: Map<string, string>,
  outputUUIDMapping?: Map<string, string>,
): CreatureExport {
  // Build input UUID mapping (source UUID -> target UUID)
  const inputMap = new Map<string, string>();
  if (inputUUIDMapping) {
    for (const [sourceUUID, targetUUID] of inputUUIDMapping) {
      inputMap.set(sourceUUID, targetUUID);
    }
  } else {
    // Default: map by position for overlapping inputs
    const overlapInputs = Math.min(
      metadata.sourceInputCount,
      targetInputCount,
    );
    for (let i = 0; i < overlapInputs; i++) {
      inputMap.set(`input-${i}`, `input-${i}`);
    }
  }

  // Build output UUID mapping (source UUID -> target UUID)
  const outputMap = new Map<string, string>();
  if (outputUUIDMapping) {
    for (const [sourceUUID, targetUUID] of outputUUIDMapping) {
      outputMap.set(sourceUUID, targetUUID);
    }
  } else {
    // Default: map by position for overlapping outputs
    const overlapOutputs = Math.min(
      metadata.sourceOutputCount,
      targetOutputCount,
    );
    for (let i = 0; i < overlapOutputs; i++) {
      outputMap.set(`output-${i}`, `output-${i}`);
    }
  }

  // Collect the set of source input UUIDs to know which synapses to remap
  const sourceInputUUIDs = new Set(metadata.sourceInputUUIDs);
  const sourceOutputUUIDs = new Set(metadata.sourceOutputUUIDs);

  // Remap neurons: keep hidden neurons as-is, remap outputs
  const remappedNeurons = source.neurons.map((n) => {
    if (n.type === "output" && sourceOutputUUIDs.has(n.uuid)) {
      const targetUUID = outputMap.get(n.uuid);
      if (targetUUID) {
        return { ...n, uuid: targetUUID };
      }
      // Output not in target - will be removed
      return null;
    }
    return { ...n };
  }).filter((n) => n !== null);

  // Add new output neurons for target outputs not in source
  const existingOutputUUIDs = new Set(
    remappedNeurons.filter((n) => n.type === "output").map((n) => n.uuid),
  );
  for (let i = 0; i < targetOutputCount; i++) {
    const targetUUID = `output-${i}`;
    if (!existingOutputUUIDs.has(targetUUID)) {
      remappedNeurons.push({
        type: "output",
        uuid: targetUUID,
        bias: 0,
        squash: "LOGISTIC",
      });
    }
  }

  // Remap synapses: update UUIDs for inputs and outputs
  const remappedSynapses = source.synapses.map((s) => {
    let fromUUID = s.fromUUID;
    let toUUID = s.toUUID;

    // Remap source input UUID to target input UUID
    if (sourceInputUUIDs.has(fromUUID)) {
      const mapped = inputMap.get(fromUUID);
      if (!mapped) return null; // Source input not in target
      fromUUID = mapped;
    }

    // Remap source output UUID to target output UUID
    if (sourceOutputUUIDs.has(toUUID)) {
      const mapped = outputMap.get(toUUID);
      if (!mapped) return null; // Source output not in target
      toUUID = mapped;
    }

    if (sourceOutputUUIDs.has(fromUUID)) {
      const mapped = outputMap.get(fromUUID);
      if (!mapped) return null;
      fromUUID = mapped;
    }

    return { ...s, fromUUID, toUUID };
  }).filter((s) => s !== null);

  return {
    input: targetInputCount,
    output: targetOutputCount,
    neurons: remappedNeurons,
    synapses: remappedSynapses,
    semanticVersion: source.semanticVersion,
    forwardOnly: source.forwardOnly,
    tags: source.tags ? [...source.tags] : undefined,
  };
}
