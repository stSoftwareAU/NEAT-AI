import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";
import { removeHiddenNeuron } from "../compact/CompactUtils.ts";

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
    // Check if there are neurons left to remove
    if (
      this.creature.neurons.length ===
        this.creature.input + this.creature.output
    ) {
      return false;
    }

    let changed = false;
    for (let attempts = 0; attempts < 24; attempts++) {
      // Select a neuron which isn't an input or output neuron
      const indx = Math.floor(
        Math.random() *
            (this.creature.neurons.length - this.creature.output -
              this.creature.input) +
          this.creature.input,
      );

      if (attempts < 12 && !this.creature.inFocus(indx, focusList)) continue;

      // Collect neurons that might need cleanup after removing this one
      const incomingConnections = this.creature.inwardConnections(indx);
      const neuronsToCheck: number[] = [];

      for (const conn of incomingConnections) {
        const sourceNeuron = this.creature.neurons[conn.from];
        // If the source is a hidden neuron and this is its only outward connection
        if (
          sourceNeuron.type === "hidden" &&
          this.creature.outwardConnections(conn.from).length === 1
        ) {
          neuronsToCheck.push(conn.from);
        }
      }

      removeHiddenNeuron(this.creature, indx);

      // Cleanup: Remove source neurons that are now left with 0 outward connections
      // Sort in reverse order so removal doesn't affect indices
      neuronsToCheck.sort((a, b) => b - a);
      for (const sourceIndx of neuronsToCheck) {
        // Adjust index if neurons before it were removed
        let adjustedIndx = sourceIndx;
        if (sourceIndx > indx) {
          adjustedIndx--;
        }

        if (this.creature.outwardConnections(adjustedIndx).length === 0) {
          const sourceNeuron = this.creature.neurons[adjustedIndx];
          if (
            sourceNeuron &&
            (sourceNeuron.type === "hidden" || sourceNeuron.type === "constant")
          ) {
            console.info(
              `Remove neuron ${sourceNeuron.uuid} as no longer connected`,
            );
            removeHiddenNeuron(this.creature, adjustedIndx);
          }
        }
      }

      changed = true;
      break;
    }

    delete this.creature.memetic;

    return changed;
  }
}
