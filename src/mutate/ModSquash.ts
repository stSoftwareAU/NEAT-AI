import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";
import { Mutation } from "../../mod.ts";
import { selectFocusedNeuronIndex } from "./MutationUtils.ts";

export class ModActivation implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  mutate(focusList?: number[]): boolean {
    const index = selectFocusedNeuronIndex(this.creature, focusList);
    if (index === -1) return false;

    const changed = this.creature.neurons[index].mutate(
      Mutation.MOD_SQUASH.name,
    );

    if (changed) {
      delete this.creature.memetic;
    }
    return changed;
  }
}
