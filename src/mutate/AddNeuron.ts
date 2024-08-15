import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import { Mutation } from "../NEAT/Mutation.ts";
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
    const neuron = new Neuron(
      crypto.randomUUID(),
      "hidden",
      undefined,
      creature,
    );

    // Random squash function
    neuron.mutate(Mutation.MOD_ACTIVATION.name);

    let indx = Math.floor(
      Math.random() *
        (creature.neurons.length - creature.output - creature.input + 1),
    ) + creature.input;

    while (creature.neurons[indx].type == "constant") {
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

    creature.connect(
      fromIndex,
      neuron.index,
      Synapse.randomWeight(),
    );

    assert(toIndex !== -1, "addNeuron: Should have a to index");

    const nonConstantIndx = creature.neurons.findIndex((
      n,
    ) => (n.index >= toIndex && n.type !== "constant"));
    creature.connect(
      neuron.index,
      nonConstantIndx,
      Synapse.randomWeight(),
    );
    neuron.fix();
    const connection = creature.getSynapse(neuron.index, nonConstantIndx);
    if (!connection) {
      /* If the self connection was removed */
      const toIndex2 = Math.floor(
        Math.random() * (creature.neurons.length - neuron.index - 1),
      ) + neuron.index + 1;

      const nonConstantIndx2 = creature.neurons.findIndex((
        n,
      ) => (n.index >= toIndex2 && n.type !== "constant"));

      creature.connect(
        neuron.index,
        nonConstantIndx2,
        Synapse.randomWeight(),
      );
    }

    return true;
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
