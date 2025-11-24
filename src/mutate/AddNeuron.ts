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

    assert(fromIndex !== -1, "addNeuron: Should have a from index");

    // Create inward connection (from source to new neuron)
    creature.connect(
      fromIndex,
      neuron.index,
      Synapse.randomWeight(),
    );

    assert(toIndex !== -1, "addNeuron: Should have a to index");

    // Find a valid non-constant target neuron for the outward connection
    // We must ensure this always succeeds to keep the creature valid
    let targetNeuronIndex = -1;

    // First, try to use the originally selected toIndex if it's non-constant
    const nonConstantIndx = creature.neurons.findIndex((
      n,
    ) => (n.index >= toIndex && n.type !== "constant"));

    if (nonConstantIndx !== -1) {
      targetNeuronIndex = creature.neurons[nonConstantIndx].index;
    } else {
      // If the original toIndex doesn't work, find any valid target after the neuron
      for (let i = neuron.index + 1; i < creature.neurons.length; i++) {
        const candidate = creature.neurons[i];
        if (candidate && candidate.type !== "constant") {
          targetNeuronIndex = candidate.index;
          break;
        }
      }

      // If still no target found, use the first output neuron
      if (targetNeuronIndex === -1) {
        const firstOutputIndex = creature.neurons.length - creature.output;
        if (
          firstOutputIndex >= 0 && firstOutputIndex < creature.neurons.length
        ) {
          const outputNeuron = creature.neurons[firstOutputIndex];
          if (outputNeuron) {
            targetNeuronIndex = outputNeuron.index;
          }
        }
      }

      // Last resort: self-connection (ensures neuron always has outward connection)
      if (targetNeuronIndex === -1) {
        targetNeuronIndex = neuron.index;
      }
    }

    // Create outward connection (from new neuron to target)
    // This must always succeed to keep the creature in a valid state
    assert(
      targetNeuronIndex !== -1,
      `Failed to find valid target for outward connection from neuron ${neuron.index}`,
    );

    creature.connect(
      neuron.index,
      targetNeuronIndex,
      Synapse.randomWeight(),
    );

    // Verify the neuron has both connections before calling fix
    // fix() should only handle edge cases, not be the primary mechanism
    const inwardConnections = creature.inwardConnections(neuron.index);
    const outwardConnections = creature.outwardConnections(neuron.index);

    assert(
      inwardConnections.length > 0,
      `Neuron ${neuron.index} has no inward connections after creation`,
    );
    assert(
      outwardConnections.length > 0,
      `Neuron ${neuron.index} has no outward connections after creation`,
    );

    // Fix the neuron (should be a no-op if connections are already valid)
    neuron.fix();

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

    this.creature.synapses.forEach((c) => {
      if (c.from >= neuron.index) c.from++;
      if (c.to >= neuron.index) c.to++;
    });

    this.creature.clearCache();
  }
}
