import {
  cleanupMemeticForRemovedNeuron,
  cleanupOrphanedNeurons,
} from "../compact/CompactUtils.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { CreatureExportBuilder } from "../utils/CreatureExportBuilder.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
import { AbstractMutationOperator } from "./AbstractMutationOperator.ts";

export class SubNeuron extends AbstractMutationOperator {
  /**
   * Subtract a neuron from the network.
   */
  protected performMutation(focusList?: number[]): boolean {
    // Export the creature to JSON for clean manipulation
    // Use the builder directly to avoid validation (creature may be in an intermediate state)
    const builder = new CreatureExportBuilder(this.creature);
    const exportJSON = builder.build();

    // Filter to only hidden and constant neurons (removable)
    const removableNeurons = exportJSON.neurons.filter(
      (n) => n.type === "hidden" || n.type === "constant",
    );

    // Check if there are neurons left to remove
    if (removableNeurons.length === 0) {
      return false;
    }

    // Build neuron index map for focus checking
    const neuronIndexMap = new Map<string, number>();
    let idx = 0;
    // Input neurons first (implicit, not in export)
    for (let i = 0; i < this.creature.input; i++) {
      neuronIndexMap.set(`input-${i}`, idx++);
    }
    // Then exported neurons
    for (const neuron of exportJSON.neurons) {
      neuronIndexMap.set(neuron.uuid, idx++);
    }

    let selectedNeuronUUID: string | undefined;

    for (let attempts = 0; attempts < 24; attempts++) {
      // Select a random removable neuron
      const randomNeuron = removableNeurons[
        Math.floor(
          getRandomNumberGenerator().random() * removableNeurons.length,
        )
      ];
      const neuronIdx = neuronIndexMap.get(randomNeuron.uuid);

      // Check focus list using transitive focus checking (relax after 12 attempts)
      // A neuron is in focus if it's directly in the focus list OR if any of
      // its upstream connected neurons are in focus
      if (attempts < 12 && focusList && neuronIdx !== undefined) {
        if (!this.creature.inFocus(neuronIdx, focusList)) {
          continue;
        }
      }

      selectedNeuronUUID = randomNeuron.uuid;
      break;
    }

    if (!selectedNeuronUUID) {
      return false;
    }

    // Remove all synapses to/from this neuron
    exportJSON.synapses = exportJSON.synapses.filter(
      (s) =>
        s.fromUUID !== selectedNeuronUUID && s.toUUID !== selectedNeuronUUID,
    );

    // Remove the neuron itself
    exportJSON.neurons = exportJSON.neurons.filter(
      (n) => n.uuid !== selectedNeuronUUID,
    );

    // Clean up memetic data for the removed neuron
    cleanupMemeticForRemovedNeuron(exportJSON, selectedNeuronUUID);

    // Clean up IF neurons left in an invalid state after neuron removal.
    // IF neurons require at least one condition, positive, and negative connection.
    this.cleanupInvalidIfNeurons(exportJSON);

    // Clean up any neurons that have become orphaned (no outward connections)
    // This handles cascade removal when removing a neuron leaves others dangling
    cleanupOrphanedNeurons(exportJSON);

    // Reload the creature from the modified export
    // Note: We pass false for validation to match the old in-place mutation behavior.
    // Validation is handled elsewhere (e.g., by the caller or by fix() if needed).
    this.creature.loadFrom(exportJSON, false);

    return true;
  }

  /**
   * Handle IF neurons that have lost required connection types.
   * IF neurons need at least one condition, one positive, and one negative
   * inward connection. When a neuron is removed and its synapses are deleted,
   * IF neurons may lose required connections and become invalid.
   *
   * Output neurons are never removed — their squash is changed to IDENTITY
   * instead. Only hidden/constant IF neurons are removed entirely.
   */
  private cleanupInvalidIfNeurons(exportJSON: CreatureExport): void {
    let changed: boolean;
    do {
      changed = false;
      const removableUUIDs = new Set<string>();

      // Find IF neurons and check their connection types
      for (const neuron of exportJSON.neurons) {
        if (neuron.squash !== "IF") continue;

        let hasCondition = false;
        let hasPositive = false;
        let hasNegative = false;

        for (const synapse of exportJSON.synapses) {
          if (synapse.toUUID !== neuron.uuid) continue;
          const synapseType = synapse.type ?? "positive";
          if (synapseType === "condition") hasCondition = true;
          else if (synapseType === "positive") hasPositive = true;
          else if (synapseType === "negative") hasNegative = true;
        }

        if (!hasCondition || !hasPositive || !hasNegative) {
          if (neuron.type === "output") {
            // Output neurons must never be removed. Demote to IDENTITY
            // and clear synapse types so they work as standard connections.
            neuron.squash = "IDENTITY";
            for (const synapse of exportJSON.synapses) {
              if (synapse.toUUID === neuron.uuid && synapse.type) {
                delete synapse.type;
              }
            }
          } else {
            removableUUIDs.add(neuron.uuid);
          }
        }
      }

      if (removableUUIDs.size > 0) {
        // Remove invalid hidden/constant IF neurons and their synapses
        exportJSON.synapses = exportJSON.synapses.filter(
          (s) =>
            !removableUUIDs.has(s.fromUUID) &&
            !removableUUIDs.has(s.toUUID),
        );
        exportJSON.neurons = exportJSON.neurons.filter(
          (n) => !removableUUIDs.has(n.uuid),
        );
        for (const uuid of removableUUIDs) {
          cleanupMemeticForRemovedNeuron(exportJSON, uuid);
        }
        changed = true;
      }
    } while (changed);
  }
}
