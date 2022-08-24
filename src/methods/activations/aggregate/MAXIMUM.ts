import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class MAXIMUM implements NodeActivationInterface {
  public static NAME = "MAXIMUM";

  getName() {
    return MAXIMUM.NAME;
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

    const value = Math.max(...values);
    return value;
  }
}
