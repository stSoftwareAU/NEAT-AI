import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";
import { Synapse } from "../architecture/Synapse.ts";

export class AddSelfCon implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  mutate(focusList?: number[] | undefined): boolean {
    // Check which neurons aren't self connected yet
    const possible = [];
    for (let i = this.creature.input; i < this.creature.neurons.length - this.creature.output; i++) {
      if (this.creature.inFocus(i, focusList)) {
        const neuron = this.creature.neurons[i];
        if (neuron.type === "constant") continue;

        const c = this.creature.selfConnection(neuron.index);
        if (c === null) {
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
    this.creature.connect(indx, indx, Synapse.randomWeight());

    return true;
  }
}
