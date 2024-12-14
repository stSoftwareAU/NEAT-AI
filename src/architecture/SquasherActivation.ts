import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import type { Neuron } from "./Neuron.ts";
import type { SquasherInterface } from "./SquasherInterface.ts";

export class SquashActivation implements SquasherInterface {
  private neuron: Neuron;
  private activationSquash: NeuronActivationInterface;
  constructor(neuron: Neuron, activationSquash: NeuronActivationInterface) {
    this.neuron = neuron;
    this.activationSquash = activationSquash;
  }

  squash(): number {
    return this.activationSquash.activate(this.neuron);
  }
}
