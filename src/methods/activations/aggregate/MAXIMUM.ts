import { assert } from "@std/assert/assert";
import type { Neuron } from "../../../architecture/Neuron.ts";
import type { SynapseInternal } from "../../../architecture/SynapseInterfaces.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import {
  type BackPropagationConfig,
  toValue,
} from "../../../propagate/BackPropagation.ts";
import { accumulateBias, adjustedBias } from "../../../propagate/Bias.ts";
import { accumulateWeight, adjustedWeight } from "../../../propagate/Weight.ts";
import type { ApplyLearningsInterface } from "../ApplyLearningsInterface.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";
import { IDENTITY } from "../types/IDENTITY.ts";

export class MAXIMUM
  implements NeuronActivationInterface, ApplyLearningsInterface {
  public static NAME = "MAXIMUM";

  public readonly range: ActivationRange = new ActivationRange(
    this,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  getName() {
    return MAXIMUM.NAME;
  }

  activate(neuron: Neuron) {
    const fromList = neuron.creature.inwardConnections(neuron.index);
    let maxValue = Number.NEGATIVE_INFINITY;
    const activations = neuron.creature.state.activations;
    for (let i = fromList.length; i--;) {
      const c = fromList[i];
      const value = activations[c.from] * c.weight;
      if (value > maxValue) {
        maxValue = value;
      }
    }

    const value = maxValue + neuron.bias;

    return this.range.limit(value);
  }

  activateAndTrace(neuron: Neuron) {
    const fromList = neuron.creature.inwardConnections(neuron.index);
    let maxValue = Number.NEGATIVE_INFINITY;
    let usedConnection: SynapseInternal | null = null;
    const activations = neuron.creature.state.activations;
    for (let i = fromList.length; i--;) {
      const c = fromList[i];
      const cs = neuron.creature.state.connection(c.from, c.to);
      if (cs.used == undefined) cs.used = false;

      const value = activations[c.from] * c.weight;
      if (value > maxValue) {
        maxValue = value;
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

    const value = maxValue + neuron.bias;

    return this.range.limit(value);
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
    // let usedCount = 0;
    const inward = neuron.creature.inwardConnections(neuron.index);
    for (let i = inward.length; i--;) {
      const c = inward[i];
      assert(c.to == neuron.index, "mismatched index");

      const cs = neuron.creature.state.connection(c.from, c.to);
      if (!cs.used) {
        neuron.creature.disconnect(c.from, c.to);
        changed = true;
      }
      //  else {
      //   usedCount++;
      // }
    }

    // if (usedCount < 2) {
    //   assert(usedCount >= 0, "usedCount is negative");

    //   neuron.setSquash(IDENTITY.NAME);

    //   changed = true;
    // }

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
        } else {
          /** No Change Propagate */
          if (fromNeuron.type !== "input" && fromNeuron.type !== "constant") {
            if (c.from != c.to) {
              fromNeuron.propagate(fromActivation, config);
            }
          }

          const cs = neuron.creature.state.connection(c.from, c.to);
          accumulateWeight(
            c.weight,
            cs,
            fromValue,
            fromActivation,
            config,
          );
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

    accumulateBias(
      ns,
      targetValue,
      improvedValue,
      currentBias,
    );

    const aBias = adjustedBias(neuron, config);

    const adjustedActivation = improvedValue + aBias - currentBias;

    return adjustedActivation;
  }
}
