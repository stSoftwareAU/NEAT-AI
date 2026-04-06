/**
 * Input-weight crossover strategy for genetically incompatible creatures
 * (Issue #2175).
 *
 * When two creatures share no hidden neuron UUIDs (zero genetic compatibility),
 * standard crossover produces essentially random combinations. This module
 * provides a meaningful alternative by:
 *
 * 1. Using the mother's full topology as the base
 * 2. Blending input/output connection weights from both parents
 * 3. Preserving the mother's hidden-layer structure intact
 *
 * The father's influence is incorporated through weight blending at the
 * input and output boundaries — the shared interface between any two
 * creatures with the same input/output dimensions.
 */

import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  buildInputWeightVector,
  computeSimilarityAlignment,
} from "@breed/NeuronSimilarity.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";

/**
 * Builds a map from neuron UUID to the weight of connections going to
 * any of the specified output neuron UUIDs.
 */
function buildOutputLayerWeights(
  creature: CreatureExport,
  outputUuids: Set<string>,
): Map<string, number> {
  const weights = new Map<string, number>();
  for (const syn of creature.synapses) {
    if (syn.fromUUID && syn.toUUID && outputUuids.has(syn.toUUID)) {
      weights.set(`${syn.fromUUID}->${syn.toUUID}`, syn.weight);
    }
  }
  return weights;
}

/**
 * Performs input-weight crossover between two genetically incompatible parents.
 *
 * The strategy:
 * 1. Clone the mother's full topology
 * 2. Find aligned father neurons using cosine similarity of input-weight vectors
 * 3. For each input connection in the mother, blend with the aligned father
 *    neuron's weight for the same input (mother-biased: α ∈ [0.6, 0.9])
 * 4. For output connections, blend similarly
 * 5. Where only one parent uses an input, scale the weight by 0.5
 *
 * @param mother - The mother creature (topology donor)
 * @param father - The father creature (weight donor)
 * @returns A new offspring creature, or undefined if creation fails
 */
