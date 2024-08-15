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
  mutate(focusList?: number[] | undefined): boolean {
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
      removeHiddenNeuron(this.creature, indx);
      changed = true;
      break;
    }

    return changed;
  }
}
