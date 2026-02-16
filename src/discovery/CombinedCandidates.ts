/**
 * Combined Candidates Module
 *
 * Builds combined (multi-step) discovery candidates from individual changes,
 * including phase-2 combination strategies and candidate pruning.
 *
 * Extracted from DiscoveryCandidates.ts as part of #1473.
 */

import {
  type CandidateHarmfulNeuron,
  type CandidateNeuron,
  type CandidateSquash,
  type CandidateSynapse,
  DiscoverStructure,
} from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { cleanupMemeticForRemovedSynapse } from "../compact/CompactUtils.ts";
import { Creature } from "../Creature.ts";
import type { DiscoverResult } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { getLogger } from "../utils/Logger.ts";
import {
  applyChangeToCreature,
  validateAndFixCreatureSync,
} from "./CandidateApplication.ts";
import {
  buildCombinationDescription,
  shortID,
} from "./CandidateDescriptions.ts";
import {
  mapScaledSummaryEntries,
  summariseExpectedImprovement,
} from "./CandidateScoring.ts";
import type {
  DiscoveryCandidate,
  DiscoveryChangeType,
  ScoredDiscoveryCandidate,
} from "./DiscoveryCandidates.ts";

export interface CombinedSelection {
  addHelpfulSynapses?: CandidateSynapse[];
  addHelpfulNeurons?: CandidateNeuron[];
  removeHarmfulSynapse?: CandidateSynapse;
  removeHarmfulNeurons?: CandidateHarmfulNeuron[];
  candidateSquashes?: CandidateSquash[];
}

export interface CombinedCandidateArgs {
  baseCreature: Creature;
  discoveryID: string;
  selection: CombinedSelection;
  changeType: DiscoveryChangeType;
  description: string;
  discoveryFailureCacheDir?: string;
}

export interface ScalingFunctions {
  synapse: (synapse: CandidateSynapse) => number | undefined;
  neuron: (neuron: CandidateNeuron) => number | undefined;
  squash: (squash: CandidateSquash) => number | undefined;
}

/**
 * Build a combined candidate by applying multiple discovery changes sequentially.
 *
 * Requires at least 2 categories to be selected; returns `undefined` if fewer
 * than 2 changes were actually applied.
 */
export function buildCombinedCandidate(
  args: CombinedCandidateArgs,
): DiscoveryCandidate | undefined {
  const {
    baseCreature,
    discoveryID,
    selection,
    changeType,
    description,
    discoveryFailureCacheDir,
  } = args;

  const requestedCategories = [
    Boolean(selection.addHelpfulNeurons?.length),
    Boolean(selection.addHelpfulSynapses?.length),
    Boolean(selection.removeHarmfulSynapse),
    Boolean(selection.removeHarmfulNeurons?.length),
    Boolean(selection.candidateSquashes?.length),
  ].filter(Boolean).length;
  if (requestedCategories < 2) {
    return undefined;
  }

  let combinedCreature = baseCreature;
  const appliedLabels: string[] = [];

  const applyChange = (
    label: string,
    mutator: (() => Creature | undefined) | undefined,
  ) => {
    if (!mutator) return;
    const updated = mutator();
    if (updated && updated !== combinedCreature) {
      combinedCreature = updated;
      appliedLabels.push(label);
    }
  };

  applyChange(
    `add-neurons: ${selection.addHelpfulNeurons?.length ?? 0}`,
    selection.addHelpfulNeurons && selection.addHelpfulNeurons.length > 0
      ? () =>
        DiscoverStructure.addHelpfulNeurons(
          discoveryID,
          combinedCreature,
          selection.addHelpfulNeurons,
          discoveryFailureCacheDir,
        )
      : undefined,
  );

  applyChange(
    `add-synapses: ${selection.addHelpfulSynapses?.length ?? 0}`,
    selection.addHelpfulSynapses && selection.addHelpfulSynapses.length > 0
      ? () =>
        DiscoverStructure.addHelpfulSynapses(
          discoveryID,
          combinedCreature,
          selection.addHelpfulSynapses,
          discoveryFailureCacheDir,
        )
      : undefined,
  );

  applyChange(
    `change-squash: ${selection.candidateSquashes?.length ?? 0}`,
    selection.candidateSquashes && selection.candidateSquashes.length > 0
      ? () =>
        DiscoverStructure.changeSquash(
          discoveryID,
          combinedCreature,
          selection.candidateSquashes,
          discoveryFailureCacheDir,
        )
      : undefined,
  );

  // Apply neuron removal before synapse removal
  applyChange(
    `remove-neuron: ${selection.removeHarmfulNeurons?.length ?? 0}`,
    selection.removeHarmfulNeurons &&
      selection.removeHarmfulNeurons.length > 0
      ? () =>
        DiscoverStructure.removeHarmfulNeuron(
          discoveryID,
          combinedCreature,
          selection.removeHarmfulNeurons![0],
          discoveryFailureCacheDir,
        )
      : undefined,
  );

  // Apply synapse removal last to ensure it happens even after other changes
  if (selection.removeHarmfulSynapse) {
    const updated = persistentlyRemoveHarmfulSynapse(
      combinedCreature,
      selection.removeHarmfulSynapse,
    );
    if (updated !== combinedCreature) {
      combinedCreature = updated;
      appliedLabels.push("remove-synapse");
    }
  }

  if (appliedLabels.length < 2 || combinedCreature === baseCreature) {
    return undefined;
  }

  return {
    creature: combinedCreature,
    change: {
      type: changeType,
      description: `${description} (${appliedLabels.join(", ")})`,
    },
  };
}

