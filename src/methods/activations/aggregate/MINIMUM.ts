import {
  accumulateWeight,
  adjustedBias,
  adjustedWeight,
  BackPropagationConfig,
  PLANK_CONSTANT,
  toValue,
} from "../../../architecture/BackPropagation.ts";
import { ConnectionInternal } from "../../../architecture/ConnectionInterfaces.ts";
import { Node } from "../../../architecture/Node.ts";
import { ApplyLearningsInterface } from "../ApplyLearningsInterface.ts";
import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { PropagateInterface } from "../PropagateInterface.ts";
import { IDENTITY } from "../types/IDENTITY.ts";

export class MINIMUM
  implements
    NodeActivationInterface,
    ApplyLearningsInterface,
    PropagateInterface {
  public static NAME = "MINIMUM";

  getName() {
    return MINIMUM.NAME;
  }

  range(): { low: number; high: number } {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }

  activate(node: Node): number {
    const toList = node.creature.toConnections(node.index);
    let minValue = Infinity;
    for (let i = toList.length; i--;) {
      const c = toList[i];
      if (c.from == c.to) continue;
      const value = node.creature.getActivation(c.from) *
        c.weight;
      if (value < minValue) {
        minValue = value;
      }
    }

    return minValue;
  }

  activateAndTrace(node: Node) {
    const toList = node.creature.toConnections(node.index);
    let minValue = Infinity;
    let usedConnection: ConnectionInternal | null = null;
    for (let i = toList.length; i--;) {
      const c = toList[i];
      if (c.from == c.to) continue;
      const cs = node.creature.state.connection(c.from, c.to);
      if (cs.used == undefined) cs.used = false;

      const value = node.creature.getActivation(c.from) *
        c.weight;
      if (value < minValue) {
        minValue = value;
        usedConnection = c;
      }
    }

    if (usedConnection != null) {
      const cs = node.creature.state.connection(
        usedConnection.from,
        usedConnection.to,
      );
      cs.used = true;
    }

    return minValue;
  }

  fix(node: Node) {
    const toListA = node.creature.toConnections(node.index);
    for (let i = toListA.length; i--;) {
      const c = toListA[i];
      if (c.from == c.to) {
        node.creature.disconnect(c.from, c.to);
      }
    }

    for (let attempts = 12; attempts--;) {
      const toList = node.creature.toConnections(node.index);

      if (toList.length < 2) {
        node.creature.makeRandomConnection(node.index);
      } else {
        break;
      }
    }
  }

  applyLearnings(node: Node): boolean {
    let changed = false;
    let usedCount = 0;
    const toList = node.creature.toConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      if (node.index != c.to) throw new Error("mismatched index " + c);
      const cs = node.creature.state.connection(c.from, c.to);
      if (!cs.used) {
        node.creature.disconnect(c.from, c.to);
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
    const toList = node.creature.toConnections(node.index);

    const activation = node.adjustedActivation(config);

    const targetValue = toValue(node, targetActivation);

    const activationValue = toValue(node, activation);

    const error = targetValue - activationValue;
    let remainingError = error;

    let targetWeightedSum = 0;
    if (toList.length) {
      let minValue = Infinity;

      let mainConnection;
      for (let indx = toList.length; indx--;) {
        const c = toList[indx];

        if (c.from === c.to) continue;

        const fromNode = node.creature.nodes[c.from];

        const fromActivation = fromNode.adjustedActivation(config);

        const fromWeight = adjustedWeight(node.creature.state, c, config);
        const fromValue = fromWeight * fromActivation;
        if (fromValue < minValue) {
          minValue = fromValue;
          mainConnection = c;
        }
      }

      if (mainConnection) {
        const fromNode = node.creature.nodes[mainConnection.from];
        const fromActivation = fromNode.adjustedActivation(config);

        const fromWeight = adjustedWeight(
          node.creature.state,
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

          const improvedFromValue = improvedFromActivation * fromWeight;

          remainingError = targetFromValue - improvedFromValue;
        }

        if (
          Math.abs(improvedFromActivation) > PLANK_CONSTANT &&
          Math.abs(fromWeight) > PLANK_CONSTANT
        ) {
          const targetFromValue2 = fromValue + remainingError;

          const cs = node.creature.state.connection(
            mainConnection.from,
            mainConnection.to,
          );
          accumulateWeight(cs, targetFromValue2, targetFromActivation, config);

          const aWeight = adjustedWeight(
            node.creature.state,
            mainConnection,
            config,
          );

          const improvedAdjustedFromValue = improvedFromActivation *
            aWeight;

          targetWeightedSum += improvedAdjustedFromValue;
        }
      }
    }

    const ns = node.creature.state.node(node.index);
    ns.count++;
    ns.totalValue += targetValue;
    ns.totalWeightedSum += targetWeightedSum;

    const aBias = adjustedBias(node, config);

    const adjustedActivation = targetWeightedSum + aBias;

    return adjustedActivation;
  }
}
