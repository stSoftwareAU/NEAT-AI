import { NodeActivationInterface } from "../NodeActivationInterface.ts";
import { Node } from "../../../architecture/Node.ts";
import { ApplyLearningsInterface } from "../ApplyLearningsInterface.ts";
import { IDENTITY } from "../types/IDENTITY.ts";
import { Mutation } from "../../mutation.ts";
import {
  adjustedBias,
  adjustedWeight,
  adjustWeight,
  BackPropagationConfig,
  limitActivation,
  limitValue,
  limitWeight,
  toValue,
} from "../../../architecture/BackPropagation.ts";
import { PropagateInterface } from "../PropagateInterface.ts";

export class IF
  implements
    NodeActivationInterface,
    ApplyLearningsInterface,
    PropagateInterface {
  public static NAME = "IF";

  getName() {
    return IF.NAME;
  }

  range(): { low: number; high: number } {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }

  fix(node: Node) {
    const toList = node.network.toConnections(node.index);
    const spareList = [];
    let foundPositive = false;
    let foundCondition = false;
    let foundNegative = false;

    for (let i = toList.length; i--;) {
      const c = toList[i];
      if (c.type == "condition") {
        if (foundCondition) {
          spareList.push(c);
        } else {
          foundCondition = true;
        }
      } else if (c.type == "negative") {
        if (foundNegative) {
          spareList.push(c);
        } else {
          foundNegative = true;
        }
      } else if (c.type == "positive") {
        if (foundPositive) {
          spareList.push(c);
        } else {
          foundPositive = true;
        }
      }
    }

    for (let i = toList.length; i--;) {
      const c = toList[i];
      if (c.type === undefined) {
        if (!foundCondition) {
          foundCondition = true;
          c.type = "condition";
        } else if (!foundNegative) {
          foundNegative = true;
          c.type = "negative";
        } else if (!foundPositive) {
          foundPositive = true;
          c.type = "positive";
        } else {
          switch (Math.floor(Math.random() * 3)) {
            case 0:
              c.type = "condition";
              break;
            case 1:
              c.type = "negative";
              break;
            default:
              c.type = "positive";
          }
        }
      }
    }

    if (!foundCondition) {
      const c = node.network.makeRandomConnection(node.index);
      if (c) {
        c.type = "condition";
        foundCondition = true;
      }
    }

    if (!foundNegative) {
      const c = node.network.makeRandomConnection(node.index);

      if (c) {
        c.type = "negative";
        foundNegative = true;
      }
    }

    if (!foundPositive) {
      const c = node.network.makeRandomConnection(node.index);

      if (c) {
        c.type = "positive";
        foundPositive = true;
      }
    }

    if (!foundCondition) {
      const c = spareList.pop();
      if (c) {
        foundCondition = true;
        c.type = "condition";
      }
    }

    if (!foundNegative) {
      const c = spareList.pop();
      if (c) {
        foundNegative = true;
        c.type = "negative";
      }
    }
    if (!foundPositive) {
      const c = spareList.pop();
      if (c) {
        foundPositive = true;
        c.type = "positive";
      }
    }

    const toList2 = node.network.toConnections(node.index);

    if (toList2.length < 3 && node.index > 2) {
      throw new Error(
        "Should have 3 or more connections was: " + toList2.length,
      );
    }

    if (!foundCondition || !foundNegative || !foundPositive) {
      // console.info("missing connections", toList2);
      node.mutate(Mutation.MOD_ACTIVATION.name);
    }
  }

  activate(node: Node) {
    let condition = 0;
    let negative = 0;
    let positive = 0;

    const toList = node.network.toConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = node.network.getActivation(c.from) *
        c.weight;

      switch (c.type) {
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

    if (condition > 0) {
      for (let i = toList.length; i--;) {
        const c = toList[i];
        const cs = node.network.networkState.connection(c.from, c.to);
        switch (c.type) {
          case "condition":
          case "negative":
            if (cs.used == undefined) cs.used = false;
            break;
          default:
            cs.used = true;
        }
      }
      return positive;
    } else {
      for (let i = toList.length; i--;) {
        const c = toList[i];

        if (c.type == "negative") {
          node.network.networkState.connection(c.from, c.to).used = true;
        }
      }
      return negative;
    }
  }

  noTraceActivate(node: Node): number {
    let condition = 0;
    let negative = 0;
    let positive = 0;

    const toList = node.network.toConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = limitActivation(node.network.getActivation(c.from)) *
        limitWeight(c.weight);

      switch (c.type) {
        case "condition":
          condition = limitValue(condition + value);
          break;
        case "negative":
          negative = limitValue(negative + value);
          break;
        default:
          positive = limitValue(positive + value);
      }
    }

    return condition > 0 ? positive : negative;
  }

  applyLearnings(node: Node): boolean {
    const toList = node.network.toConnections(node.index);

    let foundPositive = false;

    let foundNegative = false;

    for (let i = toList.length; i--;) {
      const c = toList[i];
      const cs = node.network.networkState.connection(c.from, c.to);
      switch (c.type) {
        case "condition":
          break;
        case "negative":
          if (cs.used) {
            foundNegative = true;
          }
          break;
        default:
          if (cs.used) {
            foundPositive = true;
          }
      }
    }

    if (foundNegative && foundPositive) {
      return false;
    }

    for (let i = toList.length; i--;) {
      const c = toList[i];

      switch (c.type) {
        case "condition":
          node.network.disconnect(c.from, c.to);
          break;
        case "negative":
          if (foundPositive) {
            node.network.disconnect(c.from, c.to);
          }
          break;
        default:
          if (foundNegative) {
            node.network.disconnect(c.from, c.to);
          }
      }
    }

    node.setSquash(IDENTITY.NAME);

    return true;
  }

  propagate(
    node: Node,
    targetActivation: number,
    config: BackPropagationConfig,
  ): number {
    const toList = node.network.toConnections(node.index);
    let condition = 0;
    let negativeCount = 0;
    let positiveCount = 0;

    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = limitActivation(node.network.getActivation(c.from)) *
        limitWeight(c.weight);

      switch (c.type) {
        case "condition":
          condition = limitValue(condition + value);
          break;
        case "negative":
          negativeCount++;
          break;
        default:
          positiveCount++;
      }
    }

    const activation = node.adjustedActivation(config);

    // const ns = node.network.networkState.node(node.index);

    const targetValue = toValue(node, targetActivation);

    const activationValue = toValue(node, activation);
    const error = targetValue - activationValue;

    let targetWeightedSum = 0;

    const listLength = toList.length;
    const indices = Array.from({ length: listLength }, (_, i) => i); // Create an array of indices

    if (listLength > 1 && !(config.disableRandomSamples)) {
      // Fisher-Yates shuffle algorithm
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
    }

    const errorPerLink = error /
      (condition > 0 ? positiveCount : negativeCount);
    let testWeight = 0;
    // Iterate over the shuffled indices
    for (let i = listLength; i--;) {
      const indx = indices[i];
      let thisPerLinkError = errorPerLink;

      const c = toList[indx];

      if (c.from === c.to) continue;
      if (c.type == "condition") continue;
      if (c.type == "positive" && condition <= 0) continue;
      if (c.type == "negative" && condition > 0) continue;

      const fromNode = node.network.nodes[c.from];
      const fromActivation = fromNode.adjustedActivation(config);

      const cs = node.network.networkState.connection(c.from, c.to);

      const fromWeight = adjustedWeight(node.network.networkState, c, config);
      const fromValue = fromWeight * fromActivation;

      let improvedFromActivation = fromActivation;
      let targetFromActivation = fromActivation;
      const targetFromValue = fromValue + errorPerLink;
      let improvedFromValue = fromValue;
      // if (
      //   fromWeight &&
      //   fromNode.type !== "input" &&
      //   fromNode.type !== "constant"
      // ) {
      //   targetFromActivation = targetFromValue / fromWeight;

      //   improvedFromActivation = (fromNode as Node).propagate(
      //     targetFromActivation,
      //     config,
      //   );
      //   improvedFromValue = improvedFromActivation * fromWeight;

      //   thisPerLinkError = targetFromValue - improvedFromValue;
      // }

      // if (
      //   Math.abs(improvedFromActivation) > PLANK_CONSTANT &&
      //   Math.abs(fromWeight) > PLANK_CONSTANT
      // ) {
      const targetFromValue2 = fromValue + thisPerLinkError;
      adjustWeight(cs, targetFromValue2, targetFromActivation);

      const aWeight = adjustedWeight(node.network.networkState, c, config);
      testWeight = aWeight;
      // console.info( `c.from: ${c.from}, c.to: ${c.to}, aWeight: ${aWeight.toFixed(3)}, fromWeight: ${fromWeight.toFixed(3)}, fromActivation: ${fromActivation.toFixed(3)}, improvedFromActivation: ${improvedFromActivation.toFixed(3)}, targetFromActivation: ${targetFromActivation.toFixed(3)}, targetFromValue: ${targetFromValue.toFixed(3)}, targetFromValue2: ${targetFromValue2.toFixed(3)}, thisPerLinkError: ${thisPerLinkError.toFixed(3)}`);
      const improvedAdjustedFromValue = improvedFromActivation *
        aWeight;

      targetWeightedSum += improvedAdjustedFromValue;
      // }
    }

    // ns.count++;
    // ns.totalValue += targetValue;
    // ns.totalWeightedSum += targetWeightedSum;

    const aBias = adjustedBias(node, config);

    const adjustedActivation = targetWeightedSum + aBias;
    if (node.uuid == "output-1") { //&& Math.abs(targetActivation-adjustedActivation) > Math.abs(targetActivation-activation) ) {
      console.info(
        `${node.uuid}: targetActivation: ${
          targetActivation.toFixed(3)
        }, activation: ${activation.toFixed(3)}, adjustedActivation: ${
          adjustedActivation.toFixed(3)
        }, aBias: ${aBias.toFixed(3)}, testWeight: ${testWeight.toFixed(3)}`,
      );
    }
    return limitActivation(adjustedActivation);
  }
}
