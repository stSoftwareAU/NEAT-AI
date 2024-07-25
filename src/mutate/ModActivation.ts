import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";

export class ModWeight implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  mutate(focusList?: number[] | undefined): boolean {
    for (let attempts = 0; attempts < 12; attempts++) {
      const index = Math.floor(
        Math.random() * (
          this.neurons.length -
          this.input
        ) + this.input,
      );
      const neuron = this.neurons[index];

      if (neuron.type == "constant") continue;

      if (this.inFocus(index, focusList)) {
        return neuron.mutate(Mutation.MOD_ACTIVATION.name);
      }
    }

    return false;
  }
}
