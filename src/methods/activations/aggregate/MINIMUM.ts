import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";
import { ApplyLearningsInterface } from "../ApplyLearningsInterface.ts";
import { ConnectionInterface } from "../../../architecture/ConnectionInterface.ts";
import { IDENTITY } from "../types/IDENTITY.ts";

export class MINIMUM
  implements NodeActivationInterface, ApplyLearningsInterface {
  public static NAME = "MINIMUM";

  getName() {
    return MINIMUM.NAME;
  }

  noTraceActivate(node: Node): number {
    const toList = node.util.toConnections(node.index);
    let minValue = Infinity;
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = node.util.networkState.node(c.from).activation * c.weight;
      if (value < minValue) {
        minValue = value;
      }
    }

    return minValue;
  }

  activate(node: Node) {
    const toList = node.util.toConnections(node.index);
    let minValue = Infinity;
    let usedConnection: ConnectionInterface | null = null;
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = node.util.networkState.node(c.from).activation * c.weight;
      if (value < minValue) {
        minValue = value;
        usedConnection = c;
      }
    }

    if (usedConnection != null) {
      const cs = node.util.networkState.connection(
        usedConnection.from,
        usedConnection.to,
      );
      cs.xTrace.used = true;
    }

    return minValue;
  }

  fix(node: Node) {
    const toList = node.util.toConnections(node.index);

    if (toList.length < 2) {
      node.util.makeRandomConnection(node.index);
    }
  }

  applyLearnings(node: Node): boolean {
    let changed = false;
    let usedCount = 0;
    const toList = node.util.toConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      if (node.index != c.to) throw "mismatched index " + c;
      const cs = node.util.networkState.connection(c.from, c.to);
      if (!cs.xTrace.used) {
        node.util.disconnect(c.from, c.to);
        changed = true;
        cs.xTrace.used = false;
      } else {
        usedCount++;
      }
    }

    if (usedCount < 2) {
      if (usedCount < 1) {
        throw "no learnings";
      }
      node.setSquash(IDENTITY.NAME);

      changed = true;
    }

    return changed;
  }
}
