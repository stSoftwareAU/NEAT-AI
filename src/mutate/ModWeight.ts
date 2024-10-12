import { assert } from "@std/assert/assert";
import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";

export class ModWeight implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }
  mutate(focusList?: number[] | undefined): boolean {
    const allConnections = this.creature.synapses.filter(
      (c) => {
        return this.creature.inFocus(c.from, focusList) ||
          this.creature.inFocus(c.to, focusList);
      },
    );
    let changed = false;
    if (allConnections.length > 0) {
      const indx = Math.floor(Math.random() * allConnections.length);
      const connection = allConnections[indx];

      // Calculate the quantum based on the current weight
      const weightMagnitude = Math.abs(connection.weight);
      let quantum = 1;

      if (weightMagnitude >= 1) {
        // Find the largest power of 10 smaller than the weightMagnitude
        quantum = Math.pow(10, Math.floor(Math.log10(weightMagnitude)));
      }

      // Generate a random modification value based on the quantum
      const modification = (Math.random() * 2 - 1) * quantum;

      connection.weight += modification;
      assert(Number.isFinite(connection.weight), "weight must be a number");
      changed = true;
    }

    return changed;
  }
}
