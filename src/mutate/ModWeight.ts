import type { Creature } from "../Creature.ts";
import type { MutatorInterface } from "./MutatorInterface.ts";

export class ModWeight implements MutatorInterface {
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
    if (allConnections.length > 0) {
      const pos = Math.floor(Math.random() * allConnections.length);
      const connection = allConnections[pos];
      if (connection) {
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
        return true;
      } else {
        console.warn(
          "MOD_WEIGHT: missing connection at",
          pos,
          "of",
          allConnections.length,
        );
      }
    }

    return false;
  }
}