export function inputWeightCrossover(
  mother: Creature,
  father: Creature,
): Creature | undefined {
  const rng = getRandomNumberGenerator();

  const motherExport = mother.exportJSON();
  const fatherExport = father.exportJSON();

  // Collect hidden neuron UUIDs from both parents
  const motherHiddenUuids: string[] = [];
  const fatherHiddenUuids: string[] = [];
  for (const n of motherExport.neurons) {
    if (n.type === "hidden" && typeof n.uuid === "string") {
      motherHiddenUuids.push(n.uuid);
    }
  }
  for (const n of fatherExport.neurons) {
    if (n.type === "hidden" && typeof n.uuid === "string") {
      fatherHiddenUuids.push(n.uuid);
    }
  }

  // Use cosine similarity to align mother's hidden neurons to father's
  const { alignmentMap, remainingParentUuids, remainingTargetUuids } =
    computeSimilarityAlignment(
      fatherExport,
      motherExport,
      fatherHiddenUuids,
      motherHiddenUuids,
    );
  // alignmentMap: motherUuid -> fatherUuid

  // Sequential fallback for neurons not aligned by similarity
  const remainingFatherIter = remainingParentUuids[Symbol.iterator]();
  for (const motherUuid of remainingTargetUuids) {
    const next = remainingFatherIter.next();
    if (next.done) break;
    alignmentMap.set(motherUuid, next.value);
  }

  // Build father weight vectors keyed by father neuron UUID
  const fatherVectors = new Map<string, Map<string, number>>();
  for (const fatherUuid of fatherHiddenUuids) {
    fatherVectors.set(
      fatherUuid,
      buildInputWeightVector(fatherUuid, fatherExport.synapses),
    );
  }

  // Collect output UUIDs
  const outputUuids = new Set<string>();
  for (const n of motherExport.neurons) {
    if (n.type === "output" && typeof n.uuid === "string") {
      outputUuids.add(n.uuid);
    }
  }

  // Build father's output weight map for blending
  const fatherOutputWeights = buildOutputLayerWeights(
    fatherExport,
    outputUuids,
  );

  // Clone mother's export as the offspring base
  const offspringExport: CreatureExport = {
    input: motherExport.input,
    output: motherExport.output,
    neurons: motherExport.neurons.map((n) => ({ ...n })),
    synapses: motherExport.synapses.map((s) => ({ ...s })),
    forwardOnly: motherExport.forwardOnly,
  };

  // Mother-biased blending factor: α ∈ [0.6, 0.9]
  const alpha = 0.6 + rng.random() * 0.3;

  // Blend input connection weights
  for (const syn of offspringExport.synapses) {
    if (
      !syn.fromUUID ||
      !syn.toUUID ||
      !syn.fromUUID.startsWith("input-")
    ) {
      continue;
    }

    const motherNeuronUuid = syn.toUUID;
    const alignedFatherUuid = alignmentMap.get(motherNeuronUuid);

    if (alignedFatherUuid) {
      // Father has an aligned neuron — blend weights for this input
      const fatherVec = fatherVectors.get(alignedFatherUuid);
      const fatherWeight = fatherVec?.get(syn.fromUUID);

      if (fatherWeight !== undefined) {
        // Both parents use this input: blend
        syn.weight = alpha * syn.weight + (1 - alpha) * fatherWeight;
      }
      // Only mother uses this input: keep mother's weight unchanged
    }
    // No alignment found: keep mother's weight unchanged
  }

  // Blend output connection weights
  for (const syn of offspringExport.synapses) {
    if (!syn.fromUUID || !syn.toUUID || !outputUuids.has(syn.toUUID)) {
      continue;
    }

    // Check if the father has a corresponding output connection
    // from any aligned neuron to this output
    const motherFromUuid = syn.fromUUID;
    const alignedFatherUuid = alignmentMap.get(motherFromUuid);

    if (alignedFatherUuid) {
      const key = `${alignedFatherUuid}->${syn.toUUID}`;
      const fatherWeight = fatherOutputWeights.get(key);
      if (fatherWeight !== undefined) {
        syn.weight = alpha * syn.weight + (1 - alpha) * fatherWeight;
      }
    }
  }

  // Also incorporate father's unique input preferences:
  // For inputs that the father connects to (via aligned neurons) but the
  // mother doesn't, add new connections with scaled father weight
  const motherHiddenSet = new Set(motherHiddenUuids);
  const existingInputConns = new Set<string>();
  for (const syn of offspringExport.synapses) {
    if (syn.fromUUID?.startsWith("input-") && syn.toUUID) {
      existingInputConns.add(`${syn.fromUUID}->${syn.toUUID}`);
    }
  }

  for (const [motherUuid, fatherUuid] of alignmentMap) {
    if (!motherHiddenSet.has(motherUuid)) continue;

    const fatherVec = fatherVectors.get(fatherUuid);
    if (!fatherVec) continue;

    for (const [inputUuid, fatherWeight] of fatherVec) {
      // Only add connections from actual input neurons, not from
      // father's hidden neurons which don't exist in the offspring
      if (!inputUuid.startsWith("input-")) continue;

      const key = `${inputUuid}->${motherUuid}`;
      if (!existingInputConns.has(key)) {
        // Father uses this input but mother doesn't — add with reduced weight
        offspringExport.synapses.push({
          fromUUID: inputUuid,
          toUUID: motherUuid,
          weight: fatherWeight * 0.5,
        });
        existingInputConns.add(key);
      }
    }
  }

  const offspring = Creature.fromJSON(offspringExport);
  offspring.fix();

  delete offspring.uuid;
  const childUUID = CreatureUtil.makeUUID(offspring);
  if (!childUUID) return undefined;

  // Reject clones of either parent
  CreatureUtil.makeUUID(mother);
  CreatureUtil.makeUUID(father);
  if (childUUID === mother.uuid || childUUID === father.uuid) {
    return undefined;
  }

  return offspring;
}
