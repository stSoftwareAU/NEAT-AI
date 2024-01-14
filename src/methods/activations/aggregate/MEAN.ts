import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";
import {
  limitActivation,
  limitValue,
} from "../../../architecture/BackPropagation.ts";

export class MEAN implements NodeActivationInterface {
  public static NAME = "MEAN";

  getName() {
    return MEAN.NAME;
  }

  range(): { low: number; high: number } {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }

  noTraceActivate(node: Node) {
    let sum = 0;

    const toList = node.creature.toConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const fromActivation = node.creature.getActivation(c.from);
      const activation = limitActivation(fromActivation);

      sum += activation * c.weight;
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
    const toList = node.creature.toConnections(node.index);

    if (toList.length < 2) {
      node.creature.makeRandomConnection(node.index);
    }
  }
}
