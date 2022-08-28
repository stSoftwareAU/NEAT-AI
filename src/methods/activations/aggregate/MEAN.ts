import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class MEAN implements NodeActivationInterface {
  public static NAME = "MEAN";

  getName() {
    return MEAN.NAME;
  }

  activate(node: Node) {
    let sum = 0;

    let count = 0;
    const connections = node.util.toConnections(node.index);
    connections.forEach((c) => {
      const fromNode = node.util.getNode(c.from);
      sum += fromNode.getActivation() * c.weight;

      count++;
    });

    const value = sum / count;
    return value;
  }

  fix(node: Node) {
    const toList = node.util.toConnections(node.index);

    if (toList.length < 2) {
      node.util.makeRandomConnection(node.index);
    }
  }
}
