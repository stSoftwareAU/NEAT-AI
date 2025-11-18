import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import { DiscoverStructure } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverResult } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type { Creature } from "../Creature.ts";

export type DiscoveryChangeType =
  | "add-synapses"
  | "add-neurons"
  | "remove-synapse"
  | "change-squash"
  | "combo-add-remove"
  | "combo-add-change"
  | "combo-all";

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
        description: `Added ${helpfulNeuronCandidates.length} helpful neuron${
          helpfulNeuronCandidates.length === 1 ? "" : "s"
        }`,
      },
    });
  }

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
        description: `Added ${addHelpfulSynapses?.length ?? 0} helpful synapse${
          (addHelpfulSynapses?.length ?? 0) === 1 ? "" : "s"
        }`,
      },
    });
  }

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
        description: "Removed harmful synapse",
      },
    });

    if (addedSynapseCreature) {
      const combinedAddRemove = DiscoverStructure.addHelpfulSynapses(
        discovery.ID,
        removedSynapseCreature,
        addHelpfulSynapses,
      );
      if (combinedAddRemove) {
        candidates.push({
          creature: combinedAddRemove,
          change: {
            type: "combo-add-remove",
            description:
              "Removed harmful synapse and added discovered helpful synapse(s)",
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
    candidates.push({
      creature: changedSquashCreature,
      change: {
        type: "change-squash",
        description: "Changed activation function on high-error neurons",
      },
    });

    if (addedSynapseCreature) {
      const combinedAddChange = DiscoverStructure.changeSquash(
        discovery.ID,
        addedSynapseCreature,
        candidateSquashes,
      );
      if (combinedAddChange) {
        candidates.push({
          creature: combinedAddChange,
          change: {
            type: "combo-add-change",
            description:
              "Added helpful synapse(s) and updated neuron activation(s)",
          },
        });
      }
    }
  }

  const combinedCandidate = buildCombinedCandidate({
    baseCreature,
    discovery,
    includeAddNeurons: Boolean(addedNeuronCreature),
    includeAddSynapses: Boolean(addedSynapseCreature),
    includeRemoveSynapse: Boolean(removedSynapseCreature),
    includeChangeSquash: Boolean(changedSquashCreature),
  });
  if (combinedCandidate) {
    candidates.push(combinedCandidate);
  }

  return candidates;
}

interface CombinedCandidateContext {
  baseCreature: Creature;
  discovery: DiscoverResult;
  includeAddNeurons: boolean;
  includeAddSynapses: boolean;
  includeRemoveSynapse: boolean;
  includeChangeSquash: boolean;
}

function buildCombinedCandidate(
  context: CombinedCandidateContext,
): DiscoveryCandidate | undefined {
  const {
    baseCreature,
    discovery,
    includeAddNeurons,
    includeAddSynapses,
    includeRemoveSynapse,
    includeChangeSquash,
  } = context;

  const requestedCategories = [
    includeAddNeurons,
    includeAddSynapses,
    includeRemoveSynapse,
    includeChangeSquash,
  ].filter(Boolean).length;
  if (requestedCategories < 2) {
    return undefined;
  }

  let combinedCreature = baseCreature;
  const appliedLabels: DiscoveryChangeType[] = [];

  const applyChange = (
    enabled: boolean,
    label: DiscoveryChangeType,
    mutator: (creature: Creature) => Creature | undefined,
  ) => {
    if (!enabled) return;
    const updated = mutator(combinedCreature);
    if (updated && updated !== combinedCreature) {
      combinedCreature = updated;
      appliedLabels.push(label);
    }
  };

  applyChange(
    includeRemoveSynapse,
    "remove-synapse",
    (creature) =>
      DiscoverStructure.removeSynapse(
        discovery.ID,
        creature,
        discovery.removeHarmfulSynapse,
      ) ?? undefined,
  );

  applyChange(
    includeAddNeurons,
    "add-neurons",
    (creature) =>
      DiscoverStructure.addHelpfulNeurons(
        discovery.ID,
        creature,
        discovery.addHelpfulNeurons,
      ),
  );

  applyChange(
    includeAddSynapses,
    "add-synapses",
    (creature) =>
      DiscoverStructure.addHelpfulSynapses(
        discovery.ID,
        creature,
        discovery.addHelpfulSynapses,
      ),
  );

  applyChange(
    includeChangeSquash,
    "change-squash",
    (creature) =>
      DiscoverStructure.changeSquash(
        discovery.ID,
        creature,
        discovery.candidateSquashes,
      ),
  );

  if (appliedLabels.length < 2 || combinedCreature === baseCreature) {
    return undefined;
  }

  return {
    creature: combinedCreature,
    change: {
      type: "combo-all",
      description: `Combined discovery changes (${appliedLabels.join(", ")})`,
    },
  };
}
