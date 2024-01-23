import { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import { Neuron } from "../../architecture/Neuron.ts";
import { BackPropagationConfig } from "../../architecture/BackPropagation.ts";

/** Apply any learnings from the training */
export interface PropagateInterface extends AbstractActivationInterface {
  propagate(
    node: Neuron,
    targetActivation: number,
    config: BackPropagationConfig,
  ): number;
}
