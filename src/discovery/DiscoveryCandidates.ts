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
  | "combo-add-change";

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

  return candidates;
}
