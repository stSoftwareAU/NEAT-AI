import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";
import {
  limitActivation,
  limitValue,
  limitWeight,
} from "../../../architecture/BackPropagation.ts";

export class MEAN implements NodeActivationInterface {
  public static NAME = "MEAN";

  getName() {
    return MEAN.NAME;
  }

  noTraceActivate(node: Node) {
    let sum = 0;

    const toList = node.network.toConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const fromActivation = node.network.getActivation(c.from);
      const activation = limitActivation(fromActivation);

      sum += activation * limitWeight(c.weight);
      if (Number.isFinite(sum) == false) {
        throw new Error(
          `Node: ${node.uuid} connection: ${
            c.from + ":" + c.to
          }, SUM: ${sum} is not finite. From Activation: ${fromActivation}, Activation: ${activation}, Weight: ${c.weight}`,
        );
      }
    }

    const value = limitValue(sum / toList.length);
    if (Number.isFinite(value) == false) {
      throw new Error(
        `Node: ${node.uuid} MEAN: ${value} is not finite sum: ${sum} toList.length: ${toList.length}`,
      );
    }
    return value;
  }

  activate(node: Node) {
    return this.noTraceActivate(node);
  }

  fix(node: Node) {
    const toList = node.network.toConnections(node.index);

    if (toList.length < 2) {
      node.network.makeRandomConnection(node.index);
    }
  }
}
