import type { Creature } from "../Creature.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";
import { cleanupOrphanedNeurons } from "../compact/CompactUtils.ts";

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
    const exportJSON = this.creature.exportJSON();

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

    // Clean up any neurons that have become orphaned (no outward connections)
    // This handles cascade removal when removing a neuron leaves others dangling
    cleanupOrphanedNeurons(exportJSON);

    // Reload the creature from the modified export
    delete (exportJSON as CreatureExport & { memetic?: unknown }).memetic;
    this.creature.loadFrom(exportJSON, true);

    return true;
  }
}
