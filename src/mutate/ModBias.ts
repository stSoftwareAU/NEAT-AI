import type { Creature } from "../Creature.ts";
import { Mutation } from "../NEAT/Mutation.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";
import { selectFocusedNeuronIndex } from "./MutationUtils.ts";

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
  mutate(focusList?: number[]): boolean {
    const index = selectFocusedNeuronIndex(this.creature, focusList);
    if (index === -1) return false;

    return this.creature.neurons[index].mutate(Mutation.MOD_BIAS.name);
  }
}
