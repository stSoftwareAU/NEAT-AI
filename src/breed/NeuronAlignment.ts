/**
 * Input-weight cosine similarity-based neuron alignment for inter-species breeding.
 *
 * Issue #2174: When breeding creatures from different islands, UUID matching
 * and connectivity key matching both fail completely. This module replaces the
 * sequential fallback with a functional similarity-based alignment that
 * considers each neuron's actual role via its input connection weight vectors.
 *
 * Since both creatures share the same input neurons, hidden neurons can be
 * compared by their incoming weight vectors from those shared inputs. Cosine
 * similarity measures how similar two neurons' input weight patterns are,
 * regardless of magnitude differences.
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

/**
 * Sparse input weight vector for a hidden neuron.
 * Maps input neuron UUID to connection weight.
 */
type InputWeightVector = Map<string, number>;

/**
 * Builds a sparse input weight vector for a neuron based on its incoming
 * connections from input neurons.
 *
 * @param neuronUuid - UUID of the target neuron
 * @param synapses - All synapses in the creature export
 * @param inputCount - Number of input neurons in the creature
 * @returns Sparse vector mapping input UUIDs to weights
 */
export function buildInputWeightVector(
  neuronUuid: string,
  synapses: CreatureExport["synapses"],
  inputCount: number,
): InputWeightVector {
  const vector: InputWeightVector = new Map();

  for (const synapse of synapses) {
    if (synapse.toUUID !== neuronUuid) continue;

    const fromUUID = synapse.fromUUID;
    if (typeof fromUUID !== "string") continue;

    // Only consider connections from input neurons
    if (fromUUID.startsWith("input-")) {
      const inputIndex = parseInt(fromUUID.substring(6), 10);
      if (inputIndex >= 0 && inputIndex < inputCount) {
        vector.set(fromUUID, synapse.weight);
      }
    }
  }

  return vector;
}

/**
 * Computes cosine similarity between two sparse input weight vectors.
 *
 * cosine_similarity = dot(a, b) / (|a| * |b|)
 *
 * Returns 0 if either vector is empty or has zero magnitude.
 * Returns a value in [-1, 1] where 1 means identical direction.
 *
 * @param a - First sparse vector
 * @param b - Second sparse vector
 * @returns Cosine similarity score
 */
export function cosineSimilarity(
  a: InputWeightVector,
  b: InputWeightVector,
): number {
  if (a.size === 0 || b.size === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  // Compute dot product over shared keys
  for (const [key, valueA] of a) {
    const valueB = b.get(key);
    if (valueB !== undefined) {
      dot += valueA * valueB;
    }
    magA += valueA * valueA;
  }

  for (const valueB of b.values()) {
    magB += valueB * valueB;
  }

  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  if (denominator === 0) return 0;

  return dot / denominator;
}

/**
 * Result of neuron alignment: maps target neuron index to parent neuron index.
 */
export interface AlignmentResult {
  /** Maps target hidden neuron UUID to matched parent hidden neuron UUID */
  mapping: Map<string, string>;
}

/**
 * Computes a similarity-based neuron alignment between parent and target
 * creatures using input-weight cosine similarity.
 *
 * Uses a greedy best-match approach: iteratively picks the highest-similarity
 * pair from the remaining unmatched neurons until no more meaningful matches
 * exist.
 *
 * @param parentExport - Exported parent creature
 * @param targetExport - Exported target creature
 * @param parentNeuronSet - Set of parent hidden neuron UUIDs
 * @param targetSet - Set of all target neuron UUIDs (used to skip already-matched)
 * @returns Alignment mapping from target UUIDs to parent UUIDs
 */
export function computeSimilarityAlignment(
  parentExport: CreatureExport,
  targetExport: CreatureExport,
  parentNeuronSet: Set<string>,
  targetSet: Set<string>,
): AlignmentResult {
  const mapping = new Map<string, string>();

  // Collect unmatched hidden neurons from parent
  const unmatchedParent: string[] = [];
  for (const n of parentExport.neurons) {
    if (
      n.type === "hidden" &&
      typeof n.uuid === "string" &&
      !targetSet.has(n.uuid)
    ) {
      unmatchedParent.push(n.uuid);
    }
  }

  // Collect unmatched hidden neurons from target
  const unmatchedTarget: string[] = [];
  for (const n of targetExport.neurons) {
    if (
      n.type === "hidden" &&
      typeof n.uuid === "string" &&
      !parentNeuronSet.has(n.uuid)
    ) {
      unmatchedTarget.push(n.uuid);
    }
  }

  if (unmatchedParent.length === 0 || unmatchedTarget.length === 0) {
    return { mapping };
  }

  // Build input weight vectors for all unmatched neurons
  const parentVectors = new Map<string, InputWeightVector>();
  for (const uuid of unmatchedParent) {
    parentVectors.set(
      uuid,
      buildInputWeightVector(uuid, parentExport.synapses, parentExport.input),
    );
  }

  const targetVectors = new Map<string, InputWeightVector>();
  for (const uuid of unmatchedTarget) {
    targetVectors.set(
      uuid,
      buildInputWeightVector(uuid, targetExport.synapses, targetExport.input),
    );
  }

  // Build similarity matrix as a flat list of scored pairs
  const pairs: { targetUuid: string; parentUuid: string; score: number }[] = [];
  for (const [targetUuid, targetVec] of targetVectors) {
    for (const [parentUuid, parentVec] of parentVectors) {
      const score = cosineSimilarity(targetVec, parentVec);
      if (score > 0) {
        pairs.push({ targetUuid, parentUuid, score });
      }
    }
  }

  // Sort by descending similarity for greedy matching
  pairs.sort((a, b) => b.score - a.score);

  // Greedy best-match: pick highest similarity pairs first
  const usedParent = new Set<string>();
  const usedTarget = new Set<string>();

  for (const pair of pairs) {
    if (usedTarget.has(pair.targetUuid) || usedParent.has(pair.parentUuid)) {
      continue;
    }
    mapping.set(pair.targetUuid, pair.parentUuid);
    usedTarget.add(pair.targetUuid);
    usedParent.add(pair.parentUuid);
  }

  return { mapping };
}
