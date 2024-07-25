import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";
import { Synapse } from "../architecture/Synapse.ts";

export class AddBackCon implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  mutate(focusList?: number[] | undefined): boolean {
    // Create an array of all uncreated (back feed) connections
    const available = [];
    for (let toIndx = this.creature.input; toIndx < this.creature.neurons.length; toIndx++) {
      if (this.creature.inFocus(toIndx, focusList)) {
        const neuronTo = this.creature.neurons[toIndx];
        for (let fromIndx = this.creature.input; fromIndx < toIndx; fromIndx++) {
          const neuronFrom = this.creature.neurons[fromIndx];
          if (neuronFrom.type == "output") break;
          if (neuronTo.type == "constant") continue;
          if (this.creature.inFocus(neuronFrom.index, focusList)) {
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

    const pair = available[Math.floor(Math.random() * available.length)];
    const fromIndx = pair[0].index;
    const toIndx = pair[1].index;
    this.creature.connect(fromIndx, toIndx, Synapse.randomWeight());
    return true;
  }
}