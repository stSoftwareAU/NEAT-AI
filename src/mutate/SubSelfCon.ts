import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";
import { Synapse } from "../architecture/Synapse.ts";

export class SubSelfCon implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  mutate(focusList?: number[] | undefined): boolean {
    // Check which neurons aren't self connected yet
    const possible = [];
    for (let i = this.creature.input; i < this.creature.neurons.length; i++) {
      if (this.creature.inFocus(i, focusList)) {
        const neuron = this.creature.neurons[i];
        const indx = neuron.index;
        const c = this.creature.getSynapse(indx, indx);
        if (c !== null) {
          possible.push(neuron);
        }
      }
    }

    if (possible.length === 0) {
      return false;
    }

    // Select a random node
    const neuron = possible[Math.floor(Math.random() * possible.length)];

    // Connect it to himself
    const indx = neuron.index;
    this.creature.disconnect(indx, indx);

    return true;
  }
}

