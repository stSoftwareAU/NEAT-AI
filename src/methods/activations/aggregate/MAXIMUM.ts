import {
  accumulateWeight,
  adjustedBias,
  adjustedWeight,
  type BackPropagationConfig,
  toValue,
} from "../../../architecture/BackPropagation.ts";
import type { SynapseInternal } from "../../../architecture/SynapseInterfaces.ts";
import type { Neuron } from "../../../architecture/Neuron.ts";
import type { ApplyLearningsInterface } from "../ApplyLearningsInterface.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";
import { IDENTITY } from "../types/IDENTITY.ts";
import { assert } from "@std/assert/assert";

export class MAXIMUM
  implements NeuronActivationInterface, ApplyLearningsInterface {
  public static NAME = "MAXIMUM";

  getName() {
    return MAXIMUM.NAME;
  }

  range() {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }

  activate(node: Neuron) {
    const toList = node.creature.inwardConnections(node.index);
    let maxValue = Number.NEGATIVE_INFINITY;
    const activations = node.creature.state.activations;
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const value = activations[c.from] * c.weight;
      if (value > maxValue) {
        maxValue = value;
      }
    }

    return maxValue;
  }

  activateAndTrace(node: Neuron) {
    const toList = node.creature.inwardConnections(node.index);
    let maxValue = Infinity * -1;
    let usedConnection: SynapseInternal | null = null;
    const activations = node.creature.state.activations;
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const cs = node.creature.state.connection(c.from, c.to);
      if (cs.used == undefined) cs.used = false;

      const value = activations[c.from] * c.weight;
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
    const toListA = node.creature.inwardConnections(node.index);
    for (let i = toListA.length; i--;) {
      const c = toListA[i];
      if (c.from == c.to) {
        node.creature.disconnect(c.from, c.to);
      }
    }

    for (let attempts = 12; attempts--;) {
      const toList = node.creature.inwardConnections(node.index);

      if (toList.length < 2) {
        node.creature.makeRandomConnection(node.index);
      } else {
        break;
      }
    }
  }

  applyLearnings(neuron: Neuron): boolean {
    let changed = false;
    let usedCount = 0;
    const toList = neuron.creature.inwardConnections(neuron.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      assert(c.to == neuron.index, "mismatched index");

      const cs = neuron.creature.state.connection(c.from, c.to);
      if (!cs.used) {
        console.info(`${this.getName()} disconnecting`, c.from, c.to, cs);
        neuron.creature.disconnect(c.from, c.to);
        changed = true;
        // cs.used = false;
      } else {
        usedCount++;
      }
    }

    if (usedCount < 2) {
      if (usedCount < 1) {
        throw new Error("no learnings");
      }
      neuron.setSquash(IDENTITY.NAME);

      changed = true;
    }

    return changed;
  }

  propagate(
    neuron: Neuron,
    targetActivation: number,
    config: BackPropagationConfig,
  ): number {
    const toList = neuron.creature.inwardConnections(neuron.index);

    const activation = neuron.adjustedActivation(config);

    const targetValue = toValue(neuron, targetActivation);

    const activationValue = toValue(neuron, activation);

    const error = targetValue - activationValue;
    let remainingError = error;
    const currentBias = adjustedBias(neuron, config);
    let improvedValue = 0;
    if (toList.length) {
      let maxValue = -Infinity;

      let mainConnection;
      let mainActivation;
      for (let indx = toList.length; indx--;) {
        const c = toList[indx];

        const fromNeuron = neuron.creature.neurons[c.from];

        const fromActivation = fromNeuron.adjustedActivation(config);

        const fromWeight = adjustedWeight(neuron.creature.state, c, config);
        const fromValue = fromWeight * fromActivation;
        if (fromValue > maxValue) {
          maxValue = fromValue;
          mainConnection = c;
          mainActivation = fromActivation;
        }
      }

      if (mainConnection) {
        assert(mainActivation != null);
        const fromNeuron = neuron.creature.neurons[mainConnection.from];

        const fromWeight = adjustedWeight(
          neuron.creature.state,
          mainConnection,
          config,
        );
        const fromValue = fromWeight * mainActivation;

        let improvedFromActivation = mainActivation;
        let targetFromActivation = mainActivation;
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
          Math.abs(improvedFromActivation) > config.plankConstant &&
          Math.abs(fromWeight) > config.plankConstant
        ) {
          const targetFromValue2 = fromValue + remainingError;

          const cs = neuron.creature.state.connection(
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
            neuron.creature.state,
            mainConnection,
            config,
          );

          const improvedAdjustedFromValue = improvedFromActivation *
            aWeight;

          improvedValue = improvedAdjustedFromValue + currentBias;
        }
      }
    }

    const ns = neuron.creature.state.node(neuron.index);

    ns.accumulateBias(
      targetValue,
      improvedValue,
      currentBias,
    );

    const aBias = adjustedBias(neuron, config);

    const adjustedActivation = improvedValue + aBias - currentBias;

    return adjustedActivation;
  }
}
