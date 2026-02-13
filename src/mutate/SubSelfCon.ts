import { removeHiddenNeuron } from "../compact/CompactUtils.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { AbstractMutationOperator } from "./AbstractMutationOperator.ts";
import { getLogger } from "../utils/Logger.ts";

export class SubSelfCon extends AbstractMutationOperator {
  protected performMutation(focusList?: number[]): boolean {
    // Check which neurons have safely removable self-connections
    const possible = [];
    for (let i = this.creature.input; i < this.creature.neurons.length; i++) {
      if (this.creature.inFocus(i, focusList)) {
        const neuron = this.creature.neurons[i];
        const indx = neuron.index;
        const c = this.creature.getSynapse(indx, indx);
        if (c !== null) {
          // Only add to possible if it's safe to remove (not the only outward connection)
          if (
            neuron.type === "hidden" &&
            this.creature.outwardConnections(indx).length <= 1
          ) {
            continue;
          }
          possible.push(neuron);
        }
      }
    }

    if (possible.length === 0) {
      return false;
    }

    // All neurons in possible are safe to disconnect, so just pick one
    const neuron = possible[Math.floor(Math.random() * possible.length)];
    const indx = neuron.index;

    this.creature.disconnect(indx, indx);

    delete this.creature.memetic;

    // Cleanup: Check if neuron now needs handling after losing self-connection
    const inwardList = this.creature.inwardConnections(indx);
    if (inwardList.length === 0 && neuron.type === "hidden") {
      const outwardList = this.creature.outwardConnections(indx);
      if (outwardList.length === 0) {
        getLogger().info(
          `Remove neuron ${neuron.uuid} as completely disconnected`,
        );
        removeHiddenNeuron(this.creature, indx);
      } else {
        getLogger().info(
          `Convert neuron ${neuron.uuid} from ${neuron.type} to constant`,
        );
        const squash = neuron.findSquash();
        const activation = squash as ActivationInterface;
        if (activation.squash) {
          const constantBias = activation.squash(neuron.bias);
          getLogger().info(
            `Adjust neuron ${neuron.uuid} bias ${neuron.bias} to ${constantBias}`,
          );
          neuron.bias = constantBias;
        }
        neuron.type = "constant";
        neuron.setSquash(undefined);
      }
    }

    return true;
  }
}
