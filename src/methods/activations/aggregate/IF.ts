import {
  accumulateWeight,
  adjustedBias,
  adjustedWeight,
  type BackPropagationConfig,
  limitActivation,
  limitValue,
  toValue,
} from "../../../architecture/BackPropagation.ts";
import { CreatureUtil } from "../../../architecture/CreatureUtils.ts";
import type { Neuron } from "../../../architecture/Neuron.ts";
import { Mutation } from "../../../NEAT/Mutation.ts";
import type { ApplyLearningsInterface } from "../ApplyLearningsInterface.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";
import { IDENTITY } from "../types/IDENTITY.ts";

export class IF implements NeuronActivationInterface, ApplyLearningsInterface {
  public static NAME = "IF";

  getName() {
    return IF.NAME;
  }

  range() {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }

  fix(node: Neuron) {
    const toListA = node.creature.inwardConnections(node.index);
    for (let i = toListA.length; i--;) {
      const c = toListA[i];
      if (c.from == c.to) {
        node.creature.disconnect(c.from, c.to);
      }
    }

    const toList = node.creature.inwardConnections(node.index);
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
      const c = node.creature.makeRandomConnection(node.index);
      if (c) {
        c.type = "condition";
        foundCondition = true;
      }
    }

    if (!foundNegative) {
      const c = node.creature.makeRandomConnection(node.index);

      if (c) {
        c.type = "negative";
        foundNegative = true;
      }
    }

    if (!foundPositive) {
      const c = node.creature.makeRandomConnection(node.index);

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

    const toList2 = node.creature.inwardConnections(node.index);

    if (toList2.length < 3 && node.index > 2) {
      throw new Error(
        "Should have 3 or more connections was: " + toList2.length,
      );
    }

    if (!foundCondition || !foundNegative || !foundPositive) {
      node.mutate(Mutation.MOD_ACTIVATION.name);
    }
  }

  activateAndTrace(node: Neuron) {
    let condition = 0;
    let negative = 0;
    let positive = 0;

    const activations = node.creature.state.activations;
    const toList = node.creature.inwardConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = activations[c.from] * c.weight;

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
        const cs = node.creature.state.connection(c.from, c.to);
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
          node.creature.state.connection(c.from, c.to).used = true;
        }
      }
      return negative;
    }
  }

  activate(node: Neuron): number {
    let condition = 0;
    let negative = 0;
    let positive = 0;

    const activations = node.creature.state.activations;
    const toList = node.creature.inwardConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = limitActivation(activations[c.from]) * c.weight;

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

  applyLearnings(node: Neuron): boolean {
    if (true) return false;
    const toList = node.creature.inwardConnections(node.index);

    let foundPositive = false;

    let foundNegative = false;

    for (let i = toList.length; i--;) {
      const c = toList[i];
      const cs = node.creature.state.connection(c.from, c.to);
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
          node.creature.disconnect(c.from, c.to);
          break;
        case "negative":
          if (foundPositive) {
            node.creature.disconnect(c.from, c.to);
          }
          break;
        default:
          if (foundNegative) {
            node.creature.disconnect(c.from, c.to);
          }
      }
    }

    node.setSquash(IDENTITY.NAME);

    return true;
  }

  propagate(
    node: Neuron,
    targetActivation: number,
    config: BackPropagationConfig,
  ): number {
    const toList = node.creature.inwardConnections(node.index);
    let condition = 0;
    let negativeCount = 0;
    let positiveCount = 0;
    const activations = node.creature.state.activations;
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = limitActivation(activations[c.from]) * c.weight;

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

    const ns = node.creature.state.node(node.index);
    const currentBias = adjustedBias(node, config);
    const targetValue = toValue(node, targetActivation - currentBias);

    const activationValue = toValue(node, activation - currentBias);
    const error = targetValue - activationValue;

    let improvedValue = currentBias;

    const listLength = toList.length;
    const indices = Int32Array.from({ length: listLength }, (_, i) => i); // Create an array of indices

    if (!config.disableRandomSamples) {
      CreatureUtil.shuffle(indices);
    }

    const errorPerLink = error /
      (condition > 0 ? positiveCount : negativeCount);
    // Iterate over the shuffled indices
    for (let i = listLength; i--;) {
      const indx = indices[i];
      let thisPerLinkError = errorPerLink;

      const c = toList[indx];

      if (c.from === c.to) continue;
      if (c.type == "condition") continue;
      if (c.type == "positive" && condition <= 0) continue;
      if (c.type == "negative" && condition > 0) continue;

      const fromNeuron = node.creature.neurons[c.from];
      const fromActivation = fromNeuron.adjustedActivation(config);

      const cs = node.creature.state.connection(c.from, c.to);

      const fromWeight = adjustedWeight(node.creature.state, c, config);
      const fromValue = fromWeight * fromActivation;

      let improvedFromActivation = fromActivation;
      let targetFromActivation = fromActivation;
      const targetFromValue = fromValue + errorPerLink;
      let improvedFromValue = fromValue;
      if (
        fromWeight &&
        fromNeuron.type !== "input" &&
        fromNeuron.type !== "constant"
      ) {
        targetFromActivation = targetFromValue / fromWeight;

        improvedFromActivation = fromNeuron.propagate(
          targetFromActivation,
          config,
        );
        improvedFromValue = improvedFromActivation * fromWeight;

        thisPerLinkError = targetFromValue - improvedFromValue;
      }

      const targetFromValue2 = fromValue + thisPerLinkError;
      accumulateWeight(
        c.weight,
        cs,
        targetFromValue2,
        targetFromActivation,
        config,
      );

      const aWeight = adjustedWeight(node.creature.state, c, config);
      const improvedAdjustedFromValue = improvedFromActivation *
        aWeight;

      improvedValue += improvedAdjustedFromValue;
    }

    ns.accumulateBias(
      targetValue,
      improvedValue,
      currentBias,
    );

    const aBias = adjustedBias(node, config);

    const adjustedActivation = improvedValue + aBias - currentBias;

    return limitActivation(adjustedActivation);
  }
}
