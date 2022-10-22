import { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import { Node } from "../../architecture/Node.ts";

/** Apply any learnings from the training */
export interface ApplyLearningsInterface extends AbstractActivationInterface {
  applyLearnings(node: Node): boolean;
}
