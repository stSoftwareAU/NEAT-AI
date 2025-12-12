import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";
import {
  cleanupMemeticForRemovedNeuron,
  cleanupOrphanedNeurons,
} from "../compact/CompactUtils.ts";
import { CreatureExportBuilder } from "../utils/CreatureExportBuilder.ts";

export class SubNeuron implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  /**
   * Subtract a neuron from the network.
   *
   * @param {number[]} [focusList] - The list of focus indices.
   */
  mutate(focusList?: number[]): boolean {
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
      const randomNeuron =
        removableNeurons[Math.floor(Math.random() * removableNeurons.length)];
      const neuronIdx = neuronIndexMap.get(randomNeuron.uuid);

      // Check focus list (relax after 12 attempts)
      if (attempts < 12 && focusList && neuronIdx !== undefined) {
        if (!focusList.includes(neuronIdx)) {
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

    // Clean up any neurons that have become orphaned (no outward connections)
    // This handles cascade removal when removing a neuron leaves others dangling
    cleanupOrphanedNeurons(exportJSON);

    // Reload the creature from the modified export
    // Note: We pass false for validation to match the old in-place mutation behavior.
    // Validation is handled elsewhere (e.g., by the caller or by fix() if needed).
    this.creature.loadFrom(exportJSON, false);

    return true;
  }
}
