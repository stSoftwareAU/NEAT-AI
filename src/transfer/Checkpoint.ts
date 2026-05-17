/**
 * Checkpoint.ts - Export and import creatures as transfer learning checkpoints.
 *
 * Issue #1861: Provides functions to:
 * 1. Export a trained creature as a checkpoint with metadata
 * 2. Import a checkpoint to create a creature for a new task
 * 3. Handle UUID mapping between different input/output configurations
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { exportJSON } from "@creature/CreatureSerialization.ts";
import { nextNeuronId } from "@architecture/NeuronId.ts";
import type {
  CheckpointInterface,
  CheckpointMetadata,
} from "@transfer/CheckpointInterface.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { passesProducerCompileGate } from "@wasm/ProducerCompileGuard.ts";

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

  /** Neuron IDs to mark as frozen in the checkpoint */
  frozenNeuronIds?: number[];

  /** Synapse keys (fromId->toId) to mark as frozen */
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
  const creatureExport = exportJSON(creature);

  // Collect input IDs
  const sourceInputIds: number[] = [];
  for (let i = 0; i < creature.input; i++) {
    sourceInputIds.push(creature.neurons[i].id);
  }

  // Collect output IDs
  const sourceOutputIds: number[] = [];
  for (const neuron of creature.neurons) {
    if (neuron.type === "output") {
      sourceOutputIds.push(neuron.id);
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
    sourceInputIds,
    sourceOutputIds,
  };

  const checkpoint: CheckpointInterface = {
    version: "1.0.0",
    creature: creatureExport,
    metadata,
  };

  if (options?.frozenNeuronIds && options.frozenNeuronIds.length > 0) {
    checkpoint.frozenNeuronIds = [...options.frozenNeuronIds];
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
  inputIdMapping?: Map<number, number>;

  /**
   * UUID mapping from source output UUIDs to target output UUIDs.
   * Keys are source UUIDs, values are target UUIDs.
   * If not provided, outputs are mapped by position.
   */
  outputIdMapping?: Map<number, number>;

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
  normaliseCreatureExport(checkpoint.creature);
  const sourceCreature = checkpoint.creature;
  const targetInputCount = options?.targetInputCount ?? sourceCreature.input;
  const targetOutputCount = options?.targetOutputCount ?? sourceCreature.output;

  // If input/output counts match and no mapping needed, simple import
  if (
    targetInputCount === sourceCreature.input &&
    targetOutputCount === sourceCreature.output &&
    !options?.inputIdMapping &&
    !options?.outputIdMapping
  ) {
    const creature = Creature.fromJSON(sourceCreature, true);
    applyFreezeFlags(creature, checkpoint, options);
    gateImportedCheckpoint(creature);
    return creature;
  }

  // Build the remapped creature export
  const remapped = remapCreatureForTask(
    sourceCreature,
    checkpoint.metadata,
    targetInputCount,
    targetOutputCount,
    options?.inputIdMapping,
    options?.outputIdMapping,
  );

  const creature = Creature.fromJSON(remapped, true);
  applyFreezeFlags(creature, checkpoint, options);
  gateImportedCheckpoint(creature);
  return creature;
}

/**
 * Issue #2671: Run the producer-side WASM compile gate on an imported
 * checkpoint before handing it to the caller. On failure, throw a
 * `TopologyError` so the caller drops the checkpoint rather than letting
 * a bad topology contaminate the population.
 */
function gateImportedCheckpoint(creature: Creature): void {
  if (!passesProducerCompileGate(creature, "Checkpoint/import")) {
    throw new TopologyError(
      `[Checkpoint] imported creature fails WASM compile probe ` +
        `(neurons=${creature.neurons.length}, ` +
        `inputs=${creature.input}, outputs=${creature.output}); ` +
        `drop the checkpoint or repair its topology before retrying.`,
      "INVALID_CONNECTION",
    );
  }
}

/**
 * Applies freeze flags to a creature based on checkpoint and import options.
 */
function applyFreezeFlags(
  creature: Creature,
  checkpoint: CheckpointInterface,
  options?: CheckpointImportOptions,
): void {
  const frozenNeuronIds = new Set<number>(
    checkpoint.frozenNeuronIds ?? [],
  );

  if (options?.freezeHidden) {
    for (const neuron of creature.neurons) {
      if (neuron.type === "hidden") {
        frozenNeuronIds.add(neuron.id);
      }
    }
  }

  // Apply frozen flags to neurons
  for (const neuron of creature.neurons) {
    if (frozenNeuronIds.has(neuron.id)) {
      creature.setNeuronFrozen(neuron.index, true);
    }
  }

  // Apply frozen flags to synapses from checkpoint
  if (checkpoint.frozenSynapseKeys) {
    const synapseKeySet = new Set(checkpoint.frozenSynapseKeys);
    for (const synapse of creature.synapses) {
      const fromId = creature.neurons[synapse.from].id;
      const toId = creature.neurons[synapse.to].id;
      const key = `${fromId}->${toId}`;
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
  inputIdMapping?: Map<number, number>,
  outputIdMapping?: Map<number, number>,
): CreatureExport {
  // Build input UUID mapping (source UUID -> target UUID)
  const inputMap = new Map<number, number>();
  if (inputIdMapping) {
    for (const [sourceUUID, targetId] of inputIdMapping) {
      inputMap.set(sourceUUID, targetId);
    }
  } else {
    // Default: map by position for overlapping inputs
    const overlapInputs = Math.min(
      metadata.sourceInputCount,
      targetInputCount,
    );
    for (let i = 0; i < overlapInputs; i++) {
      inputMap.set(metadata.sourceInputIds[i], i);
    }
  }

  // Build output UUID mapping (source UUID -> target UUID)
  const outputMap = new Map<number, number>();
  if (outputIdMapping) {
    for (const [sourceUUID, targetId] of outputIdMapping) {
      outputMap.set(sourceUUID, targetId);
    }
  } else {
    // Default: map by position for overlapping outputs
    const overlapOutputs = Math.min(
      metadata.sourceOutputCount,
      targetOutputCount,
    );
    for (let i = 0; i < overlapOutputs; i++) {
      outputMap.set(metadata.sourceOutputIds[i], metadata.sourceOutputIds[i]);
    }
  }

  // Collect the set of source input UUIDs to know which synapses to remap
  const sourceInputIds = new Set(metadata.sourceInputIds);
  const sourceOutputIds = new Set(metadata.sourceOutputIds);

  // Remap neurons: keep hidden neurons as-is, remap outputs
  const remappedNeurons = source.neurons.map((n) => {
    if (n.type === "output" && sourceOutputIds.has(n.id!)) {
      const targetId = outputMap.get(n.id!);
      if (targetId) {
        return { ...n, id: targetId };
      }
      // Output not in target - will be removed
      return null;
    }
    return { ...n };
  }).filter((n) => n !== null);

  // Add new output neurons for target outputs not in source
  const existingOutputUUIDs = new Set(
    remappedNeurons.filter((n) => n.type === "output").map((n) => n.id),
  );
  for (let i = 0; i < targetOutputCount; i++) {
    if (existingOutputUUIDs.size < targetOutputCount) {
      const newId = nextNeuronId();
      remappedNeurons.push({
        type: "output",
        id: newId,
        bias: 0,
        squash: "LOGISTIC",
      });
      existingOutputUUIDs.add(newId);
    }
  }

  // Remap synapses: update UUIDs for inputs and outputs
  const remappedSynapses = source.synapses.map((s) => {
    let fromId = s.fromId!;
    let toId = s.toId!;

    // Remap source input UUID to target input UUID
    if (sourceInputIds.has(fromId)) {
      const mapped = inputMap.get(fromId);
      if (mapped === undefined) return null; // Source input not in target
      fromId = mapped;
    }

    // Remap source output UUID to target output UUID
    if (sourceOutputIds.has(toId!)) {
      const mapped = outputMap.get(toId!);
      if (mapped === undefined) return null; // Source output not in target
      toId = mapped;
    }

    if (sourceOutputIds.has(fromId!)) {
      const mapped = outputMap.get(fromId!);
      if (mapped === undefined) return null;
      fromId = mapped;
    }

    return { ...s, fromId, toId };
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
