import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";
import { ApplyLearningsInterface } from "../ApplyLearningsInterface.ts";
import { IDENTITY } from "../types/IDENTITY.ts";
import { ConnectionInternal } from "../../../architecture/ConnectionInterfaces.ts";

export class MAXIMUM
  implements NodeActivationInterface, ApplyLearningsInterface {
  public static NAME = "MAXIMUM";

  getName() {
    return MAXIMUM.NAME;
  }

  noTraceActivate(node: Node) {
    const toList = node.network.toConnections(node.index);
    let maxValue = Infinity * -1;
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = node.network.getActivation(c.from) *
        c.weight;
      if (value > maxValue) {
        maxValue = value;
      }
    }

    return maxValue;
  }

  activate(node: Node) {
    const toList = node.network.toConnections(node.index);
    let maxValue = Infinity * -1;
    let usedConnection: ConnectionInternal | null = null;
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const cs = node.network.networkState.connection(c.from, c.to);
      if (cs.used == undefined) cs.used = false;

      const value = node.network.getActivation(c.from) *
        c.weight;
      if (value > maxValue) {
        maxValue = value;
        usedConnection = c;
      }
    }

    if (usedConnection != null) {
      const cs = node.network.networkState.connection(
        usedConnection.from,
        usedConnection.to,
      );
      cs.used = true;
    }

    return maxValue;
  }

  fix(node: Node) {
    const toList = node.network.toConnections(node.index);

    if (toList.length < 2) {
      node.network.makeRandomConnection(node.index);
    }
  }

  applyLearnings(node: Node): boolean {
    let changed = false;
    let usedCount = 0;
    const toList = node.network.toConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      if (node.index != c.to) throw new Error("mismatched index " + c);
      const cs = node.network.networkState.connection(c.from, c.to);
      if (!cs.used) {
        node.network.disconnect(c.from, c.to);
        changed = true;
        cs.used = false;
      } else {
        usedCount++;
      }
    }

    if (usedCount < 2) {
      if (usedCount < 1) {
        throw new Error("no learnings");
      }
      node.setSquash(IDENTITY.NAME);

      changed = true;
    }

    return changed;
  }
}
