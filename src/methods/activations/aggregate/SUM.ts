import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class SUM implements NodeActivationInterface {
  public static NAME = "SUM";

  getName() {
    return SUM.NAME;
  }

  noTraceActivate(node: Node) {
    const toList = node.util.toConnections(node.index);
    let sum = 0;
    for (let i = toList.length; i--;) {
      const c = toList[i];

      sum += node.util.networkState.node(c.from).activation * c.weight;
    }

    return sum;
  }

  activate(node: Node) {
    return this.noTraceActivate(node);
  }

  fix(node: Node) {
    const toList = node.util.toConnections(node.index);

    if (toList.length < 2) {
      node.util.makeRandomConnection(node.index);
    }
  }
}