/**
 * Build a "best of each category" combined candidate.
 *
 * Picks the single highest-scoring entry from each discovery category,
 * then passes them to `buildCombinedCandidate`.
 */
export function buildBestOfCategoryCandidate(
  baseCreature: Creature,
  discovery: DiscoverResult,
  scaleFns: ScalingFunctions,
  discoveryFailureCacheDir?: string,
): DiscoveryCandidate | undefined {
  const bestSelection: CombinedSelection = {
    addHelpfulSynapses: wrapBestCandidate(
      discovery.addHelpfulSynapses,
      scaleFns.synapse,
    ),
    addHelpfulNeurons: wrapBestCandidate(
      discovery.addHelpfulNeurons,
      scaleFns.neuron,
    ),
    candidateSquashes: wrapBestCandidate(
      discovery.candidateSquashes,
      scaleFns.squash,
    ),
    removeHarmfulSynapse: discovery.removeHarmfulSynapse,
    removeHarmfulNeurons: discovery.removeHarmfulNeurons?.[0]
      ? [discovery.removeHarmfulNeurons[0]]
      : undefined,
  };

  return buildCombinedCandidate({
    baseCreature,
    discoveryID: discovery.ID,
    selection: bestSelection,
    changeType: "combo-best-of-category",
    description: "⭐ Combined best discovery changes",
    discoveryFailureCacheDir,
  });
}

/**
 * Wrap the single best-scoring entry from a candidate array into a 1-element array.
 */
export function wrapBestCandidate<
  T extends { expectedCreatureScoreGain?: number },
>(
  entries: T[] | undefined,
  scoreSelector?: (entry: T) => number | undefined,
): T[] | undefined {
  if (!entries || entries.length === 0) {
    return undefined;
  }
  const best = entries.reduce((currentBest: T | undefined, candidate) => {
    if (!currentBest) return candidate;
    const bestScore = scoreSelector
      ? scoreSelector(currentBest) ?? Number.NEGATIVE_INFINITY
      : currentBest.expectedCreatureScoreGain ?? Number.NEGATIVE_INFINITY;
    const candidateScore = scoreSelector
      ? scoreSelector(candidate) ?? Number.NEGATIVE_INFINITY
      : candidate.expectedCreatureScoreGain ?? Number.NEGATIVE_INFINITY;
    if (candidateScore > bestScore) {
      return candidate;
    }
    return currentBest;
  }, undefined);
  return best ? [best] : undefined;
}

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

/**
 * Persistently remove a harmful synapse from a creature, retrying if
 * `fix()` re-adds it. Returns the original creature if no removal occurred.
 */
