import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import {
  type CandidateNeuron,
  type CandidateSquash,
  type CandidateSynapse,
  DiscoverStructure,
} from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverResult } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { Creature } from "../Creature.ts";

export type DiscoveryChangeType =
  | "add-synapses"
  | "add-neurons"
  | "remove-synapse"
  | "change-squash"
  | "combo-add-remove"
  | "combo-add-change"
  | "combo-all"
  | "combo-best-of-category";

export interface DiscoveryCandidate {
  creature: Creature;
  change: {
    type: DiscoveryChangeType;
    description?: string;
  };
}

/**
 * Build a list of possible improved creatures based on discovery suggestions.
 *
 * This function mirrors the logic that previously lived in `Neat.ts`, but the
 * resulting creatures are now returned for external evaluation instead of being
 * applied directly to the population.
 */
export function buildDiscoveryCandidates(
  baseCreature: Creature,
  discovery: DiscoverResult,
): DiscoveryCandidate[] {
  // Ensure the base creature has a UUID so discovery helpers function correctly.
  CreatureUtil.makeUUID(baseCreature);

  const candidates: DiscoveryCandidate[] = [];

  const { addHelpfulSynapses, removeHarmfulSynapse, candidateSquashes } =
    discovery;

  const helpfulNeuronCandidates = discovery.addHelpfulNeurons;
  const addedNeuronCreature = helpfulNeuronCandidates &&
      helpfulNeuronCandidates.length > 0
    ? DiscoverStructure.addHelpfulNeurons(
      discovery.ID,
      baseCreature,
      helpfulNeuronCandidates,
    )
    : undefined;
  if (addedNeuronCreature && helpfulNeuronCandidates) {
    candidates.push({
      creature: addedNeuronCreature,
      change: {
        type: "add-neurons",
        description:
          `💡 Added ${helpfulNeuronCandidates.length} helpful neuron${
            helpfulNeuronCandidates.length === 1 ? "" : "s"
          }`,
      },
    });
  }

  candidates.push(
    ...buildSingleNeuronCandidates(
      discovery.ID,
      baseCreature,
      helpfulNeuronCandidates,
    ),
  );

  const addedSynapseCreature = DiscoverStructure.addHelpfulSynapses(
    discovery.ID,
    baseCreature,
    addHelpfulSynapses,
  );
  if (addedSynapseCreature) {
    candidates.push({
      creature: addedSynapseCreature,
      change: {
        type: "add-synapses",
        description: `🔗 Added ${
          addHelpfulSynapses?.length ?? 0
        } helpful synapse${(addHelpfulSynapses?.length ?? 0) === 1 ? "" : "s"}`,
      },
    });
  }

  candidates.push(
    ...buildSingleSynapseCandidates(
      discovery.ID,
      baseCreature,
      addHelpfulSynapses,
    ),
  );

  const removedSynapseCreature = DiscoverStructure.removeSynapse(
    discovery.ID,
    baseCreature,
    removeHarmfulSynapse,
  );
  if (removedSynapseCreature) {
    candidates.push({
      creature: removedSynapseCreature,
      change: {
        type: "remove-synapse",
        description: "✂️ Removed harmful synapse",
      },
    });

    if (addedSynapseCreature) {
      const combinedAddRemove = DiscoverStructure.addHelpfulSynapses(
        discovery.ID,
        removedSynapseCreature,
        addHelpfulSynapses,
      );
      if (combinedAddRemove) {
        const count = addHelpfulSynapses?.length ?? 0;
        candidates.push({
          creature: combinedAddRemove,
          change: {
            type: "combo-add-remove",
            description:
              `🏗️ Removed harmful synapse and added ${count} discovered helpful synapse${
                count === 1 ? "" : "s"
              }`,
          },
        });
      }
    }
  }

  const changedSquashCreature = DiscoverStructure.changeSquash(
    discovery.ID,
    baseCreature,
    candidateSquashes,
  );
  if (changedSquashCreature) {
    const changes = (candidateSquashes || []).map((c) => {
      const neuron = baseCreature.neurons.find((n) => n.uuid === c.neuronUUID);
      const oldSquash = neuron?.squash;
      const improvement = c.expectedImprovementPercentage
        ? ` expected: ${(c.expectedImprovementPercentage * 100).toFixed(1)}%`
        : "";
      return `${
        shortID(c.neuronUUID)
      } (${oldSquash} -> ${c.squash}${improvement})`;
    });

    const description = changes.length <= 3
      ? `🔄 Changed squash for ${changes.join(", ")}`
      : `🔄 Changed activation function on ${changes.length} high-error neurons`;

    candidates.push({
      creature: changedSquashCreature,
      change: {
        type: "change-squash",
        description,
      },
    });

    if (addedSynapseCreature) {
      const combinedAddChange = DiscoverStructure.changeSquash(
        discovery.ID,
        addedSynapseCreature,
        candidateSquashes,
      );
      if (combinedAddChange) {
        const synCount = addHelpfulSynapses?.length ?? 0;
        const sqCount = candidateSquashes?.length ?? 0;
        candidates.push({
          creature: combinedAddChange,
          change: {
            type: "combo-add-change",
            description: `🏗️ Added ${synCount} helpful synapse${
              synCount === 1 ? "" : "s"
            } and updated ${sqCount} neuron activation${
              sqCount === 1 ? "" : "s"
            }`,
          },
        });
      }
    }
  }

  candidates.push(
    ...buildSingleSquashCandidates(
      discovery.ID,
      baseCreature,
      candidateSquashes,
    ),
  );

  const combinedCandidate = buildCombinedCandidate({
    baseCreature,
    discoveryID: discovery.ID,
    selection: {
      addHelpfulNeurons: addedNeuronCreature
        ? helpfulNeuronCandidates
        : undefined,
      addHelpfulSynapses: addedSynapseCreature ? addHelpfulSynapses : undefined,
      removeHarmfulSynapse: removedSynapseCreature
        ? removeHarmfulSynapse
        : undefined,
      candidateSquashes: changedSquashCreature ? candidateSquashes : undefined,
    },
    changeType: "combo-all",
    description: "🏗️ Combined discovery changes",
  });
  if (combinedCandidate) {
    candidates.push(combinedCandidate);
  }

  const bestOfCategoryCandidate = buildBestOfCategoryCandidate(
    baseCreature,
    discovery,
  );
  if (bestOfCategoryCandidate) {
    if (discovery.removeHarmfulSynapse) {
      const sanitised = DiscoverStructure.removeSynapse(
        discovery.ID,
        bestOfCategoryCandidate.creature,
        discovery.removeHarmfulSynapse,
      );
      if (sanitised) {
        bestOfCategoryCandidate.creature = sanitised;
      } else {
        const enforced = enforceRemoval(
          bestOfCategoryCandidate.creature,
          discovery.removeHarmfulSynapse,
        );
        if (enforced) {
          bestOfCategoryCandidate.creature = enforced;
        }
      }
    }
    candidates.push(bestOfCategoryCandidate);
  }

  return candidates;
}

