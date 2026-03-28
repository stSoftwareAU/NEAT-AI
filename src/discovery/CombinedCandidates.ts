/**
 * Combined Candidates Module
 *
 * Builds combined (multi-step) discovery candidates from individual changes,
 * including phase-2 combination strategies and candidate pruning.
 *
 * Builder functions for neurons/synapses/squash extracted to CombinedCandidateBuilders.ts.
 * Successful-combination logic extracted to CombinedFromSuccessful.ts.
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
import {
  buildWireToRuntimeIdMap,
  resolveCandidateSynapseEndpoints,
} from "../architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";
import { cleanupMemeticForRemovedSynapse } from "../compact/CompactUtils.ts";
import { Creature } from "../Creature.ts";
import type { DiscoverResult } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { validateAndFixCreatureSync } from "./CandidateApplication.ts";
import type {
  DiscoveryCandidate,
  DiscoveryChangeType,
} from "./DiscoveryCandidates.ts";

// Re-export for backward compatibility.
export {
  buildCombinedNeuronCandidate,
  buildCombinedSquashCandidates,
  buildCombinedSynapseCandidate,
} from "./CombinedCandidateBuilders.ts";
export {
  buildCombinedFromSuccessful,
  pruneSuccessfulCandidatesForCombos,
} from "./CombinedFromSuccessful.ts";

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
 * Persistently remove a harmful synapse from a creature, retrying if
 * `fix()` re-adds it. Returns the original creature if no removal occurred.
 */
export function persistentlyRemoveHarmfulSynapse(
  creature: Creature,
  harmfulSynapse: CandidateSynapse,
): Creature {
  const removalId = resolveCandidateSynapseEndpoints(
    buildWireToRuntimeIdMap(creature),
    harmfulSynapse,
  );
  if (!removalId) {
    return creature;
  }

  // Keep removing until it's definitely gone (fix() might re-add it)
  let currentCreature = creature;
  let removed = false;
  let attempts = 0;
  const maxAttempts = 10; // Prevent infinite loops

  while (attempts < maxAttempts) {
    const exportJSON = currentCreature.exportInternalJSON();
    const originalCount = exportJSON.synapses.length;
    exportJSON.synapses = exportJSON.synapses.filter((synapse) =>
      !(synapse.fromId === removalId.fromId &&
        synapse.toId === removalId.toId)
    );

    if (exportJSON.synapses.length < originalCount) {
      removed = true;
      // Clean up memetic data for the removed synapse
      cleanupMemeticForRemovedSynapse(
        exportJSON,
        removalId.fromId,
        removalId.toId,
      );

      const updated = Creature.fromJSON(exportJSON);
      // We modified the structure by filtering synapses, so we must delete UUID
      delete updated.uuid;
      validateAndFixCreatureSync(updated, "remove-synapse");

      // Verify it's still removed after fix()
      const verifyJSON = updated.exportInternalJSON();
      const stillExists = verifyJSON.synapses.some((synapse) =>
        synapse.fromId === removalId.fromId &&
        synapse.toId === removalId.toId
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
