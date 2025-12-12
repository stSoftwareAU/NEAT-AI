import {
  cleanupOrphanedNeuronsInCreature,
  removeHiddenNeuron,
} from "../compact/CompactUtils.ts";
import type { Creature } from "../Creature.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";

export class SubConnection implements RadioactiveInterface {
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
      // Check if it is not disabling a node (forward connections only)
      if (conn.to > conn.from) {
        if (
          this.creature.inFocus(conn.to, focusList) ||
          this.creature.inFocus(conn.from, focusList)
        ) {
          // Post-removal logic handles neurons left with 0 connections:
          // - Hidden neurons with 0 inward connections become constants
          // - Hidden neurons with 0 outward connections are removed
          possible.push(conn);
        }
      }
    }

    if (possible.length === 0) {
      return false;
    }

    const randomConn = possible[Math.floor(Math.random() * possible.length)];
    this.creature.disconnect(randomConn.from, randomConn.to);

    delete this.creature.memetic;

    // Check if the 'to' neuron has lost all inward connections
    const inwardList = this.creature.inwardConnections(randomConn.to);
    if (inwardList.length === 0) {
      const neuron = this.creature.neurons[randomConn.to];
      if (neuron.type === "hidden") {
        // Check if this neuron also has no outward connections
        const outwardList = this.creature.outwardConnections(randomConn.to);
        if (outwardList.length === 0) {
          // No inward or outward connections - remove entirely
          removeHiddenNeuron(this.creature, randomConn.to);
        } else {
          // Has outward connections - convert to constant
          const squash = neuron.findSquash();
          const activation = squash as ActivationInterface;
          if (activation.squash) {
            const constantBias = activation.squash(neuron.bias);
            neuron.bias = constantBias;
          }
          neuron.type = "constant";
          neuron.setSquash(undefined);
        }
      }
    }

    // Clean up any neurons that have become orphaned (no outward connections)
    // This handles cascade removal when removing a synapse leaves neurons dangling
    cleanupOrphanedNeuronsInCreature(this.creature);

    return true;
  }
}
