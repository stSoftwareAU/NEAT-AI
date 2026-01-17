import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import type { Synapse } from "../architecture/Synapse.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";

export class ModWeight implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }
  mutate(focusList?: number[]): boolean {
    let relevantConnections: Synapse[];

    if (!focusList || focusList.length === 0) {
      // No focus - use all connections
      relevantConnections = this.creature.synapses;
    } else {
      // Collect synapses connected to focused neurons using indexed lookups
      // This is O(focusList.length * (log n + k)) instead of O(synapses * focusList)
      const seen = new Set<Synapse>();
      for (const focusIndex of focusList) {
        // Get outward connections from focus neuron
        for (const syn of this.creature.outwardConnections(focusIndex)) {
          seen.add(syn);
        }
        // Get inward connections to focus neuron
        for (const syn of this.creature.inwardConnections(focusIndex)) {
          seen.add(syn);
        }
      }
      relevantConnections = Array.from(seen);
    }

    let changed = false;
    if (relevantConnections.length > 0) {
      const indx = Math.floor(Math.random() * relevantConnections.length);
      const connection = relevantConnections[indx];

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
