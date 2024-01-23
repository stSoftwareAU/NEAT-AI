import { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import { Neuron } from "../../architecture/Neuron.ts";

/** Apply any learnings from the training */
export interface ApplyLearningsInterface extends AbstractActivationInterface {
  applyLearnings(node: Neuron): boolean;
}
