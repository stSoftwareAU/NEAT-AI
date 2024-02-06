import {
  accumulateWeight,
  adjustedBias,
  adjustedWeight,
  BackPropagationConfig,
  PLANK_CONSTANT,
  toValue,
} from "../../../architecture/BackPropagation.ts";
import { SynapseInternal } from "../../../architecture/SynapseInterfaces.ts";
import { Neuron } from "../../../architecture/Neuron.ts";
import { ApplyLearningsInterface } from "../ApplyLearningsInterface.ts";
import { NeuronActivationInterface } from "../NeuronActivationInterface.ts";
import { IDENTITY } from "../types/IDENTITY.ts";

export class MAXIMUM
  implements NeuronActivationInterface, ApplyLearningsInterface {
  public static NAME = "MAXIMUM";

  getName() {
    return MAXIMUM.NAME;
  }

  range(): { low: number; high: number } {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }

  activate(node: Neuron) {
    const toList = node.creature.toConnections(node.index);
    let maxValue = Infinity * -1;
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const value = node.creature.getActivation(c.from) *
        c.weight;
      if (value > maxValue) {
        maxValue = value;
      }
    }

    return maxValue;
  }

  activateAndTrace(node: Neuron) {
    const toList = node.creature.toConnections(node.index);
    let maxValue = Infinity * -1;
    let usedConnection: SynapseInternal | null = null;
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const cs = node.creature.state.connection(c.from, c.to);
      if (cs.used == undefined) cs.used = false;

      const value = node.creature.getActivation(c.from) *
        c.weight;
      if (value > maxValue) {
        maxValue = value;
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

    return maxValue;
  }

  fix(node: Neuron) {
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

  applyLearnings(node: Neuron): boolean {
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
    node: Neuron,
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
      let maxValue = -Infinity;

      let mainConnection;
      for (let indx = toList.length; indx--;) {
        const c = toList[indx];

        const fromNeuron = node.creature.neurons[c.from];

        const fromActivation = fromNeuron.adjustedActivation(config);

        const fromWeight = adjustedWeight(node.creature.state, c, config);
        const fromValue = fromWeight * fromActivation;
        if (fromValue > maxValue) {
          maxValue = fromValue;
          mainConnection = c;
        }
      }

      if (mainConnection) {
        const fromNeuron = node.creature.neurons[mainConnection.from];
        const fromActivation = fromNeuron.adjustedActivation(config);

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
          fromNeuron.type !== "input" &&
          fromNeuron.type !== "constant"
        ) {
          targetFromActivation = targetFromValue / fromWeight;

          if (mainConnection.from != mainConnection.to) {
            improvedFromActivation = fromNeuron.propagate(
              targetFromActivation,
              config,
            );
          }

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
          accumulateWeight(
            mainConnection.weight,
            cs,
            targetFromValue2,
            targetFromActivation,
            config,
          );

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
    ns.accumulateBias(
      targetValue,
      targetWeightedSum,
      config,
      targetActivation,
      activation,
      adjustedBias(node, config),
    );

    const aBias = adjustedBias(node, config);

    const adjustedActivation = targetWeightedSum + aBias;

    return adjustedActivation;
  }
}
