import type { Creature } from "../Creature.ts";
import { Mutation } from "../NEAT/Mutation.ts";
import { Neuron } from "../architecture/Neuron.ts";
import { Synapse } from "../architecture/Synapse.ts";
import type { MutatorInterface } from "./MutatorInterface.ts";

export class AddNeuron implements MutatorInterface {
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

        if (neuron.index <= pos || pos < 0) {
          throw new Error(
            `From: ${pos} should be less than neuron index: ${neuron.index}`,
          );
        }
        if (creature.inFocus(pos, tmpFocusList)) {
          fromIndex = pos;
        }
      } else if (toIndex === -1) {
        const pos = Math.floor(
          Math.random() * (creature.neurons.length - neuron.index),
        ) + neuron.index;

        if (neuron.index > pos) {
          throw new Error(
            "To: " + pos + " should be greater than neuron index: " +
              neuron.index,
          );
        }

        if (creature.inFocus(pos, tmpFocusList)) {
          toIndex = pos;
        }
      } else {
        break;
      }
    }

    if (fromIndex !== -1) {
      creature.connect(
        fromIndex,
        neuron.index,
        Synapse.randomWeight(),
      );
    } else {
      throw new Error("addNeuron: Should have a from index");
    }

    if (toIndex !== -1) {
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
    } else {
      throw new Error("addNeuron: Should have a to index");
    }
    return true;
  }

  private insertNeuron(neuron: Neuron) {
    if (
      Number.isInteger(neuron.index) == false ||
      neuron.index < this.creature.input
    ) {
      throw new Error(
        "to should be a greater than the input count was: " + neuron.index,
      );
    }

    const firstOutputIndex = this.creature.neurons.length -
      this.creature.output;
    if (neuron.index > firstOutputIndex) {
      throw new Error(
        "to should be a between than input (" + this.creature.input +
          ") and output neurons (" + firstOutputIndex + ") was: " +
          neuron.index,
      );
    }

    if (neuron.type !== "hidden") {
      throw new Error("Should be a 'hidden' type was: " + neuron.type);
    }
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
