/**
 * Candidate Creation Module
 *
 * Builds individual (single-step) discovery candidates from discovery results.
 * Each builder function creates one candidate creature per suggestion from Rust.
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
import type {
  CoordinatedStructuralCandidate,
} from "../architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import {
  applyCoordinatedStructuralCandidate,
} from "../architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import type {
  DiscoverResult,
  RemovalCandidate,
} from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { getLogger } from "../utils/Logger.ts";
import { shortID } from "./CandidateDescriptions.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import type { Creature } from "../Creature.ts";
import { persistentlyRemoveHarmfulSynapse } from "./CombinedCandidates.ts";

// Re-export RemovalCandidate so callers don't need a separate import
export type { RemovalCandidate };

/**
 * Build one candidate per synapse suggestion.
 */
export function buildSingleSynapseCandidates(
  discoveryID: string,
  baseCreature: Creature,
  synapses: CandidateSynapse[] | undefined,
  getExpected?: (synapse: CandidateSynapse) => number | undefined,
  discoveryFailureCacheDir?: string,
): DiscoveryCandidate[] {
  if (!synapses || synapses.length === 0) return [];
  const entries: DiscoveryCandidate[] = [];
  let skippedCount = 0;
  for (const synapse of synapses) {
    const creature = DiscoverStructure.addHelpfulSynapses(
      discoveryID,
      baseCreature,
      [synapse],
      discoveryFailureCacheDir,
    );
    if (!creature) {
      skippedCount++;
      continue;
    }
    entries.push({
      creature,
      change: {
        type: "add-synapses",
        description: `🔗 Added helpful synapse ${
          shortID(String(synapse.fromNeuronId))
        } -> ${shortID(String(synapse.toNeuronId))}`,
        expectedErrorReduction: getExpected?.(synapse),
        sampleSize: synapse.totalCount,
        synapseCandidate: synapse, // Store original Rust response for debugging
      },
    });
  }
  if (skippedCount > 0) {
    getLogger().info(
      `[DiscoveryCandidates] Skipped ${skippedCount}/${synapses.length} individual synapse candidate${
        skippedCount === 1 ? "" : "s"
      } (structure change returned undefined)`,
    );
  }
  return entries;
}

/**
 * Build one candidate per neuron suggestion.
 */
export function buildSingleNeuronCandidates(
  discoveryID: string,
  baseCreature: Creature,
  neurons: CandidateNeuron[] | undefined,
  getExpected?: (neuron: CandidateNeuron) => number | undefined,
  discoveryFailureCacheDir?: string,
): DiscoveryCandidate[] {
  if (!neurons || neurons.length === 0) return [];
  const baseNeuronIds = new Set(baseCreature.neurons.map((n) => n.id));
  const entries: DiscoveryCandidate[] = [];
  let skippedCount = 0;
  for (const neuron of neurons) {
    const creature = DiscoverStructure.addHelpfulNeurons(
      discoveryID,
      baseCreature,
      [neuron],
      discoveryFailureCacheDir,
    );
    if (!creature) {
      skippedCount++;
      continue;
    }

    // Find the newly added neuron by comparing with base creature
    const addedNeuron = creature.neurons.find(
      (n) => n.id != null && !baseNeuronIds.has(n.id),
    );
    const addedNeuronShortID = addedNeuron?.id != null
      ? shortID(String(addedNeuron.id))
      : undefined;

    entries.push({
      creature,
      change: {
        type: "add-neurons",
        description: `💡 Added neuron ${
          shortID(String(neuron.fromNeuronId))
        } -> ${neuron.squash} -> ${shortID(String(neuron.toNeuronId))}`,
        expectedErrorReduction: getExpected?.(neuron),
        sampleSize: neuron.totalCount,
        neuronDetails: {
          addedNeuronShortID,
          fromNeuronId: neuron.fromNeuronId,
          toNeuronId: neuron.toNeuronId,
          incomingWeight: neuron.incomingWeight,
          outgoingWeight: neuron.outgoingWeight,
          bias: neuron.bias,
          squash: neuron.squash,
        },
        // Store the full Rust neuron candidate for failure cache debugging
        neuronCandidate: neuron,
      },
    });
  }
  if (skippedCount > 0) {
    getLogger().info(
      `[DiscoveryCandidates] Skipped ${skippedCount}/${neurons.length} individual neuron candidate${
        skippedCount === 1 ? "" : "s"
      } (structure change returned undefined)`,
    );
  }
  return entries;
}

/**
 * Build one candidate per squash-change suggestion.
 */
