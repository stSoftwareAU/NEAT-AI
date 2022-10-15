import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class MINIMUM implements NodeActivationInterface {
  public static NAME = "MINIMUM";

  getName() {
    return MINIMUM.NAME;
  }

  activate(node: Node) {
    const toList = node.util.toConnections(node.index);
    let minValue = Infinity;
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = node.util.networkState.node(c.from).activation * c.weight;
      if (value < minValue) {
        minValue = value;
      }
    }

    return minValue;
  }

  fix(node: Node) {
    const toList = node.util.toConnections(node.index);

    if (toList.length < 2) {
      node.util.makeRandomConnection(node.index);
    }
  }
}
