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

export class MINIMUM
  implements NeuronActivationInterface, ApplyLearningsInterface {
  public static NAME = "MINIMUM";

  getName() {
    return MINIMUM.NAME;
  }

  range() {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }

  activate(node: Neuron): number {
    const toList = node.creature.inwardConnections(node.index);
    let minValue = Infinity;
    const activations = node.creature.state.activations;
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const value = activations[c.from] * c.weight;
      if (value < minValue) {
        minValue = value;
      }
    }

    return minValue;
  }

  activateAndTrace(neuron: Neuron) {
    const toList = neuron.creature.inwardConnections(neuron.index);
    let minValue = Infinity;
    let usedConnection: SynapseInternal | null = null;
    const activations = neuron.creature.state.activations;
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const cs = neuron.creature.state.connection(c.from, c.to);
      if (cs.used == undefined) cs.used = false;

      const value = activations[c.from] * c.weight;
      if (value < minValue) {
        minValue = value;
        usedConnection = c;
      }
    }

    if (usedConnection != null) {
      const cs = neuron.creature.state.connection(
        usedConnection.from,
        usedConnection.to,
      );
      cs.used = true;
    }

    return minValue;
  }

  fix(neuron: Neuron) {
    const fromListA = neuron.creature.inwardConnections(neuron.index);
    for (let i = fromListA.length; i--;) {
      const c = fromListA[i];
      if (c.from == c.to) {
        neuron.creature.disconnect(c.from, c.to);
      }
    }

    const fromListB = neuron.creature.inwardConnections(neuron.index);

    switch (fromListB.length) {
      case 1:
        neuron.setSquash(IDENTITY.NAME);
        break;
      case 0:
        neuron.creature.makeRandomConnection(neuron.index);
        break;
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
        neuron.creature.disconnect(c.from, c.to);
        changed = true;
      } else {
        usedCount++;
      }
    }

    if (usedCount < 2) {
      assert(usedCount > 0, "no learnings");

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
    const activation = neuron.adjustedActivation(config);

    if (Math.abs(targetActivation - activation) < config.plankConstant) {
      return targetActivation;
    }

    const toList = neuron.creature.inwardConnections(neuron.index);
    const targetValue = toValue(neuron, targetActivation);

    const activationValue = toValue(neuron, activation);

    const error = targetValue - activationValue;
    let remainingError = error;
    const currentBias = adjustedBias(neuron, config);
    let improvedValue = 0;
    if (toList.length) {
      let minValue = Infinity;

      let mainConnection;
      let mainActivation;
      for (let indx = toList.length; indx--;) {
        const c = toList[indx];

        const fromNeuron = neuron.creature.neurons[c.from];

        const fromActivation = fromNeuron.adjustedActivation(config);

        const fromWeight = adjustedWeight(neuron.creature.state, c, config);
        const fromValue = fromWeight * fromActivation;
        if (fromValue < minValue) {
          minValue = fromValue;
          mainConnection = c;
          mainActivation = fromActivation;
        }
      }

      if (mainConnection) {
        assert(mainActivation != undefined);
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
