import type { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import type { Neuron } from "../../architecture/Neuron.ts";
import type { BackPropagationConfig } from "../../architecture/BackPropagation.ts";

export interface NeuronActivationInterface extends AbstractActivationInterface {
  activateAndTrace(node: Neuron): number;
  activate(node: Neuron): number;
  propagate(
    node: Neuron,
    targetActivation: number,
    config: BackPropagationConfig,
  ): number;
}
