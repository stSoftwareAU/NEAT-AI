import { Synapse } from "../architecture/Synapse.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
import { AbstractMutationOperator } from "./AbstractMutationOperator.ts";

export class AddBackCon extends AbstractMutationOperator {
  protected performMutation(focusList?: number[]): boolean {
    const creature = this.creature;

    // Create an array of all uncreated (back feed) connections
    const available = [];
    for (
      let toIndx = creature.input;
      toIndx < creature.neurons.length;
      toIndx++
    ) {
      if (creature.inFocus(toIndx, focusList)) {
        const neuronTo = creature.neurons[toIndx];
        for (
          let fromIndx = creature.input;
          fromIndx < toIndx;
          fromIndx++
        ) {
          const neuronFrom = creature.neurons[fromIndx];
          if (neuronFrom.type === "output") break;
          if (neuronTo.type === "constant") continue;
          if (creature.inFocus(neuronFrom.index, focusList)) {
            if (!neuronFrom.isProjectingTo(neuronTo)) {
              available.push([neuronFrom, neuronTo]);
            }
          }
        }
      }
    }

    if (available.length === 0) {
      return false;
    }

    const pair = available[
      Math.floor(getRandomNumberGenerator().random() * available.length)
    ];
    const fromIndx = pair[0].index;
    const toIndx = pair[1].index;
    creature.connect(fromIndx, toIndx, Synapse.randomWeight());
    delete creature.memetic;
    return true;
  }
}
