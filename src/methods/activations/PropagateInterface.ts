import { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import { Node } from "../../architecture/Node.ts";
import { BackPropagationConfig } from "../../architecture/BackPropagation.ts";

/** Apply any learnings from the training */
export interface PropagateInterface extends AbstractActivationInterface {
  propagate(
    node: Node,
    targetActivation: number,
    config: BackPropagationConfig,
  ): number;
}
