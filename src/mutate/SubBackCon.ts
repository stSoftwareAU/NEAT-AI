import { removeHiddenNeuron } from "../compact/CompactUtils.ts";
import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";
import { cleanupDisconnectedNeuron } from "./MutationUtils.ts";

export class SubBackCon implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  mutate(focusList?: number[]): boolean {
    // Create an array of all back connections that can be removed
    const available = [];
    for (
      let to = this.creature.input;
      to < this.creature.neurons.length;
      to++
    ) {
      if (this.creature.inFocus(to, focusList)) {
        for (let from = 0; from < to; from++) {
          if (this.creature.inFocus(from, focusList)) {
            if (this.creature.getSynapse(from, to) !== null) {
              // Post-removal logic will handle cleanup
              available.push([from, to]);
            }
          }
        }
      }
    }

    if (available.length === 0) {
      return false;
    }

    const pair = available[Math.floor(Math.random() * available.length)];
    this.creature.disconnect(pair[0], pair[1]);

    delete this.creature.memetic;

    // Cleanup: Check if TO neuron needs handling
    const toNeuronRemoved = cleanupDisconnectedNeuron(
      this.creature,
      pair[1],
    );

    // Adjust the 'from' index if the 'to' neuron was removed and it came before the 'from' neuron
    let fromIndex = pair[0];
    if (toNeuronRemoved && pair[1] < pair[0]) {
      fromIndex--;
    }
    // Cleanup: Check if FROM neuron needs removal
    const fromOutwardList = this.creature.outwardConnections(fromIndex);
    if (fromOutwardList.length === 0) {
      const fromNeuron = this.creature.neurons[fromIndex];
      if (fromNeuron.type === "hidden" || fromNeuron.type === "constant") {
        console.info(
          `Remove neuron ${fromNeuron.uuid} as no longer connected`,
        );
        removeHiddenNeuron(this.creature, fromIndex);
      }
    }

    return true;
  }
}
