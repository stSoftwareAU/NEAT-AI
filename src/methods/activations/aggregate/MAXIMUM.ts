import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class MAXIMUM implements NodeActivationInterface {
  public static NAME = "MAXIMUM";

  getName() {
    return MAXIMUM.NAME;
  }

  activate(node: Node) {
    const values: number[] = [];

    // Activation sources coming from connections
    for (let i = 0; i < node.connections.in.length; i++) {
      const connection = node.connections.in[i];
      values.push(
        connection.from.getActivation() * connection.weight *
          connection.gain,
      );
    }

    const value = Math.max(...values);
    return value;
  }
}
