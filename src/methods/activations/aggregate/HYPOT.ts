import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class HYPOT implements NodeActivationInterface {
  public static NAME = "HYPOT";

  getName() {
    return HYPOT.NAME;
  }

  activate(node: Node) {
    const values: number[] = [];

    const connections = node.util.toConnections(node.index);
    connections.forEach((c) => {
      const fromNode = node.util.getNode(c.from);
      values.push(
        fromNode.getActivation() * c.weight,
      );
    });

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
