import { Mutation } from "../../mod.ts";
import { AbstractMutationOperator } from "./AbstractMutationOperator.ts";

export class ModActivation extends AbstractMutationOperator {
  protected performMutation(focusList?: number[]): boolean {
    const index = this.selectRandomNonInputNeuronIndex(focusList);
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
