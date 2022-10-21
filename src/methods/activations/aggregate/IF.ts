import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class IF implements NodeActivationInterface {
  public static NAME = "IF";

  getName() {
    return IF.NAME;
  }

  fix(node: Node) {
    const toList = node.util.toConnections(node.index);
    const spareList = [];
    let foundPositive = false;
    let foundCondition = false;
    let foundNegative = false;

    for (let i = toList.length; i--;) {
      const c = toList[i];
      if (c.type == "condition") {
        if (foundCondition) {
          spareList.push(c);
        } else {
          foundCondition = true;
        }
      } else if (c.type == "negative") {
        if (foundNegative) {
          spareList.push(c);
        } else {
          foundNegative = true;
        }
      } else if (c.type == "positive") {
        if (foundPositive) {
          spareList.push(c);
        } else {
          foundPositive = true;
        }
      }
    }

    for (let i = toList.length; i--;) {
      const c = toList[i];
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
        } else {
          switch (Math.floor(Math.random() * 3)) {
            case 0:
              c.type = "condition";
              break;
            case 1:
              c.type = "negative";
              break;
            default:
              c.type = "positive";
          }
        }
      }
    }

    if (!foundCondition) {
      const c = node.util.makeRandomConnection(node.index);
      if (c) {
        c.type = "condition";
        foundCondition = true;
      }
    }

    if (!foundNegative) {
      const c = node.util.makeRandomConnection(node.index);

      if (c) {
        c.type = "negative";
        foundNegative = true;
      }
    }

    if (!foundPositive) {
      const c = node.util.makeRandomConnection(node.index);

      if (c) {
        c.type = "positive";
        foundPositive = true;
      }
    }

    if (!foundCondition) {
      const c = spareList.pop();
      if (c) {
        foundCondition = true;
        c.type = "condition";
      }
    }

    if (!foundNegative) {
      const c = spareList.pop();
      if (c) {
        foundNegative = true;
        c.type = "negative";
      }
    }
    if (!foundPositive) {
      const c = spareList.pop();
      if (c) {
        foundPositive = true;
        c.type = "positive";
      }
    }

    const toList2 = node.util.toConnections(node.index);

    if (toList2.length < 3 && node.index > 2) {
      console.trace();
      throw "Should have 3 or more connections was: " + toList2.length;
    }

    if (!foundCondition || !foundNegative || !foundPositive) {
      console.info("missing connections", toList2);
    }
  }

  activate(node: Node) {
    let condition = 0;
    let negative = 0;
    let positive = 0;

    const toList = node.util.toConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = node.util.networkState.node(c.from).activation * c.weight;

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
    }

    return condition > 0 ? positive : negative;
  }

  noTraceActivate(node: Node): number {
    let condition = 0;
    let negative = 0;
    let positive = 0;

    const toList = node.util.toConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = node.util.networkState.node(c.from).activation * c.weight;

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
    }

    return condition > 0 ? positive : negative;
  }
}
