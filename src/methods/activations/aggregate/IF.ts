import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class IF implements NodeActivationInterface {
  public static NAME = "IF";

  getName() {
    return IF.NAME;
  }

  activate(node: Node) {
    const conditions: number[] = [];

    // Activation sources coming from connections
    for (let i = 0; i < node.connections.in.length; i++) {
      const connection = node.connections.in[i];
      values.push(
        connection.from.getActivation() * connection.weight *
          connection.gain,
      );
    }

    // { from: 2, to: 3, type:"positive"},
    // { from: 1, to: 3, type:"condition" },
    // { from: 0, to: 3, type:"negative" },

    // const value = Math.hypot(...values);
    return value;
  }
}
