import { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import { Neuron } from "../../architecture/Neuron.ts";

export interface NodeFixableInterface extends AbstractActivationInterface {
  fix(node: Neuron): void;
}
