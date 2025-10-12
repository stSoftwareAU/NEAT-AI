import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";

export class SubBackCon implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  mutate(focusList?: number[]): boolean {
    // Create an array of all safely removable back connections
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
              // Pre-check safety at collection time to improve mutation effectiveness
              const neuronType = this.creature.neurons[from].type;
              const canRemoveFrom =
                this.creature.outwardConnections(from).length > 1 ||
                neuronType === "input" ||
                neuronType === "constant";
              const canRemoveTo =
                this.creature.inwardConnections(to).length > 1;

              // Only add to available if safe to remove
              if (canRemoveFrom && canRemoveTo) {
                available.push([from, to]);
              }
            }
          }
        }
      }
    }

    if (available.length === 0) {
      return false;
    }

    // All connections in available are safe to remove, so just pick one
    const pair = available[Math.floor(Math.random() * available.length)];
    this.creature.disconnect(pair[0], pair[1]);

    delete this.creature.memetic;

    return true;
  }
}
