import { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import { Node } from "../../architecture/Node.ts";

export interface NodeFixableInterface extends AbstractActivationInterface {
  fix(node: Node): void;
}
