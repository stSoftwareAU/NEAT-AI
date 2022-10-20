import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class MAXIMUM implements NodeActivationInterface {
  public static NAME = "MAXIMUM";

  getName() {
    return MAXIMUM.NAME;
  }

  noTraceActivate(node: Node) {
    const toList = node.util.toConnections(node.index);
    let maxValue = Infinity * -1;
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = node.util.networkState.node(c.from).activation * c.weight;
      if (value > maxValue) {
        maxValue = value;
      }
    }

    return maxValue;
  }

  activate(node: Node) {
    const toList = node.util.toConnections(node.index);
    let maxValue = Infinity * -1;
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = node.util.networkState.node(c.from).activation * c.weight;
      if (value > maxValue) {
        maxValue = value;
      }
    }

    return maxValue;
  }

  fix(node: Node) {
    const toList = node.util.toConnections(node.index);

    if (toList.length < 2) {
      node.util.makeRandomConnection(node.index);
    }
  }
}