function buildSingleSynapseCandidates(
  discoveryID: string,
  baseCreature: Creature,
  synapses?: CandidateSynapse[],
): DiscoveryCandidate[] {
  if (!synapses || synapses.length === 0) return [];
  const entries: DiscoveryCandidate[] = [];
  for (const synapse of synapses) {
    const creature = DiscoverStructure.addHelpfulSynapses(
      discoveryID,
      baseCreature,
      [synapse],
    );
    if (!creature) continue;
    entries.push({
      creature,
      change: {
        type: "add-synapses",
        description: `🔗 Added helpful synapse ${
          shortID(synapse.fromNeuronUUID)
        } -> ${shortID(synapse.toNeuronUUID)}`,
      },
    });
  }
  return entries;
}

function buildSingleNeuronCandidates(
  discoveryID: string,
  baseCreature: Creature,
  neurons?: CandidateNeuron[],
): DiscoveryCandidate[] {
  if (!neurons || neurons.length === 0) return [];
  const entries: DiscoveryCandidate[] = [];
  for (const neuron of neurons) {
    const creature = DiscoverStructure.addHelpfulNeurons(
      discoveryID,
      baseCreature,
      [neuron],
    );
    if (!creature) continue;
    entries.push({
      creature,
      change: {
        type: "add-neurons",
        description: `💡 Added neuron ${
          shortID(neuron.fromNeuronUUID)
        } -> ${neuron.squash} -> ${shortID(neuron.toNeuronUUID)}`,
      },
    });
  }
  return entries;
}

function buildSingleSquashCandidates(
  discoveryID: string,
  baseCreature: Creature,
  squashes?: CandidateSquash[],
): DiscoveryCandidate[] {
  if (!squashes || squashes.length === 0) return [];
  const entries: DiscoveryCandidate[] = [];
  for (const squash of squashes) {
    const creature = DiscoverStructure.changeSquash(
      discoveryID,
      baseCreature,
      [squash],
    );
    if (!creature) continue;

    const neuron = baseCreature.neurons.find((n) =>
      n.uuid === squash.neuronUUID
    );
    const oldSquash = neuron?.squash;

    const improvement = squash.expectedImprovementPercentage
      ? ` expected: ${(squash.expectedImprovementPercentage * 100).toFixed(1)}%`
      : "";
    entries.push({
      creature,
      change: {
        type: "change-squash",
        description: `🔄 Changed squash for ${
          shortID(squash.neuronUUID)
        } (${oldSquash} -> ${squash.squash}${improvement})`,
      },
    });
  }
  return entries;
}

