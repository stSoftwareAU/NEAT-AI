import { Synapse } from "../architecture/Synapse.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
import { AbstractMutationOperator } from "./AbstractMutationOperator.ts";

export class AddSelfCon extends AbstractMutationOperator {
  protected performMutation(focusList?: number[]): boolean {
    const creature = this.creature;

    // Check which neurons aren't self connected yet
    const possible = [];
    for (
      let i = creature.input;
      i < creature.neurons.length - creature.output;
      i++
    ) {
      if (creature.inFocus(i, focusList)) {
        const neuron = creature.neurons[i];
        if (neuron.type === "constant") continue;

        const c = creature.selfConnection(neuron.index);
        if (c === null) {
          possible.push(neuron);
        }
      }
    }

    if (possible.length === 0) {
      return false;
    }

    const neuron = possible[
      Math.floor(getRandomNumberGenerator().random() * possible.length)
    ];
    const indx = neuron.index;
    creature.connect(indx, indx, Synapse.randomWeight());

    delete creature.memetic;
    return true;
  }
}
