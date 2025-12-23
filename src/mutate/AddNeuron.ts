import { assert } from "@std/assert";
import { CreatureUtil } from "../../mod.ts";
import type { Creature } from "../Creature.ts";
import { Neuron } from "../architecture/Neuron.ts";
import { Synapse } from "../architecture/Synapse.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";

export class AddNeuron implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  /**
   * Add a neuron to the network.
   *
   * @param {number[]} [focusList] - The list of focus indices.
   */
  public mutate(focusList?: number[]): boolean {
    const creature = this.creature;
    const startUUID = CreatureUtil.makeUUID(creature);
    delete creature.uuid;
    const neuron = new Neuron(
      crypto.randomUUID(),
      "hidden",
      Math.random() * 0.2 - 0.1,
      creature,
    );

    let indx = Math.floor(
      Math.random() *
        (creature.neurons.length - creature.output - creature.input + 1),
    ) + creature.input;

    while (creature.neurons[indx].type === "constant") {
      indx++;
    }
    neuron.index = indx;
    this.insertNeuron(neuron);

    let tmpFocusList = focusList;
    let fromIndex = -1;
    let toIndex = -1;

    for (let attempts = 0; attempts < 12; attempts++) {
      if (attempts >= 9) {
        /* Should work first time once we remove the "focus" */
        tmpFocusList = undefined;
      }
      if (fromIndex === -1) {
        const pos = Math.floor(
          Math.random() * neuron.index,
        );

        assert(neuron.index > pos, "From should be less than neuron index");
        assert(pos >= 0, "Position should be non-negative");

        if (creature.inFocus(pos, tmpFocusList)) {
          fromIndex = pos;
        }
      } else if (toIndex === -1) {
        const pos = Math.floor(
          Math.random() * (creature.neurons.length - neuron.index),
        ) + neuron.index;

        assert(neuron.index <= pos, "Index should not be less than position");

        if (creature.inFocus(pos, tmpFocusList)) {
          toIndex = pos;
        }
      } else {
        break;
      }
    }

    // Create inward connection (from source to new neuron)
    // If fromIndex wasn't found, fix() will handle it
    if (fromIndex !== -1) {
      creature.connect(
        fromIndex,
        neuron.index,
        Synapse.randomWeight(),
      );
    }

    // Find a valid non-constant target neuron for the outward connection
    // We must ensure this always succeeds to keep the creature valid
    let targetNeuronIndex = -1;

    // First, try to use the originally selected toIndex if it's valid and non-constant
    if (toIndex !== -1) {
      const nonConstantIndx = creature.neurons.findIndex((
        n,
      ) => (n.index >= toIndex && n.type !== "constant"));

      if (nonConstantIndx !== -1) {
        targetNeuronIndex = creature.neurons[nonConstantIndx].index;
      }
    }

    // If we don't have a target yet, use fallback logic.
    if (targetNeuronIndex === -1) {
      // If the original toIndex doesn't work, find any valid target after the neuron
      for (let i = neuron.index + 1; i < creature.neurons.length; i++) {
        const candidate = creature.neurons[i];
        if (candidate && candidate.type !== "constant") {
          targetNeuronIndex = candidate.index;
          break;
        }
      }

      // If still no target found, use the first output neuron.
      // This is always a forward connection because new neurons are only inserted
      // before outputs.
      if (targetNeuronIndex === -1) {
        const firstOutputIndex = creature.neurons.length - creature.output;
        const outputNeuron = creature.neurons[firstOutputIndex];
        assert(outputNeuron, "Expected at least one output neuron");
        targetNeuronIndex = outputNeuron.index;
      }
    }

    // Ensure we always have a valid target (should never be -1 with our fallbacks)
    if (targetNeuronIndex === -1) {
      throw new Error(
        "AddNeuron: failed to find a valid outward connection target",
      );
    }

    // Find a target that doesn't already have a connection from this neuron
    // This ensures we can always create a new connection
    while (creature.getSynapse(neuron.index, targetNeuronIndex)) {
      // Connection already exists, find a different target
      let foundNewTarget = false;
      for (let i = neuron.index + 1; i < creature.neurons.length; i++) {
        const candidate = creature.neurons[i];
        if (candidate && candidate.type !== "constant") {
          if (!creature.getSynapse(neuron.index, candidate.index)) {
            targetNeuronIndex = candidate.index;
            foundNewTarget = true;
            break;
          }
        }
      }
      // If we can't find a target without an existing connection, keep the
      // existing outward connection and stop searching.
      if (!foundNewTarget) {
        break;
      }
    }

    // Create the connection only if it doesn't already exist
    // This prevents assertion errors from duplicate connections
    if (!creature.getSynapse(neuron.index, targetNeuronIndex)) {
      creature.connect(
        neuron.index,
        targetNeuronIndex,
        Synapse.randomWeight(),
      );
    }

    // Fix the neuron as a last resort to handle any edge cases
    // This ensures the neuron has both inward and outward connections
    neuron.fix();

    // Critical: Verify the neuron has an outward connection after all operations
    // This is a hard requirement - the neuron MUST have an outward connection
    // Clear cache to ensure we get fresh data
    creature.clearCache(neuron.index);
    let outwardConnections = creature.outwardConnections(neuron.index);

    // If no outward connection exists, we MUST create one
    if (outwardConnections.length === 0) {
      // Find any valid target that doesn't have a connection yet
      let connectionCreated = false;
      for (let i = neuron.index + 1; i < creature.neurons.length; i++) {
        const candidate = creature.neurons[i];
        if (candidate && candidate.type !== "constant") {
          // Check if connection doesn't exist before creating
          if (!creature.getSynapse(neuron.index, candidate.index)) {
            creature.connect(
              neuron.index,
              candidate.index,
              Synapse.randomWeight(),
            );
            connectionCreated = true;
            break;
          }
        }
      }

      // If we couldn't create a new connection, all targets are already connected
      // This means the neuron HAS connections, but cache might be stale
      // Clear cache and verify one more time
      if (!connectionCreated) {
        creature.clearCache(neuron.index);
        outwardConnections = creature.outwardConnections(neuron.index);
        // If still empty after cache clear, fall back.
        if (outwardConnections.length === 0) {
          throw new Error(
            "AddNeuron: failed to create outward connection (unexpected: neuron is not connected to any later neuron)",
          );
        }
      }
    }

    // delete this.creature.memetic;
    const endUUID = CreatureUtil.makeUUID(creature);
    if (startUUID === endUUID) {
      console.warn("AddNeuron: No change.");
      return false;
    } else {
      return true;
    }
  }

  private insertNeuron(neuron: Neuron) {
    assert(Number.isInteger(neuron.index), "Should have an integer index");
    assert(
      neuron.index >= this.creature.input,
      "Should not be within the observations",
    );

    const firstOutputIndex = this.creature.neurons.length -
      this.creature.output;
    assert(
      neuron.index <= firstOutputIndex,
      "Should not be in the output range",
    );

    assert(neuron.type === "hidden", neuron.type);

    const left = this.creature.neurons.slice(0, neuron.index);
    const right = this.creature.neurons.slice(neuron.index);
    right.forEach((n) => {
      n.index++;
    });

    const full = [...left, neuron, ...right];

    this.creature.neurons = full;

    // Update all synapse indices to account for the new neuron
    // This must preserve all synapse properties including type
    this.creature.synapses.forEach((c) => {
      if (c.from >= neuron.index) {
        c.from++;
      }
      if (c.to >= neuron.index) {
        c.to++;
      }
    });

    // Re-sort synapses after index updates to maintain sort order
    // This is critical for correct connection lookups
    this.creature.synapses.sort((a, b) => {
      if (a.from === b.from) {
        return a.to - b.to;
      }
      return a.from - b.from;
    });

    // Clear cache to force rebuild with updated indices
    this.creature.clearCache();
  }
}
