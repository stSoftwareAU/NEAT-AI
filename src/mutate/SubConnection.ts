import type { Creature } from "../Creature.ts";
import type { MutatorInterface } from "./MutatorInterface.ts";

export class SubConnection implements MutatorInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  /**
   * Subtract a connection from the network.
   *
   * @param {number[]} [focusList] - The list of focus indices.
   */
  public mutate(focusList?: number[]): boolean {
    // List of possible connections that can be removed
    const possible = [];

    for (let i = 0; i < this.creature.synapses.length; i++) {
      const conn = this.creature.synapses[i];
      // Check if it is not disabling a node
      if (conn.to > conn.from) {
        if (
          this.creature.inFocus(conn.to, focusList) ||
          this.creature.inFocus(conn.from, focusList)
        ) {
          possible.push(conn);
        }
      }
    }

    if (possible.length === 0) {
      return false;
    }

    const randomConn = possible[Math.floor(Math.random() * possible.length)];
    this.creature.disconnect(randomConn.from, randomConn.to);
    return true;
  }
}
