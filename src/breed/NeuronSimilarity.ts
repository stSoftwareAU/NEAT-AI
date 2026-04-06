/**
 * Input-weight cosine similarity for neuron alignment during inter-species breeding.
 *
 * Issue #2174: When breeding creatures from different islands with no shared
 * neuron UUIDs and no matching connectivity keys, the fallback sequential
 * mapping in editParentByIndex is arbitrary. This module provides a
 * similarity-based alignment that considers each neuron's functional role
 * by comparing their input connection weight vectors.
 *
 * Approach:
 * 1. For each hidden neuron, build a sparse vector of incoming weights from
 *    input neurons (keyed by input UUID).
 * 2. Compute cosine similarity between all unmatched parent/target neuron pairs.
 * 3. Use greedy best-match to find the optimal neuron-to-neuron mapping.
 * 4. Fall back to sequential mapping for neurons with no meaningful input connections.
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

/**
 * Sparse weight vector: maps source UUID to weight value.
 * Only input connections are considered for similarity.
 */
type SparseWeightVector = Map<string, number>;

/**
 * Builds a sparse input-weight vector for a given neuron UUID.
 * The vector maps each source neuron UUID to its connection weight.
 *
 * @param neuronUuid - The UUID of the neuron to build the vector for
 * @param synapses - The creature's synapses
 * @returns Sparse weight vector mapping source UUID to weight
 */
export function buildInputWeightVector(
  neuronUuid: string,
  synapses: CreatureExport["synapses"],
): SparseWeightVector {
  const vector: SparseWeightVector = new Map();
  for (const synapse of synapses) {
    if (synapse.toUUID === neuronUuid && synapse.fromUUID) {
      vector.set(synapse.fromUUID, synapse.weight);
    }
  }
  return vector;
}

/**
 * Computes cosine similarity between two sparse weight vectors.
 *
 * cosine(A, B) = (A · B) / (|A| × |B|)
 *
 * Returns 0 when either vector is empty or has zero magnitude,
 * indicating no meaningful similarity can be determined.
 *
 * @param a - First sparse weight vector
 * @param b - Second sparse weight vector
 * @returns Cosine similarity in range [-1, 1], or 0 if undefined
 */
export function cosineSimilarity(
  a: SparseWeightVector,
  b: SparseWeightVector,
): number {
  if (a.size === 0 || b.size === 0) return 0;

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  // Iterate over the smaller vector for efficiency
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];

  for (const [key, valSmall] of smaller) {
    const valLarge = larger.get(key);
    if (valLarge !== undefined) {
      dotProduct += valSmall * valLarge;
    }
  }

  for (const val of a.values()) {
    magnitudeA += val * val;
  }
  for (const val of b.values()) {
    magnitudeB += val * val;
  }

  const denominator = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Represents a candidate neuron alignment with its similarity score.
 */
interface AlignmentCandidate {
  parentUuid: string;
  targetUuid: string;
  similarity: number;
}

/**
 * Computes an optimal neuron alignment between unmatched parent and target
 * hidden neurons using input-weight cosine similarity with greedy best-match.
 *
 * The algorithm:
 * 1. Builds input-weight vectors for all unmatched hidden neurons in both creatures
 * 2. Computes pairwise cosine similarity between parent and target neurons
 * 3. Greedily assigns best matches (highest similarity first)
 * 4. Remaining unmatched neurons are returned separately for sequential fallback
 *
 * @param parentExport - The parent creature export
 * @param targetExport - The target creature export
 * @param unmatchedParentUuids - Set of parent hidden neuron UUIDs not yet aligned
 * @param unmatchedTargetUuids - Set of target hidden neuron UUIDs not yet aligned
 * @returns Map from target UUID to parent UUID for similarity-aligned neurons,
 *          plus arrays of remaining unmatched UUIDs for sequential fallback
 */
export function computeSimilarityAlignment(
  parentExport: CreatureExport,
  targetExport: CreatureExport,
  unmatchedParentUuids: string[],
  unmatchedTargetUuids: string[],
): {
  alignmentMap: Map<string, string>;
  remainingParentUuids: string[];
  remainingTargetUuids: string[];
} {
  const alignmentMap = new Map<string, string>();

  if (unmatchedParentUuids.length === 0 || unmatchedTargetUuids.length === 0) {
    return {
      alignmentMap,
      remainingParentUuids: [...unmatchedParentUuids],
      remainingTargetUuids: [...unmatchedTargetUuids],
    };
  }

  // Build input-weight vectors for all unmatched neurons
  const parentVectors = new Map<string, SparseWeightVector>();
  for (const uuid of unmatchedParentUuids) {
    parentVectors.set(
      uuid,
      buildInputWeightVector(uuid, parentExport.synapses),
    );
  }

  const targetVectors = new Map<string, SparseWeightVector>();
  for (const uuid of unmatchedTargetUuids) {
    targetVectors.set(
      uuid,
      buildInputWeightVector(uuid, targetExport.synapses),
    );
  }

  // Compute all pairwise similarities
  const candidates: AlignmentCandidate[] = [];
  for (const [parentUuid, parentVec] of parentVectors) {
    for (const [targetUuid, targetVec] of targetVectors) {
      const similarity = cosineSimilarity(parentVec, targetVec);
      if (similarity > 0) {
        candidates.push({ parentUuid, targetUuid, similarity });
      }
    }
  }

  // Sort by descending similarity for greedy best-match
  candidates.sort((a, b) => b.similarity - a.similarity);

  // Greedy assignment: take best available match
  const usedParent = new Set<string>();
  const usedTarget = new Set<string>();

  for (const candidate of candidates) {
    if (
      usedParent.has(candidate.parentUuid) ||
      usedTarget.has(candidate.targetUuid)
    ) {
      continue;
    }
    alignmentMap.set(candidate.targetUuid, candidate.parentUuid);
    usedParent.add(candidate.parentUuid);
    usedTarget.add(candidate.targetUuid);
  }

  // Collect remaining unmatched UUIDs for sequential fallback
  const remainingParentUuids = unmatchedParentUuids.filter(
    (uuid) => !usedParent.has(uuid),
  );
  const remainingTargetUuids = unmatchedTargetUuids.filter(
    (uuid) => !usedTarget.has(uuid),
  );

  return { alignmentMap, remainingParentUuids, remainingTargetUuids };
}
