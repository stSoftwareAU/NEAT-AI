import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import type { Neuron } from "./Neuron.ts";

/**
 * Static function for constant activation.
 */
export function constantActivation(
  bias: number,
): (activations: Float32Array) => number {
  return () => bias;
}

export function squashActivation(
  neuron: Neuron,
  activationSquash: NeuronActivationInterface,
): (activations: Float32Array) => number {
  return () => {
    return activationSquash.activate(neuron);
  };
}

export function linearActivation(
  neuron: Neuron,
  activationSquash: ActivationInterface,
): (activations: Float32Array) => number {
  return (activations: Float32Array) => {
    let value = neuron.bias;
    const inwardList = neuron.creature.inwardConnections(neuron.index);

    for (let i = inwardList.length; i--;) {
      const c = inwardList[i];

      value += activations[c.from] * c.weight;
    }

    // Squash the values received
    return activationSquash.squash(value);
  };
}
