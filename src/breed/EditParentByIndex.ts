import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { ValidationError } from "@errors/ValidationError.ts";
import { computeSimilarityAlignment } from "@breed/NeuronSimilarity.ts";

/**
 * Edits a target creature by remapping its unmatched hidden neurons to use
 * parent neuron UUIDs, enabling crossover between incompatible topologies.
 *
 * Issue #2174: Uses input-weight cosine similarity to align functionally
 * similar neurons before falling back to sequential mapping for any
 * remaining unmatched neurons.
 */
export function editParentByIndex(
  parent: Creature,
  target: Creature,
): Creature {
  const parentExport = parent.exportJSON();
  const targetExport = target.exportJSON();

  const targetSet = new Set<string>();
  targetExport.neurons.forEach((n) => {
    if (typeof n.uuid === "string") {
      targetSet.add(n.uuid);
    }
  });

  const parentNeuronSet = new Set<string>();
  parentExport.neurons.forEach((n) => {
    if (n.type === "hidden" && typeof n.uuid === "string") {
      parentNeuronSet.add(n.uuid);
    }
  });

  // Collect unmatched hidden neuron UUIDs for similarity alignment
  const unmatchedTargetUuids: string[] = [];
  for (const neuron of targetExport.neurons) {
    if (
      neuron.type === "hidden" &&
      typeof neuron.uuid === "string" &&
      !parentNeuronSet.has(neuron.uuid)
    ) {
      unmatchedTargetUuids.push(neuron.uuid);
    }
  }

  const unmatchedParentUuids: string[] = [];
  for (const neuron of parentExport.neurons) {
    if (
      neuron.type === "hidden" &&
      typeof neuron.uuid === "string" &&
      !targetSet.has(neuron.uuid)
    ) {
      unmatchedParentUuids.push(neuron.uuid);
    }
  }

  // Issue #2174: Use cosine similarity to align functionally similar neurons
  const { alignmentMap, remainingParentUuids, remainingTargetUuids } =
    computeSimilarityAlignment(
      parentExport,
      targetExport,
      unmatchedParentUuids,
      unmatchedTargetUuids,
    );

  // Build the complete target-to-parent UUID mapping:
  // 1. Similarity-based alignments
  // 2. Sequential fallback for remaining unmatched neurons
  const uuidMapping = new Map<string, string>(alignmentMap);

  const remainingParentIter = remainingParentUuids[Symbol.iterator]();
  for (const targetUuid of remainingTargetUuids) {
    const next = remainingParentIter.next();
    if (next.done) break;
    uuidMapping.set(targetUuid, next.value);
  }

  // Apply the UUID mapping to target neurons and synapses
  for (let index = 0; index < targetExport.neurons.length; index++) {
    const targetNeuron = targetExport.neurons[index];
    if (targetNeuron.type !== "hidden") continue;

    const targetUuid = targetNeuron.uuid;
    if (typeof targetUuid !== "string") continue;

    const parentUuid = uuidMapping.get(targetUuid);
    if (!parentUuid) continue;

    targetNeuron.uuid = parentUuid;
    targetSet.add(parentUuid);
    addTag(targetNeuron, "alias", targetUuid);
    addTag(targetNeuron, "approach", "graft");

    targetExport.synapses.forEach((synapse) => {
      if (synapse.fromUUID === targetUuid) {
        synapse.fromUUID = parentUuid;
      }
      if (synapse.toUUID === targetUuid) {
        synapse.toUUID = parentUuid;
      }
    });
  }

  const child = Creature.fromJSON(targetExport);
  try {
    child.validate();
  } catch (error) {
    if (error instanceof ValidationError) {
      if (error.reason === "MEMETIC") {
        delete child.memetic;
        child.fix();
        child.validate();
        return child;
      }
    }
    throw error;
  }
  return child;
}
