import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";
import { Mutation } from "../../mod.ts";

export class ModActivation implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  mutate(focusList?: number[] | undefined): boolean {
    let changed = false;
    for (let attempts = 0; attempts < 12; attempts++) {
      const index = Math.floor(
        Math.random() * (
              this.creature.neurons.length -
              this.creature.input
            ) + this.creature.input,
      );
      const neuron = this.creature.neurons[index];

      if (neuron.type == "constant") continue;

      if (this.creature.inFocus(index, focusList)) {
        changed = neuron.mutate(Mutation.MOD_ACTIVATION.name);
        break;
      }
    }

    return changed;
  }
}
