import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import type { Neuron } from "./Neuron.ts";
import type { SquasherInterface } from "./SquasherInterface.ts";

export class SquasherActivation implements SquasherInterface {
  private readonly neuron: Neuron;
  private readonly activationSquash: NeuronActivationInterface;

  constructor(neuron: Neuron, activationSquash: NeuronActivationInterface) {
    this.neuron = neuron;
    this.activationSquash = activationSquash;
  }
  squashAndTrace(): number {
    return this.activationSquash.activateAndTrace(this.neuron);
  }

  squash(): number {
    return this.activationSquash.activate(this.neuron);
  }
}
