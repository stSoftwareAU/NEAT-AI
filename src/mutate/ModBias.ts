import { Mutation } from "../NEAT/Mutation.ts";
import { AbstractMutationOperator } from "./AbstractMutationOperator.ts";

export class ModBias extends AbstractMutationOperator {
  /**
   * Modify the bias of a neuron.
   */
  protected performMutation(focusList?: number[]): boolean {
    const index = this.selectRandomNonInputNeuronIndex(focusList);
    if (index === -1) return false;

    return this.creature.neurons[index].mutate(Mutation.MOD_BIAS.name);
  }
}
