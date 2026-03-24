/**
 * Combined Candidate Builders Module
 *
 * Functions for building combined "all of type" candidates by applying
 * all neuron, synapse, or squash suggestions at once.
 *
 * Extracted from CombinedCandidates.ts as part of #1598.
 */

import type {
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { DiscoverStructure } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { Creature } from "../Creature.ts";
import { getLogger } from "../utils/Logger.ts";
import { shortID } from "./CandidateDescriptions.ts";
import {
  mapScaledSummaryEntries,
  summariseExpectedImprovement,
} from "./CandidateScoring.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";

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
      const neuron = baseCreature.neurons.find((n) => n.id === c.neuronId);
      const oldSquash = neuron?.squash;
      const improvementValue = getExpectedSquash(c);
      const improvement = improvementValue !== undefined
        ? ` expected: ${(improvementValue * 100).toFixed(1)}%`
        : "";
      return `${
        shortID(String(c.neuronId))
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