export function persistentlyRemoveHarmfulSynapse(
  creature: Creature,
  harmfulSynapse: CandidateSynapse,
): Creature {
  const removalUUID = {
    from: harmfulSynapse.fromNeuronUUID,
    to: harmfulSynapse.toNeuronUUID,
  };

  // Keep removing until it's definitely gone (fix() might re-add it)
  let currentCreature = creature;
  let removed = false;
  let attempts = 0;
  const maxAttempts = 10; // Prevent infinite loops

  while (attempts < maxAttempts) {
    const exportJSON = currentCreature.exportJSON();
    const originalCount = exportJSON.synapses.length;
    exportJSON.synapses = exportJSON.synapses.filter((synapse) =>
      !(synapse.fromUUID === removalUUID.from &&
        synapse.toUUID === removalUUID.to)
    );

    if (exportJSON.synapses.length < originalCount) {
      removed = true;
      // Clean up memetic data for the removed synapse
      cleanupMemeticForRemovedSynapse(
        exportJSON,
        removalUUID.from,
        removalUUID.to,
      );

      const updated = Creature.fromJSON(exportJSON);
      // We modified the structure by filtering synapses, so we must delete UUID
      delete updated.uuid;
      validateAndFixCreatureSync(updated, "remove-synapse");

      // Verify it's still removed after fix()
      const verifyJSON = updated.exportJSON();
      const stillExists = verifyJSON.synapses.some((synapse) =>
        synapse.fromUUID === removalUUID.from &&
        synapse.toUUID === removalUUID.to
      );

      if (!stillExists) {
        // Successfully removed and stayed removed
        return updated;
      }
      // Still exists, try again
      currentCreature = updated;
    } else {
      // Synapse doesn't exist, we're done
      break;
    }
    attempts++;
  }

  return removed ? currentCreature : creature;
}

/**
 * Build a combined "all neurons" candidate by applying all neuron suggestions at once.
 *
 * Returns the combined creature (for use in combo building) and the candidate entry.
 */
export function buildCombinedNeuronCandidate(
  discoveryID: string,
  baseCreature: Creature,
  helpfulNeuronCandidates: CandidateNeuron[] | undefined,
  getExpectedNeuron: (c: CandidateNeuron) => number | undefined,
  discoveryFailureCacheDir?: string,
): {
  creature: Creature | undefined;
  candidate: DiscoveryCandidate | undefined;
} {
  if (!helpfulNeuronCandidates || helpfulNeuronCandidates.length === 0) {
    return { creature: undefined, candidate: undefined };
  }

  const addedNeuronCreature = DiscoverStructure.addHelpfulNeurons(
    discoveryID,
    baseCreature,
    helpfulNeuronCandidates,
    discoveryFailureCacheDir,
  );

  if (addedNeuronCreature) {
    const neuronSummary = summariseExpectedImprovement(
      mapScaledSummaryEntries(
        helpfulNeuronCandidates,
        getExpectedNeuron,
        (candidate) => candidate.totalCount,
      ),
    );
    return {
      creature: addedNeuronCreature,
      candidate: {
        creature: addedNeuronCreature,
        change: {
          type: "add-neurons",
          description:
            `💡 Added ${helpfulNeuronCandidates.length} helpful neuron${
              helpfulNeuronCandidates.length === 1 ? "" : "s"
            }`,
          expectedErrorReduction: neuronSummary.average,
          sampleSize: neuronSummary.sampleSize,
        },
      },
    };
  }

  getLogger().info(
    `[DiscoveryCandidates] Combined add-neurons candidate not created (${helpfulNeuronCandidates.length} neuron${
      helpfulNeuronCandidates.length === 1 ? "" : "s"
    } suggested but structure change returned undefined)`,
  );
  return { creature: undefined, candidate: undefined };
}

/**
 * Build a combined "all synapses" candidate by applying all synapse suggestions at once.
 *
 * Returns the combined creature (for use in combo building) and the candidate entry.
 */
