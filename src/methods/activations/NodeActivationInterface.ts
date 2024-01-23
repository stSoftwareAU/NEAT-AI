import { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import { Neuron } from "../../architecture/Neuron.ts";

export interface NodeActivationInterface extends AbstractActivationInterface {
  activateAndTrace(node: Neuron): number;
  activate(node: Neuron): number;
}
