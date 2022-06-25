import { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import { Node } from "../../architecture/Node.ts";

export interface NodeActivationInterface extends AbstractActivationInterface {
  activate(node: Node): number;
}