export function buildCombinedSynapseCandidate(
  discoveryID: string,
  baseCreature: Creature,
  addHelpfulSynapses: CandidateSynapse[] | undefined,
  getExpectedSynapse: (c: CandidateSynapse) => number | undefined,
  discoveryFailureCacheDir?: string,
): {
  creature: Creature | undefined;
  candidate: DiscoveryCandidate | undefined;
} {
  const addedSynapseCreature = DiscoverStructure.addHelpfulSynapses(
    discoveryID,
    baseCreature,
    addHelpfulSynapses,
    discoveryFailureCacheDir,
  );

  if (addedSynapseCreature) {
    const synapseSummary = summariseExpectedImprovement(
      mapScaledSummaryEntries(
        addHelpfulSynapses,
        getExpectedSynapse,
        (candidate) => candidate.totalCount,
      ),
    );
    return {
      creature: addedSynapseCreature,
      candidate: {
        creature: addedSynapseCreature,
        change: {
          type: "add-synapses",
          description: `🔗 Added ${
            addHelpfulSynapses?.length ?? 0
          } helpful synapse${
            (addHelpfulSynapses?.length ?? 0) === 1 ? "" : "s"
          }`,
          expectedErrorReduction: synapseSummary.average,
          sampleSize: synapseSummary.sampleSize,
        },
      },
    };
  }

  if (addHelpfulSynapses && addHelpfulSynapses.length > 0) {
    getLogger().info(
      `[DiscoveryCandidates] Combined add-synapses candidate not created (${addHelpfulSynapses.length} synapse${
        addHelpfulSynapses.length === 1 ? "" : "s"
      } suggested but structure change returned undefined)`,
    );
  }
  return { creature: undefined, candidate: undefined };
}

/**
 * Build a combined "all squash changes" candidate and optional combo-add-change candidate.
 *
 * Returns the combined creature (for use in combo building) and all candidates produced.
 */
export function buildCombinedSquashCandidates(
  discoveryID: string,
  baseCreature: Creature,
  candidateSquashes: CandidateSquash[] | undefined,
  addHelpfulSynapses: CandidateSynapse[] | undefined,
  addedSynapseCreature: Creature | undefined,
  getExpectedSquash: (c: CandidateSquash) => number | undefined,
  discoveryFailureCacheDir?: string,
): { creature: Creature | undefined; candidates: DiscoveryCandidate[] } {
  const candidates: DiscoveryCandidate[] = [];

  const changedSquashCreature = DiscoverStructure.changeSquash(
    discoveryID,
    baseCreature,
    candidateSquashes,
    discoveryFailureCacheDir,
  );

  if (changedSquashCreature) {
    const changes = (candidateSquashes || []).map((c) => {
      const neuron = baseCreature.neurons.find((n) => n.uuid === c.neuronUUID);
      const oldSquash = neuron?.squash;
      const improvementValue = getExpectedSquash(c);
      const improvement = improvementValue !== undefined
        ? ` expected: ${(improvementValue * 100).toFixed(1)}%`
        : "";
      return `${
        shortID(c.neuronUUID)
      } (${oldSquash} -> ${c.squash}${improvement})`;
    });

    const description = changes.length <= 3
      ? `🎨 Changed activation function for ${changes.join(", ")}`
      : `🎨 Changed activation function on ${changes.length} high-error neurons`;
    const squashSummary = summariseExpectedImprovement(
      mapScaledSummaryEntries(candidateSquashes, getExpectedSquash),
    );

    candidates.push({
      creature: changedSquashCreature,
      change: {
        type: "change-squash",
        description,
        expectedErrorReduction: squashSummary.average,
        sampleSize: squashSummary.sampleSize,
      },
    });

    // Build combo-add-change candidate
    if (addedSynapseCreature) {
      const combinedAddChange = DiscoverStructure.changeSquash(
        discoveryID,
        addedSynapseCreature,
        candidateSquashes,
        discoveryFailureCacheDir,
      );
      if (combinedAddChange) {
        const synCount = addHelpfulSynapses?.length ?? 0;
        const sqCount = candidateSquashes?.length ?? 0;
        candidates.push({
          creature: combinedAddChange,
          change: {
            type: "combo-add-change",
            description: `⚡ Added ${synCount} helpful synapse${
              synCount === 1 ? "" : "s"
            } and updated ${sqCount} neuron activation${
              sqCount === 1 ? "" : "s"
            }`,
          },
        });
      }
    }
  } else if (candidateSquashes && candidateSquashes.length > 0) {
    getLogger().info(
      `[DiscoveryCandidates] Combined change-squash candidate not created (${candidateSquashes.length} squash${
        candidateSquashes.length === 1 ? "" : "es"
      } suggested but structure change returned undefined)`,
    );
  }

  return { creature: changedSquashCreature, candidates };
}
