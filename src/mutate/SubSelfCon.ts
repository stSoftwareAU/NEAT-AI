import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";
import { cleanupDisconnectedNeuron } from "./MutationUtils.ts";

export class SubSelfCon implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  mutate(focusList?: number[]): boolean {
    // Check which neurons have safely removable self-connections
    const possible = [];
    for (let i = this.creature.input; i < this.creature.neurons.length; i++) {
      if (this.creature.inFocus(i, focusList)) {
        const neuron = this.creature.neurons[i];
        const indx = neuron.index;
        const c = this.creature.getSynapse(indx, indx);
        if (c !== null) {
          // Only add to possible if it's safe to remove (not the only outward connection)
          if (
            neuron.type === "hidden" &&
            this.creature.outwardConnections(indx).length <= 1
          ) {
            continue;
          }
          possible.push(neuron);
        }
      }
    }

    if (possible.length === 0) {
      return false;
    }

    // All neurons in possible are safe to disconnect, so just pick one
    const neuron = possible[Math.floor(Math.random() * possible.length)];
    const indx = neuron.index;

    this.creature.disconnect(indx, indx);

    delete this.creature.memetic;

    // Cleanup: Check if neuron now needs handling after losing self-connection
    cleanupDisconnectedNeuron(this.creature, indx);

    return true;
  }
}
