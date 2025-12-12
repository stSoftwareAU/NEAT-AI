import {
  cleanupMemeticForRemovedSynapse,
  cleanupOrphanedNeurons,
} from "../compact/CompactUtils.ts";
import type { Creature } from "../Creature.ts";
import { CreatureExportBuilder } from "../utils/CreatureExportBuilder.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";

export class SubConnection implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  /**
   * Subtract a connection from the network.
   *
   * @param {number[]} [focusList] - The list of focus indices.
   */
  public mutate(focusList?: number[]): boolean {
    // Export the creature to JSON for clean manipulation
    // Use the builder directly to avoid validation (creature may be in an intermediate state)
    const builder = new CreatureExportBuilder(this.creature);
    const exportJSON = builder.build();

    // List of possible connections that can be removed (forward connections only)
    const possible: { fromUUID: string; toUUID: string }[] = [];

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

    for (const synapse of exportJSON.synapses) {
      const fromIdx = neuronIndexMap.get(synapse.fromUUID);
      const toIdx = neuronIndexMap.get(synapse.toUUID);

      // Only consider forward connections (to > from)
      if (fromIdx !== undefined && toIdx !== undefined && toIdx > fromIdx) {
        // Check focus list
        const inFocus = !focusList ||
          focusList.includes(fromIdx) ||
          focusList.includes(toIdx);

        if (inFocus) {
          possible.push({ fromUUID: synapse.fromUUID, toUUID: synapse.toUUID });
        }
      }
    }

    if (possible.length === 0) {
      return false;
    }

    // Select a random connection to remove
    const randomConn = possible[Math.floor(Math.random() * possible.length)];

    // Remove the selected synapse
    exportJSON.synapses = exportJSON.synapses.filter(
      (s) =>
        s.fromUUID !== randomConn.fromUUID || s.toUUID !== randomConn.toUUID,
    );

    // Clean up memetic data for the removed synapse
    cleanupMemeticForRemovedSynapse(
      exportJSON,
      randomConn.fromUUID,
      randomConn.toUUID,
    );

    // Clean up any neurons that have become orphaned after synapse removal.
    // This handles both:
    // - Converting hidden neurons with no inward connections to constants
    // - Removing hidden/constant neurons with no outward connections
    cleanupOrphanedNeurons(exportJSON);

    // Reload the creature from the modified export
    // Note: We pass false for validation to match the old in-place mutation behavior.
    // Validation is handled elsewhere (e.g., by the caller or by fix() if needed).
    this.creature.loadFrom(exportJSON, false);

    return true;
  }
}
