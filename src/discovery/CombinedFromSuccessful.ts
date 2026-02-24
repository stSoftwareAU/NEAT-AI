/**
 * Combined From Successful Module
 *
 * Builds combined (multi-step) discovery candidates from individually
 * successful single-step candidates, with multiple combination strategies.
 *
 * Extracted from CombinedCandidates.ts as part of #1598.
 */

import type { Creature } from "../Creature.ts";
import { getLogger } from "../utils/Logger.ts";
import { applyChangeToCreature } from "./CandidateApplication.ts";
import { buildCombinationDescription } from "./CandidateDescriptions.ts";
import type {
  DiscoveryCandidate,
  ScoredDiscoveryCandidate,
} from "./DiscoveryCandidates.ts";

/**
 * Build combined creatures from successful single candidates.
 *
 * This function is used in two-phase discovery scoring:
 * 1. Phase 1: Evaluate single candidates
 * 2. Phase 2: Call this function with successful candidates to create combinations
 *
 * Only combines candidates that have proven to improve score individually.
 * Generates multiple combination strategies to be evaluated in parallel:
 * - All successful candidates combined
 * - All removal candidates combined (if multiple exist)
 * - Pairwise combinations
 * - Triple combinations (for larger candidate sets)
 *
 * Since creature modifications can have unexpected results, we generate multiple
 * combinations and let parallel scoring determine the best one.
 *
 * @param baseCreature The original creature before any changes
 * @param _discoveryID The discovery session identifier
 * @param successfulCandidates Candidates that improved score in Phase 1
 * @returns Combined candidates to evaluate in Phase 2
 */
