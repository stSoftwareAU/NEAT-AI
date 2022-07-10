import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class IF implements NodeActivationInterface {
  public static NAME = "IF";

  getName() {
    return IF.NAME;
  }

  activate(node: Node) {
    let condition = 0;
    let negative = 0;
    let positive = 0;

    const connections = node.util.toConnections(node.index);
    connections.forEach((c) => {
      const fromNode = node.util.getNode(c.from);
      const value = fromNode.getActivation() * c.weight;
      switch (c.type) {
        case "condition":
          condition += value;
          break;
        case "negative":
          negative += value;
          break;
        default:
          positive += value;
      }
    });

    return condition > 0 ? positive : negative;
  }
}