export function buildSingleSquashCandidates(
  discoveryID: string,
  baseCreature: Creature,
  squashes: CandidateSquash[] | undefined,
  getExpected?: (squash: CandidateSquash) => number | undefined,
  discoveryFailureCacheDir?: string,
): DiscoveryCandidate[] {
  if (!squashes || squashes.length === 0) return [];
  const entries: DiscoveryCandidate[] = [];
  let skippedCount = 0;
  for (const squash of squashes) {
    const creature = DiscoverStructure.changeSquash(
      discoveryID,
      baseCreature,
      [squash],
      discoveryFailureCacheDir,
    );
    if (!creature) {
      skippedCount++;
      continue;
    }

    const neuron = baseCreature.neurons.find((n) =>
      n.id === squash.neuronId
    );
    const oldSquash = neuron?.squash;

    const scaledExpected = getExpected?.(squash);
    const improvement = scaledExpected !== undefined
      ? ` expected: ${(scaledExpected * 100).toFixed(1)}%`
      : "";
    entries.push({
      creature,
      change: {
        type: "change-squash",
        description: `🎨 Changed activation function for ${
          shortID(String(squash.neuronId))
        } (${oldSquash} -> ${squash.squash}${improvement})`,
        expectedErrorReduction: scaledExpected,
        squashCandidate: squash, // Store original Rust response for debugging
      },
    });
  }
  if (skippedCount > 0) {
    getLogger().info(
      `[DiscoveryCandidates] Skipped ${skippedCount}/${squashes.length} individual squash candidate${
        skippedCount === 1 ? "" : "s"
      } (structure change returned undefined)`,
    );
  }
  return entries;
}

/**
 * Build one candidate per low-impact neuron removal suggestion.
 *
 * Low-impact removal candidates have neurons whose impact is below costOfGrowth.
 * These neurons contribute essentially nothing to outputs — removing them improves
 * the creature's score because the complexity reduction benefit exceeds their contribution.
 */
export function buildLowImpactRemovalCandidates(
  discovery: DiscoverResult,
  baseCreature: Creature,
  discoveryFailureCacheDir?: string,
): DiscoveryCandidate[] {
  const { removalCandidates } = discovery;
  if (!removalCandidates || removalCandidates.length === 0) return [];

  const entries: DiscoveryCandidate[] = [];
  let removalSuccessCount = 0;
  let removalFailureCount = 0;
  const failureReasons: Map<string, number> = new Map();

  for (const candidate of removalCandidates) {
    const neuronExists = baseCreature.neurons.some(
      (n) => n.id === candidate.neuronId,
    );
    if (!neuronExists) {
      const reason = "neuron_not_found";
      failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
      removalFailureCount++;
      continue;
    }

    const removedLowImpactCreature = DiscoverStructure.removeLowImpactNeuron(
      discovery.ID,
      baseCreature,
      candidate,
      discoveryFailureCacheDir,
    );
    if (removedLowImpactCreature) {
      removalSuccessCount++;
      entries.push({
        creature: removedLowImpactCreature,
        change: {
          type: "remove-low-impact",
          description: `🪶 Removed neuron ${
            shortID(String(candidate.neuronId))
          } (impact: ${candidate.impact.toExponential(2)})`,
          removalCandidate: candidate,
        },
      });
    } else {
      const reason = "removal_returned_undefined";
      failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
      removalFailureCount++;
    }
  }

  logRemovalDiagnostics(
    removalCandidates,
    removalSuccessCount,
    removalFailureCount,
    failureReasons,
  );

  return entries;
}

function logRemovalDiagnostics(
  removalCandidates: readonly RemovalCandidate[],
  removalSuccessCount: number,
  removalFailureCount: number,
  failureReasons: Map<string, number>,
): void {
  if (removalCandidates.length === 0) return;

  const failureDetails = Array.from(failureReasons.entries())
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(", ");
  getLogger().info(
    `[DiscoveryCandidates] Removal candidates: ${removalCandidates.length} total, ` +
      `${removalSuccessCount} succeeded, ${removalFailureCount} failed` +
      (failureDetails ? ` (${failureDetails})` : ""),
  );

  const sortedByImpact = [...removalCandidates].sort((a, b) =>
    a.impact - b.impact
  );
  const topCandidates = sortedByImpact.slice(0, 10);
  const candidateDetails = topCandidates.map((c) =>
    `${shortID(String(c.neuronId))}:${c.impact.toExponential(2)}`
  ).join(", ");
  getLogger().info(
    `[DiscoveryCandidates] Top ${topCandidates.length} lowest-impact removal candidates: ${candidateDetails}`,
  );

  // With integer neuron IDs, there are no string-based "test" markers to check.
  // This diagnostic block is retained as a no-op placeholder for future use.
}

/**
 * Build one candidate per coordinated structural suggestion.
 */
