import { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import { Node } from "../../architecture/Node.ts";

export interface NodeActivationInterface extends AbstractActivationInterface {
  activateAndTrace(node: Node): number;
  activate(node: Node): number;
}
