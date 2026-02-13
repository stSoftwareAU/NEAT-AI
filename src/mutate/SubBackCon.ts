import { removeHiddenNeuron } from "../compact/CompactUtils.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { AbstractMutationOperator } from "./AbstractMutationOperator.ts";
import { getLogger } from "../utils/Logger.ts";

export class SubBackCon extends AbstractMutationOperator {
  protected performMutation(focusList?: number[]): boolean {
    // Create an array of all back connections that can be removed
    const available = [];
    for (
      let to = this.creature.input;
      to < this.creature.neurons.length;
      to++
    ) {
      if (this.creature.inFocus(to, focusList)) {
        for (let from = 0; from < to; from++) {
          if (this.creature.inFocus(from, focusList)) {
            if (this.creature.getSynapse(from, to) !== null) {
              // Post-removal logic will handle cleanup
              available.push([from, to]);
            }
          }
        }
      }
    }

    if (available.length === 0) {
      return false;
    }

    const pair = available[Math.floor(Math.random() * available.length)];
    this.creature.disconnect(pair[0], pair[1]);

    delete this.creature.memetic;

    // Cleanup: Check if TO neuron needs handling
    const inwardList = this.creature.inwardConnections(pair[1]);
    let toNeuronRemoved = false;
    if (inwardList.length === 0) {
      const toNeuron = this.creature.neurons[pair[1]];
      if (toNeuron.type === "hidden") {
        const outwardList = this.creature.outwardConnections(pair[1]);
        if (outwardList.length === 0) {
          getLogger().info(
            `Remove neuron ${toNeuron.uuid} as completely disconnected`,
          );
          removeHiddenNeuron(this.creature, pair[1]);
          toNeuronRemoved = true;
        } else {
          getLogger().info(
            `Convert neuron ${toNeuron.uuid} from ${toNeuron.type} to constant`,
          );
          const squash = toNeuron.findSquash();
          const activation = squash as ActivationInterface;
          if (activation.squash) {
            const constantBias = activation.squash(toNeuron.bias);
            getLogger().info(
              `Adjust neuron ${toNeuron.uuid} bias ${toNeuron.bias} to ${constantBias}`,
            );
            toNeuron.bias = constantBias;
          }
          toNeuron.type = "constant";
          toNeuron.setSquash(undefined);
        }
      }
    }

    // Adjust the 'from' index if the 'to' neuron was removed and it came before the 'from' neuron
    let fromIndex = pair[0];
    if (toNeuronRemoved && pair[1] < pair[0]) {
      fromIndex--;
    }
    // Cleanup: Check if FROM neuron needs removal
    const fromOutwardList = this.creature.outwardConnections(fromIndex);
    if (fromOutwardList.length === 0) {
      const fromNeuron = this.creature.neurons[fromIndex];
      if (fromNeuron.type === "hidden" || fromNeuron.type === "constant") {
        getLogger().info(
          `Remove neuron ${fromNeuron.uuid} as no longer connected`,
        );
        removeHiddenNeuron(this.creature, fromIndex);
      }
    }

    return true;
  }
}
