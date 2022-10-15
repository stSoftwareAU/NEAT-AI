import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class HYPOT implements NodeActivationInterface {
  public static NAME = "HYPOT";

  getName() {
    return HYPOT.NAME;
  }

  activate(node: Node) {
    const toList = node.util.toConnections(node.index);
    const values: number[] = new Array(toList.length);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      values[i] = node.util.networkState.node(c.from).activation * c.weight;
    }

    const value = Math.hypot(...values);
    return value;
  }

  fix(node: Node) {
    const toList = node.util.toConnections(node.index);

    if (toList.length < 2) {
      node.util.makeRandomConnection(node.index);
    }
  }
}
