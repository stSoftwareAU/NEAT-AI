import type { Creature } from "../Creature.ts";
import { Mutation } from "../NEAT/Mutation.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";

export class ModBias implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  /**
   * Modify the bias of a neuron.
   *
   * @param {number[]} [focusList] - The list of focus indices.
   */
  mutate(focusList?: number[] | undefined): boolean {
    for (let attempts = 0; attempts < 12; attempts++) {
      // Has no effect on input node, so they are excluded
      const index = Math.floor(
        Math.random() * (this.creature.neurons.length - this.creature.input) +
          this.creature.input,
      );
      const neuron = this.creature.neurons[index];
      if (neuron.type === "constant") continue;
      if (!this.creature.inFocus(index, focusList) && attempts < 6) continue;
      neuron.mutate(Mutation.MOD_BIAS.name);
      return true;
    }

    return false;
  }
}
