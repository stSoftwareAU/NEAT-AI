import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class IF implements NodeActivationInterface {
  public static NAME = "IF";

  getName() {
    return IF.NAME;
  }

  fix(node: Node) {
    const toList = node.util.toConnections(node.index);

    let foundPositive = false;
    let foundCondition = false;
    let foundNegative = false;

    for (let i = toList.length; i--;) {
      const c = toList[i];
      if (c.type == "condition") {
        foundCondition = true;
      } else if (c.type == "negative") {
        foundNegative = true;
      } else if (c.type == "positive") {
        foundPositive = true;
      }
    }

    toList.forEach((c) => {
      if (c.type === undefined) {
        if (!foundCondition) {
          foundCondition = true;
          c.type = "condition";
        } else if (!foundNegative) {
          foundNegative = true;
          c.type = "negative";
        } else if (!foundPositive) {
          foundPositive = true;
          c.type = "positive";
        }
      }
    });

    if (!foundCondition) {
      const c = node.util.makeRandomConnection(node.index);
      if (c) c.type = "condition";
    }

    if (!foundNegative) {
      const c = node.util.makeRandomConnection(node.index);
      if (c) c.type = "negative";
    }

    if (!foundPositive) {
      const c = node.util.makeRandomConnection(node.index);
      if (c) c.type = "positive";
    }
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
