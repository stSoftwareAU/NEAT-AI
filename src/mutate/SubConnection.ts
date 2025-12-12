import {
  cleanupMemeticForRemovedSynapse,
  cleanupOrphanedNeurons,
} from "../compact/CompactUtils.ts";
import type { Creature } from "../Creature.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";
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

    // Build a map of neuron UUIDs to their export data for quick lookup
    const neuronMap = new Map(
      exportJSON.neurons.map((n) => [n.uuid, n]),
    );

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

    // Check if the 'to' neuron has lost all inward connections
    const toNeuron = neuronMap.get(randomConn.toUUID);
    if (toNeuron && toNeuron.type === "hidden") {
      const hasInward = exportJSON.synapses.some(
        (s) => s.toUUID === randomConn.toUUID,
      );

      if (!hasInward) {
        const hasOutward = exportJSON.synapses.some(
          (s) => s.fromUUID === randomConn.toUUID,
        );

        if (hasOutward) {
          // Has outward connections but no inward - convert to constant
          // Calculate the constant bias using the squash function
          let constantBias = toNeuron.bias;
          if (toNeuron.squash) {
            const squashFn = Activations.find(toNeuron.squash);
            const activation = squashFn as ActivationInterface;
            if (activation?.squash) {
              constantBias = activation.squash(toNeuron.bias);
            }
          }

          // Replace the hidden neuron with a constant neuron
          const neuronIndex = exportJSON.neurons.findIndex(
            (n) => n.uuid === randomConn.toUUID,
          );
          if (neuronIndex !== -1) {
            exportJSON.neurons[neuronIndex] = {
              type: "constant",
              uuid: toNeuron.uuid,
              bias: constantBias,
            };
          }
        }
        // If no outward connections either, cleanupOrphanedNeurons will remove it
      }
    }

    // Clean up any neurons that have become orphaned (no outward connections)
    // This handles cascade removal when removing a synapse leaves neurons dangling
    cleanupOrphanedNeurons(exportJSON);

    // Reload the creature from the modified export
    // Note: We pass false for validation to match the old in-place mutation behavior.
    // Validation is handled elsewhere (e.g., by the caller or by fix() if needed).
    this.creature.loadFrom(exportJSON, false);

    return true;
  }
}
