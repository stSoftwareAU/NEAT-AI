import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { ValidationError } from "@errors/ValidationError.ts";
import { computeSimilarityAlignment } from "@breed/NeuronAlignment.ts";

/**
 * Edits a target creature's hidden neuron UUIDs to align with a parent creature,
 * using input-weight cosine similarity to find functionally similar neurons.
 *
 * Issue #2174: Replaced sequential positional mapping with similarity-based
 * alignment. Neurons are matched by comparing their incoming weight vectors
 * from shared input neurons, so neurons with similar functional roles are
 * aligned even across different island topologies.
 *
 * Falls back to sequential mapping for neurons that have no meaningful
 * input connections (e.g., deep hidden neurons with only hidden-to-hidden
 * connections).
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

  // Issue #2174: Compute similarity-based alignment for unmatched neurons
  const similarityResult = computeSimilarityAlignment(
    parentExport,
    targetExport,
    parentNeuronSet,
    targetSet,
  );

  // Track which parent UUIDs have been consumed by similarity alignment
  const usedParentUuids = new Set<string>(similarityResult.mapping.values());

  // Sequential fallback index for neurons not matched by similarity
  let parentIndx = 0;

  for (let index = 0; index < targetExport.neurons.length; index++) {
    const targetNeuron = targetExport.neurons[index];
    if (targetNeuron.type === "hidden") {
      const targetUuid = targetNeuron.uuid;
      if (
        typeof targetUuid === "string" && !parentNeuronSet.has(targetUuid)
      ) {
        // Check similarity-based alignment first
        const similarParentUuid = similarityResult.mapping.get(targetUuid);
        if (similarParentUuid) {
          targetNeuron.uuid = similarParentUuid;
          targetSet.add(similarParentUuid);
          addTag(targetNeuron, "alias", targetUuid);
          addTag(targetNeuron, "approach", "graft");
          targetExport.synapses.forEach((synapse) => {
            if (synapse.fromUUID === targetUuid) {
              synapse.fromUUID = similarParentUuid;
            }
            if (synapse.toUUID === targetUuid) {
              synapse.toUUID = similarParentUuid;
            }
          });
          continue;
        }

        // Sequential fallback for neurons without meaningful similarity
        while (parentIndx < parentExport.neurons.length) {
          const parentNeuron = parentExport.neurons[parentIndx];
          parentIndx++;
          if (
            parentNeuron.type === "hidden" &&
            typeof parentNeuron.uuid === "string" &&
            !targetSet.has(parentNeuron.uuid) &&
            !usedParentUuids.has(parentNeuron.uuid)
          ) {
            targetNeuron.uuid = parentNeuron.uuid;
            targetSet.add(parentNeuron.uuid);
            addTag(targetNeuron, "alias", targetUuid);
            addTag(targetNeuron, "approach", "graft");
            targetExport.synapses.forEach((synapse) => {
              if (synapse.fromUUID === targetUuid) {
                synapse.fromUUID = parentNeuron.uuid!;
              }
              if (synapse.toUUID === targetUuid) {
                synapse.toUUID = parentNeuron.uuid!;
              }
            });
            break;
          }
        }
      }
    }
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
