import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";

export class MEAN implements NodeActivationInterface {
  public static NAME = "MEAN";

  getName() {
    return MEAN.NAME;
  }

  activate(node: Node) {
    let sum = 0;
    // Activation sources coming from connections
    for (let i = 0; i < node.connections.in.length; i++) {
      const connection = node.connections.in[i];
      const v = connection.from.getActivation() * connection.weight *
        connection.gain;

      sum += v;
    }

    const value = sum / node.connections.in.length;
    return value;
  }
}
