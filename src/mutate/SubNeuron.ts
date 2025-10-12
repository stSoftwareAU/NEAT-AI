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

      // CRITICAL CHECK: Before removing this neuron, ensure no hidden neurons
      // depend on it as their only outward connection
      const incomingConnections = this.creature.inwardConnections(indx);
      let canRemove = true;

      for (const conn of incomingConnections) {
        const sourceNeuron = this.creature.neurons[conn.from];
        // If the source is a hidden neuron and this is its only outward connection
        if (
          sourceNeuron.type === "hidden" &&
          this.creature.outwardConnections(conn.from).length === 1
        ) {
          canRemove = false;
          break;
        }
      }

      if (!canRemove) {
        continue; // Try another neuron
      }

      removeHiddenNeuron(this.creature, indx);
      changed = true;
      break;
    }

    delete this.creature.memetic;

    return changed;
  }
}