function shortID(id: string): string {
  if (id.length > 15 && id.includes("-")) {
    return id.slice(-8);
  }
  return id;
}

function enforceRemoval(
  creature: Creature,
  removal?: CandidateSynapse,
): Creature | undefined {
  if (!removal) return undefined;
  const exportJSON = creature.exportJSON();
  const filtered = exportJSON.synapses.filter((synapse) =>
    !(synapse.fromUUID === removal.fromNeuronUUID &&
      synapse.toUUID === removal.toNeuronUUID)
  );
  if (filtered.length === exportJSON.synapses.length) {
    return undefined;
  }
  exportJSON.synapses = filtered;
  const updated = Creature.fromJSON(exportJSON);
  updated.fix();
  return updated;
}

interface CombinedSelection {
  addHelpfulSynapses?: CandidateSynapse[];
  addHelpfulNeurons?: CandidateNeuron[];
  removeHarmfulSynapse?: CandidateSynapse;
  candidateSquashes?: CandidateSquash[];
}

interface CombinedCandidateArgs {
  baseCreature: Creature;
  discoveryID: string;
  selection: CombinedSelection;
  changeType: DiscoveryChangeType;
  description: string;
}

function buildCombinedCandidate(
  args: CombinedCandidateArgs,
): DiscoveryCandidate | undefined {
  const { baseCreature, discoveryID, selection, changeType, description } =
    args;

  const requestedCategories = [
    Boolean(selection.addHelpfulNeurons?.length),
    Boolean(selection.addHelpfulSynapses?.length),
    Boolean(selection.removeHarmfulSynapse),
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
        )
      : undefined,
  );

  // Apply removal last to ensure it happens even after other changes
  if (selection.removeHarmfulSynapse) {
    // Always attempt removal - the removal functions handle non-existent synapses gracefully
    const removed = DiscoverStructure.removeSynapse(
      discoveryID,
      combinedCreature,
      selection.removeHarmfulSynapse,
    );
    if (removed) {
      combinedCreature = removed;
      appliedLabels.push("remove-synapse");
    } else {
      // Fallback to enforceRemoval if removeSynapse returns null
      // (e.g., if UUID didn't change but synapse should still be removed)
      const enforced = enforceRemoval(
        combinedCreature,
        selection.removeHarmfulSynapse,
      );
      if (enforced) {
        combinedCreature = enforced;
        appliedLabels.push("remove-synapse");
      } else {
        // Verify synapse still exists and remove directly if needed
        // This ensures removal happens even if previous methods returned null/undefined
        const exportJSON = combinedCreature.exportJSON();
        const synapseExists = exportJSON.synapses.some((synapse) =>
          synapse.fromUUID === selection.removeHarmfulSynapse!.fromNeuronUUID &&
          synapse.toUUID === selection.removeHarmfulSynapse!.toNeuronUUID
        );
        if (synapseExists) {
          // Direct removal as final fallback to ensure synapse is removed
          exportJSON.synapses = exportJSON.synapses.filter((synapse) =>
            !(synapse.fromUUID ===
                selection.removeHarmfulSynapse!.fromNeuronUUID &&
              synapse.toUUID === selection.removeHarmfulSynapse!.toNeuronUUID)
          );
          const updated = Creature.fromJSON(exportJSON);
          updated.fix();
          combinedCreature = updated;
          appliedLabels.push("remove-synapse");
        }
      }
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

function buildBestOfCategoryCandidate(
  baseCreature: Creature,
  discovery: DiscoverResult,
): DiscoveryCandidate | undefined {
  const bestSelection: CombinedSelection = {
    addHelpfulSynapses: wrapBestCandidate(discovery.addHelpfulSynapses),
    addHelpfulNeurons: wrapBestCandidate(discovery.addHelpfulNeurons),
    candidateSquashes: wrapBestCandidate(discovery.candidateSquashes),
    removeHarmfulSynapse: discovery.removeHarmfulSynapse,
  };

  return buildCombinedCandidate({
    baseCreature,
    discoveryID: discovery.ID,
    selection: bestSelection,
    changeType: "combo-best-of-category",
    description: "🏗️ Combined best discovery changes",
  });
}

function wrapBestCandidate<
  T extends { expectedImprovementPercentage?: number },
>(
  entries?: T[] | undefined,
): T[] | undefined {
  if (!entries || entries.length === 0) {
    return undefined;
  }
  const best = entries.reduce((currentBest: T | undefined, candidate) => {
    if (!currentBest) return candidate;
    const bestScore = currentBest.expectedImprovementPercentage ??
      Number.NEGATIVE_INFINITY;
    const candidateScore = candidate.expectedImprovementPercentage ??
      Number.NEGATIVE_INFINITY;
    if (candidateScore > bestScore) {
      return candidate;
    }
    return currentBest;
  }, undefined);
  return best ? [best] : undefined;
}
