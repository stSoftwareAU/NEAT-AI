import type { AbstractActivationInterface } from "@methods/activations/AbstractActivationInterface.ts";
import type { Neuron } from "@architecture/Neuron.ts";

export interface NeuronFixableInterface extends AbstractActivationInterface {
  fix(node: Neuron): void;
}