export function buildCombinedFromSuccessful(
  baseCreature: Creature,
  _discoveryID: string,
  successfulCandidates: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  // Coordinated structural candidates are already multi-step epistatic groups.
  // We intentionally do NOT combine them with other candidates in phase 2.
  successfulCandidates = successfulCandidates.filter((c) =>
    c.change.type !== "coordinated-structural"
  );
  if (successfulCandidates.length < 2) {
    return [];
  }

  const combinedCandidates: DiscoveryCandidate[] = [];
  // Track unique combinations to avoid duplicates
  const seenCombinations = new Set<string>();

  // Helper to create a combination key from candidate indices
  const makeCombinationKey = (indices: number[]): string =>
    [...indices].sort((a, b) => a - b).join(",");

  // Helper to build a combined creature from a subset of candidates
  const buildCombination = (
    candidates: DiscoveryCandidate[],
  ): DiscoveryCandidate | undefined => {
    let combinedCreature = baseCreature;
    let appliedCount = 0;
    const appliedTypes: string[] = [];

    for (const candidate of candidates) {
      const applied = applyChangeToCreature(
        combinedCreature,
        candidate,
        baseCreature,
      );
      if (applied && applied !== combinedCreature) {
        combinedCreature = applied;
        appliedCount++;
        if (!appliedTypes.includes(candidate.change.type)) {
          appliedTypes.push(candidate.change.type);
        }
      }
    }

    if (appliedCount >= 2 && combinedCreature !== baseCreature) {
      // Check if this is a removal-only combination
      const isRemovalOnly = appliedTypes.every((t) =>
        t === "remove-low-impact" || t === "remove-neuron" ||
        t === "remove-synapse"
      );
      const description = buildCombinationDescription(
        appliedTypes,
        appliedCount,
        isRemovalOnly,
      );
      return {
        creature: combinedCreature,
        change: {
          type: "combo-successful",
          description,
        },
      };
    }
    return undefined;
  };

  // Strategy 1: All successful candidates combined
  const allKey = makeCombinationKey(
    successfulCandidates.map((_, i) => i),
  );
  seenCombinations.add(allKey);
  const allCombined = buildCombination(successfulCandidates);
  if (allCombined) {
    combinedCandidates.push(allCombined);
  }

  // Strategy 2: All removal candidates combined (if there are multiple)
  // This is a key combination for cleaning up low-impact neurons
  const removalCandidates = successfulCandidates.filter(
    (c) =>
      c.change.type === "remove-low-impact" ||
      c.change.type === "remove-neuron" ||
      c.change.type === "remove-synapse",
  );
  if (removalCandidates.length >= 2) {
    const removalIndices = removalCandidates.map((c) =>
      successfulCandidates.indexOf(c)
    );
    const removalKey = makeCombinationKey(removalIndices);
    if (!seenCombinations.has(removalKey)) {
      seenCombinations.add(removalKey);
      const removalCombined = buildCombination(removalCandidates);
      if (removalCombined) {
        combinedCandidates.push(removalCombined);
      }
    }
  }

  // Strategy 3: All non-removal candidates combined (if there are multiple)
  const nonRemovalCandidates = successfulCandidates.filter(
    (c) =>
      c.change.type !== "remove-low-impact" &&
      c.change.type !== "remove-neuron" &&
      c.change.type !== "remove-synapse",
  );
  if (nonRemovalCandidates.length >= 2) {
    const nonRemovalIndices = nonRemovalCandidates.map((c) =>
      successfulCandidates.indexOf(c)
    );
    const nonRemovalKey = makeCombinationKey(nonRemovalIndices);
    if (!seenCombinations.has(nonRemovalKey)) {
      seenCombinations.add(nonRemovalKey);
      const nonRemovalCombined = buildCombination(nonRemovalCandidates);
      if (nonRemovalCombined) {
        combinedCandidates.push(nonRemovalCombined);
      }
    }
  }

  // Strategy 4: Pairwise combinations
  // Try all pairs to find which 2 changes work best together.
  // For sets > 10, sample the top candidates to keep the count manageable.
  if (successfulCandidates.length >= 2) {
    const pairLimit = Math.min(successfulCandidates.length, 10);
    for (let i = 0; i < pairLimit; i++) {
      for (let j = i + 1; j < pairLimit; j++) {
        const pairKey = makeCombinationKey([i, j]);
        if (seenCombinations.has(pairKey)) continue;
        seenCombinations.add(pairKey);

        const candidateA = successfulCandidates[i];
        const candidateB = successfulCandidates[j];

        const pairCombined = buildCombination([candidateA, candidateB]);
        if (pairCombined) {
          combinedCandidates.push(pairCombined);
        }
      }
    }
  }

  // Strategy 5: Triple combinations (for medium-sized candidate sets)
  // Try all triples for sets up to 8. For larger sets, sample the top
  // candidates to keep the combinatorial count sensible.
  if (successfulCandidates.length >= 4) {
    const tripleLimit = Math.min(successfulCandidates.length, 8);
    for (let i = 0; i < tripleLimit; i++) {
      for (let j = i + 1; j < tripleLimit; j++) {
        for (let k = j + 1; k < tripleLimit; k++) {
          const tripleKey = makeCombinationKey([i, j, k]);
          if (seenCombinations.has(tripleKey)) continue;
          seenCombinations.add(tripleKey);

          const tripleCandidates = [
            successfulCandidates[i],
            successfulCandidates[j],
            successfulCandidates[k],
          ];

          const tripleCombined = buildCombination(tripleCandidates);
          if (tripleCombined) {
            combinedCandidates.push(tripleCombined);
          }
        }
      }
    }
  }

  // Strategy 6: Leave-one-out combinations (#1417)
  // Address the concern that two "aggressive" candidates may score well
  // individually but negatively together. By trying all (N-1)-sized subsets,
  // we can identify which single candidate is the culprit when the full
  // combination underperforms. This is O(N) and runs in parallel, so there
  // is no real harm in trying these additional combinations.
  if (successfulCandidates.length >= 3) {
    for (
      let excluded = 0;
      excluded < successfulCandidates.length;
      excluded++
    ) {
      const subset = successfulCandidates.filter((_, i) => i !== excluded);
      const indices = successfulCandidates
        .map((_, i) => i)
        .filter((i) => i !== excluded);
      const looKey = makeCombinationKey(indices);
      if (seenCombinations.has(looKey)) continue;
      seenCombinations.add(looKey);

      const looCombined = buildCombination(subset);
      if (looCombined) {
        combinedCandidates.push(looCombined);
      }
    }
  }

  // Log summary of generated combinations
  if (combinedCandidates.length > 0) {
    getLogger().info(
      `[DiscoveryCandidates] Generated ${combinedCandidates.length} combination candidate${
        combinedCandidates.length === 1 ? "" : "s"
      } from ${successfulCandidates.length} successful singles`,
    );
  }

  return combinedCandidates;
}

