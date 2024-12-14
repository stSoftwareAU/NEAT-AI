import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import type { Neuron } from "./Neuron.ts";
import type { SquasherInterface } from "./SquasherInterface.ts";

export class SquashLinear implements SquasherInterface {
  private neuron: Neuron;
  private activationSquash: ActivationInterface;
  constructor(neuron: Neuron, activationSquash: ActivationInterface) {
    this.neuron = neuron;
    this.activationSquash = activationSquash;
  }

  squash(activations: Float32Array): number {
    const neuron = this.neuron;
    let value = neuron.bias;
    const inwardList = neuron.creature.inwardConnections(neuron.index);

    for (let i = inwardList.length; i--;) {
      const c = inwardList[i];

      value += activations[c.from] * c.weight;
    }

    // Squash the values received
    return this.activationSquash.squash(value);
  }
}
