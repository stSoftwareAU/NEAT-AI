import type { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import type { Neuron } from "../../architecture/Neuron.ts";

/** Apply any learnings from the training */
export interface ApplyLearningsInterface extends AbstractActivationInterface {
  applyLearnings(node: Neuron): boolean;
}
