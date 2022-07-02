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

    // Activation sources coming from connections
    for (let i = 0; i < node.connections.in.length; i++) {
      const connection = node.connections.in[i];
      const value = connection.from.getActivation() * connection.weight *
        connection.gain;
      switch (connection.type) {
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
