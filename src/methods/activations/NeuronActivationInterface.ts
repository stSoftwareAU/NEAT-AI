import { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import { Neuron } from "../../architecture/Neuron.ts";
import { BackPropagationConfig } from "../../architecture/BackPropagation.ts";

export interface NeuronActivationInterface extends AbstractActivationInterface {
  activateAndTrace(node: Neuron): number;
  activate(node: Neuron): number;
  propagate(
    node: Neuron,
    targetActivation: number,
    config: BackPropagationConfig,
  ): number;
}