export function buildCoordinatedStructuralCandidates(
  discovery: DiscoverResult,
  baseCreature: Creature,
  getExpectedCoordinated: (
    c: CoordinatedStructuralCandidate,
  ) => number | undefined,
): DiscoveryCandidate[] {
  const coordinatedStructuralCandidates =
    discovery.coordinatedStructuralCandidates;
  if (
    !coordinatedStructuralCandidates ||
    coordinatedStructuralCandidates.length === 0
  ) {
    return [];
  }

  const entries: DiscoveryCandidate[] = [];
  let skippedCount = 0;
  for (const coordinated of coordinatedStructuralCandidates) {
    try {
      const next = applyCoordinatedStructuralCandidate(
        baseCreature,
        coordinated,
      );
      entries.push({
        creature: next,
        change: {
          type: "coordinated-structural",
          description:
            `🧩 Coordinated structural (${coordinated.operations.length} op${
              coordinated.operations.length === 1 ? "" : "s"
            })`,
          expectedErrorReduction: getExpectedCoordinated(coordinated),
          coordinatedStructuralCandidate: coordinated,
        },
      });
    } catch (error) {
      skippedCount++;
      getLogger().info(
        `[DiscoveryCandidates] Skipped coordinated-structural candidate (apply failed):`,
        error,
      );
    }
  }
  if (skippedCount > 0) {
    getLogger().info(
      `[DiscoveryCandidates] Skipped ${skippedCount}/${coordinatedStructuralCandidates.length} coordinated-structural candidate${
        skippedCount === 1 ? "" : "s"
      } (apply failed)`,
    );
  }
  return entries;
}

/**
 * Build a harmful neuron removal candidate from the most harmful neuron.
 */
export function buildHarmfulNeuronRemovalCandidate(
  discoveryID: string,
  baseCreature: Creature,
  removeHarmfulNeurons: CandidateHarmfulNeuron[] | undefined,
  discoveryFailureCacheDir?: string,
): DiscoveryCandidate | undefined {
  if (!removeHarmfulNeurons || removeHarmfulNeurons.length === 0) {
    return undefined;
  }
  const mostHarmful = removeHarmfulNeurons[0];
  const removedNeuronCreature = DiscoverStructure.removeHarmfulNeuron(
    discoveryID,
    baseCreature,
    mostHarmful,
    discoveryFailureCacheDir,
  );
  if (!removedNeuronCreature) return undefined;

  return {
    creature: removedNeuronCreature,
    change: {
      type: "remove-neuron",
      description: `💀 Removed harmful neuron ${
        shortID(String(mostHarmful.neuronId))
      } (error: ${mostHarmful.errorMagnitude.toExponential(2)})`,
      expectedErrorReduction: mostHarmful.expectedCreatureScoreGain,
      sampleSize: mostHarmful.sampleCount,
      harmfulNeuronCandidate: mostHarmful,
    },
  };
}

/**
 * Build a harmful synapse removal candidate and optional combo-add-remove candidate.
 *
 * Returns the removed-synapse creature (for use in combo building) and pushes
 * candidates into the provided array.
 */
export function buildHarmfulSynapseRemovalCandidates(
  discovery: DiscoverResult,
  baseCreature: Creature,
  removeHarmfulSynapse: CandidateSynapse | undefined,
  addHelpfulSynapses: CandidateSynapse[] | undefined,
  addedSynapseCreature: Creature | undefined,
  skipCombos: boolean,
  getExpectedRemoval: (c?: CandidateSynapse) => number | undefined,
  discoveryFailureCacheDir?: string,
): {
  removedSynapseCreature: Creature | undefined;
  candidates: DiscoveryCandidate[];
} {
  const candidates: DiscoveryCandidate[] = [];
  const removedSynapseCreature = DiscoverStructure.removeSynapse(
    discovery.ID,
    baseCreature,
    removeHarmfulSynapse,
    discoveryFailureCacheDir,
  ) ?? undefined;

  if (!removedSynapseCreature || !removeHarmfulSynapse) {
    return { removedSynapseCreature, candidates };
  }

  candidates.push({
    creature: removedSynapseCreature,
    change: {
      type: "remove-synapse",
      description: `✂️ Removed harmful synapse ${
        shortID(String(removeHarmfulSynapse.fromNeuronId))
      } -> ${shortID(String(removeHarmfulSynapse.toNeuronId))}`,
      expectedErrorReduction: getExpectedRemoval(removeHarmfulSynapse),
      sampleSize: removeHarmfulSynapse.totalCount,
      synapseDetails: {
        fromNeuronId: removeHarmfulSynapse.fromNeuronId,
        toNeuronId: removeHarmfulSynapse.toNeuronId,
      },
      harmfulSynapseCandidate: removeHarmfulSynapse,
    },
  });

  // Build combo-add-remove candidate
  if (!skipCombos && addedSynapseCreature && removeHarmfulSynapse) {
    const combinedAddRemove = DiscoverStructure.addHelpfulSynapses(
      discovery.ID,
      removedSynapseCreature,
      addHelpfulSynapses,
      discoveryFailureCacheDir,
    );
    if (combinedAddRemove) {
      const ensured = persistentlyRemoveHarmfulSynapse(
        combinedAddRemove,
        removeHarmfulSynapse,
      );
      const count = addHelpfulSynapses?.length ?? 0;
      candidates.push({
        creature: ensured,
        change: {
          type: "combo-add-remove",
          description:
            `🔧 Removed harmful synapse and added ${count} discovered helpful synapse${
              count === 1 ? "" : "s"
            }`,
        },
      });
    }
  }

  return { removedSynapseCreature, candidates };
}
