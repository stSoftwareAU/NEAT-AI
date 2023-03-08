import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class HYPOT implements NodeActivationInterface {
  public static NAME = "HYPOT";

  getName() {
    return HYPOT.NAME;
  }

  noTraceActivate(node: Node) {
    const toList = node.network.toConnections(node.index);
    const values: number[] = new Array(toList.length);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      values[i] = node.network.getActivation(c.from) * c.weight;
    }

    const value = Math.hypot(...values);
    return value;
  }

  activate(node: Node) {
    return this.noTraceActivate(node);
  }

  fix(node: Node) {
    const toList = node.network.toConnections(node.index);

    if (toList.length < 2) {
      node.network.makeRandomConnection(node.index);
    }
  }
}