/**
 * Reduce a set of successful single-step candidates into a sensible, non-conflicting
 * subset before building combination candidates.
 *
 * Rationale (production): discovery can surface multiple successful "alternatives"
 * for the same structural slot (eg multiple add-neurons from the same source to
 * the same target). Combining these alternatives is usually wasteful and can
 * suppress better cross-slot combinations. Instead, we keep the best candidate
 * per slot and allow combinations across different slots.
 */
export function pruneSuccessfulCandidatesForCombos(
  successfulCandidates: ScoredDiscoveryCandidate[],
): DiscoveryCandidate[] {
  if (successfulCandidates.length === 0) return [];

  const bestBySlot = new Map<string, ScoredDiscoveryCandidate>();
  const unkeyed: ScoredDiscoveryCandidate[] = [];

  for (const entry of successfulCandidates) {
    const slotKey = getComboSlotKey(entry.candidate);
    if (!slotKey) {
      unkeyed.push(entry);
      continue;
    }
    const current = bestBySlot.get(slotKey);
    if (!current || entry.scoreDelta > current.scoreDelta) {
      bestBySlot.set(slotKey, entry);
    }
  }

  const pruned = [...bestBySlot.values(), ...unkeyed]
    .sort((a, b) => {
      if (a.scoreDelta !== b.scoreDelta) return b.scoreDelta - a.scoreDelta;
      // Stable-ish tie-breaks for determinism.
      const typeA = a.candidate.change.type;
      const typeB = b.candidate.change.type;
      if (typeA !== typeB) return typeA.localeCompare(typeB);
      const descA = a.candidate.change.description ?? "";
      const descB = b.candidate.change.description ?? "";
      return descA.localeCompare(descB);
    })
    .map((e) => e.candidate);

  return pruned;
}

/**
 * Derive a slot key for a candidate, used to de-duplicate alternatives
 * that target the same structural location.
 */
function getComboSlotKey(candidate: DiscoveryCandidate): string | undefined {
  const change = candidate.change;
  switch (change.type) {
    case "add-neurons": {
      const from = change.neuronDetails?.fromNeuronUUID ??
        change.neuronCandidate?.fromNeuronUUID;
      const to = change.neuronDetails?.toNeuronUUID ??
        change.neuronCandidate?.toNeuronUUID;
      if (!from || !to) return undefined;
      return `add-neurons:${from}->${to}`;
    }
    case "add-synapses": {
      const from = change.synapseCandidate?.fromNeuronUUID;
      const to = change.synapseCandidate?.toNeuronUUID;
      if (!from || !to) return undefined;
      return `add-synapses:${from}->${to}`;
    }
    case "remove-synapse": {
      const details = change.synapseDetails;
      if (!details) return undefined;
      return `remove-synapse:${details.fromNeuronUUID}->${details.toNeuronUUID}`;
    }
    case "remove-low-impact": {
      const uuid = change.removalCandidate?.neuronUUID ??
        change.description?.match(/neuron\s+([a-zA-Z0-9_-]+)/i)?.[1];
      if (!uuid) return undefined;
      return `remove-neuron:${uuid}`;
    }
    case "remove-neuron": {
      const uuid = change.harmfulNeuronCandidate?.neuronUUID ??
        change.description?.match(/neuron\s+([a-zA-Z0-9_-]+)/i)?.[1];
      if (!uuid) return undefined;
      return `remove-neuron:${uuid}`;
    }
    case "change-squash": {
      const uuid = change.squashCandidate?.neuronUUID;
      if (!uuid) return undefined;
      return `change-squash:${uuid}`;
    }
    default:
      return undefined;
  }
}
