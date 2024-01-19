import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class HYPOT implements NodeActivationInterface {
  range(): { low: number; high: number } {
    return { low: 0, high: Number.POSITIVE_INFINITY };
  }

  public static NAME = "HYPOT";

  getName() {
    return HYPOT.NAME;
  }

  activate(node: Node) {
    const toList = node.creature.toConnections(node.index);
    const values: number[] = new Array(toList.length);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      values[i] = node.creature.getActivation(c.from) * c.weight;
    }

    const value = Math.hypot(...values);
    return value;
  }

  activateAndTrace(node: Node) {
    return this.activate(node);
  }

  fix(node: Node) {
    const toList = node.creature.toConnections(node.index);

    if (toList.length < 2) {
      node.creature.makeRandomConnection(node.index);
    }
  }
}
