import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";
import { ApplyLearningsInterface } from "../ApplyLearningsInterface.ts";
import { ConnectionInternal } from "../../../architecture/ConnectionInterfaces.ts";
import { IDENTITY } from "../types/IDENTITY.ts";
import { PropagateInterface } from "../PropagateInterface.ts";
import {
  adjustedBias,
  adjustedWeight,
  BackPropagationConfig,
  toValue,
} from "../../../architecture/BackPropagation.ts";
import { PLANK_CONSTANT } from "../../../config/NeatConfig.ts";

export class MINIMUM
  implements
    NodeActivationInterface,
    ApplyLearningsInterface,
    PropagateInterface {
  public static NAME = "MINIMUM";

  getName() {
    return MINIMUM.NAME;
  }

  noTraceActivate(node: Node): number {
    const toList = node.network.toConnections(node.index);
    let minValue = Infinity;
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = node.network.getActivation(c.from) *
        c.weight;
      if (value < minValue) {
        minValue = value;
      }
    }

    return minValue;
  }

  activate(node: Node) {
    const toList = node.network.toConnections(node.index);
    let minValue = Infinity;
    let usedConnection: ConnectionInternal | null = null;
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const cs = node.network.networkState.connection(c.from, c.to);
      if (cs.used == undefined) cs.used = false;

      const value = node.network.getActivation(c.from) *
        c.weight;
      if (value < minValue) {
        minValue = value;
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

    return minValue;
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

  propagate(
    node: Node,
    targetActivation: number,
    config: BackPropagationConfig,
  ): number {
    const toList = node.network.toConnections(node.index);

    const activation = node.adjustedActivation(config);

    const targetValue = toValue(node, targetActivation);

    const activationValue = toValue(node, activation);

    const error = targetValue - activationValue;
    let targetWeightedSum = 0;
    if (toList.length) {
      let minValue = Infinity;

      let mainConnection;
      for (let indx = toList.length; indx--;) {
        const c = toList[indx];

        if (c.from === c.to) continue;

        const fromNode = node.network.nodes[c.from];

        const fromActivation = fromNode.adjustedActivation(config);

        const fromWeight = adjustedWeight(node.network.networkState, c, config);
        const fromValue = fromWeight * fromActivation;
        if (fromValue < minValue) {
          minValue = fromValue;
          mainConnection = c;
        }
      }

      if (mainConnection) {
        const fromNode = node.network.nodes[mainConnection.from];
        const fromActivation = fromNode.adjustedActivation(config);

        const cs = node.network.networkState.connection(
          fromNode.index,
          node.index,
        );

        const fromWeight = adjustedWeight(
          node.network.networkState,
          mainConnection,
          config,
        );
        const fromValue = fromWeight * fromActivation;

        let improvedFromActivation = fromActivation;
        let targetFromActivation = fromActivation;
        const targetFromValue = fromValue + error;
        if (
          fromWeight &&
          fromNode.type !== "input" &&
          fromNode.type !== "constant"
        ) {
          targetFromActivation = targetFromValue / fromWeight;

          improvedFromActivation = (fromNode as Node).propagate(
            targetFromActivation,
            config,
          );
        }

        if (
          Math.abs(improvedFromActivation) > PLANK_CONSTANT &&
          Math.abs(fromWeight) > PLANK_CONSTANT
        ) {
          const targetFromValue2 = fromValue + error;

          cs.totalValue += targetFromValue2;
          cs.totalActivation += targetFromActivation;
          cs.absoluteActivation += Math.abs(improvedFromActivation);

          const aWeight = adjustedWeight(
            node.network.networkState,
            mainConnection,
            config,
          );

          const improvedAdjustedFromValue = improvedFromActivation *
            aWeight;

          targetWeightedSum += improvedAdjustedFromValue;
        }
      }
    }

    const ns = node.network.networkState.node(node.index);
    ns.count++;
    ns.totalValue += targetValue;
    ns.totalWeightedSum += targetWeightedSum;

    const aBias = adjustedBias(node, config);

    const adjustedActivation = targetWeightedSum + aBias;

    return adjustedActivation;
  }
}
