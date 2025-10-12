import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";

export class SubBackCon implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  mutate(focusList?: number[]): boolean {
    // Create an array of all uncreated (back fed) connections
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
    const from = pair[0];
    const to = pair[1];

    // Double-check at removal time to prevent creating invalid creatures
    const neuronType = this.creature.neurons[from].type;
    const canRemoveFrom = this.creature.outwardConnections(from).length > 1 ||
      neuronType === "input" ||
      neuronType === "constant";
    const canRemoveTo = this.creature.inwardConnections(to).length > 1;

    if (!canRemoveFrom || !canRemoveTo) {
      // Can't safely remove this connection
      return false;
    }

    this.creature.disconnect(from, to);

    delete this.creature.memetic;

    return true;
  }
}
