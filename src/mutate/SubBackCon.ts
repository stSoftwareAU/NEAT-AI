import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";

export class SubBackCon implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  mutate(focusList?: number[] | undefined): boolean {
    // Create an array of all uncreated (back fed) connections
    const available = [];
    for (let to = this.input; to < this.neurons.length; to++) {
      if (this.inFocus(to, focusList)) {
        for (let from = 0; from < to; from++) {
          if (this.inFocus(from, focusList)) {
            if (
              (
                this.outwardConnections(from).length > 1 ||
                this.neurons[from].type === "input"
              ) && this.inwardConnections(to).length > 1
            ) {
              if (this.getSynapse(from, to) != null) {
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

    const pair = available[Math.floor(Math.random() * available.length)];
    this.disconnect(pair[0], pair[1]);
    return true;
  }
}
