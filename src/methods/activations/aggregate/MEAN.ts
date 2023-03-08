import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

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

      sum += node.network.getActivation(c.from) * c.weight;
    }

    const value = sum / toList.length;
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
