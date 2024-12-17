import type { Neuron } from "../../../architecture/Neuron.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import {
  type BackPropagationConfig,
  limitValue,
  toValue,
} from "../../../propagate/BackPropagation.ts";
import { accumulateBias, adjustedBias } from "../../../propagate/Bias.ts";
import type { SparseConfig } from "../../../propagate/sparse/SparseConfig.ts";
import { accumulateWeight, adjustedWeight } from "../../../propagate/Weight.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";

export class MEAN implements NeuronActivationInterface {
  public static NAME = "MEAN";
  public readonly range: ActivationRange = new ActivationRange(
    MEAN.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  getName() {
    return MEAN.NAME;
  }

  activate(neuron: Neuron) {
    let sum = 0;

    const state = neuron.creature.state;
    const toList = neuron.creature.inwardConnections(neuron.index);
    const len = toList.length;
    for (let i = 0; i < len; i++) {
      const { from, weight } = toList[i];
      const fromActivation = state.activations[from];

      sum += fromActivation * weight;
    }

    const value = limitValue(sum / len);

    return value + neuron.bias;
  }

  fix(neuron: Neuron) {
    const toListA = neuron.creature.inwardConnections(neuron.index);
    for (let i = toListA.length; i--;) {
      const c = toListA[i];
      if (c.from == c.to) {
        neuron.creature.disconnect(c.from, c.to);
      }
    }

    for (let attempts = 12; attempts--;) {
      const toList = neuron.creature.inwardConnections(neuron.index);

      if (toList.length < 2) {
        neuron.creature.makeRandomConnection(neuron.index);
      } else {
        break;
      }
    }
  }

  activateAndTrace(neuron: Neuron) {
    const activation = this.activate(neuron);

    const state = neuron.creature.state;
    const toList = neuron.creature.inwardConnections(neuron.index);
    for (let i = toList.length; i--;) {
      const { from, to } = toList[i];
      const cs = state.connection(
        from,
        to,
      );
      cs.used = true;
    }

    return activation;
  }

  propagate(
    neuron: Neuron,
    targetActivation: number,
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ): number {
    const toList = neuron.creature.inwardConnections(neuron.index);

    const activation = neuron.adjustedActivation(config);

    const targetValue = toValue(neuron, targetActivation);

    const currentValue = toValue(neuron, activation);
    const state = neuron.creature.state;
    const error = targetValue - currentValue;
    const errorPerSynapse = error / toList.length;

    let remainingError = error;
    let totalValue = 0;
    for (let indx = toList.length; indx--;) {
      const c = toList[indx];
      if (c.from === c.to) continue;
      const fromNeuron = neuron.creature.neurons[c.from];

      const fromActivation = fromNeuron.adjustedActivation(config);

      const fromWeight = adjustedWeight(state, c, config);

      const fromValue = fromWeight * fromActivation;

      const targetFromValue = fromValue + errorPerSynapse;
      let improvedFromActivation = fromActivation;
      if (Math.abs(fromWeight) > config.plankConstant) {
        const targetFromActivation = targetFromValue / fromWeight;

        if (
          Number.isFinite(targetFromActivation) &&
          fromWeight &&
          fromNeuron.type !== "input" &&
          fromNeuron.type !== "constant"
        ) {
          if (sparseConfig.propagateNeeded(fromNeuron.uuid)) {
            improvedFromActivation = fromNeuron.propagate(
              targetFromActivation,
              config,
              sparseConfig,
            );
          }
          const improvedFromValue = improvedFromActivation * fromWeight;

          remainingError = targetFromValue - improvedFromValue;
        }

        const targetFromValue2 = fromValue + remainingError;
        if (
          Math.abs(improvedFromActivation) > config.plankConstant &&
          Math.abs(fromWeight) > config.plankConstant &&
          Math.abs(targetFromValue2) < 1e100 &&
          Math.abs(targetFromActivation) < 1e100
        ) {
          const cs = state.connection(
            c.from,
            c.to,
          );
          accumulateWeight(
            c.weight,
            cs,
            targetFromValue2,
            targetFromActivation,
            config,
          );
        }
        const aWeight = adjustedWeight(
          state,
          c,
          config,
        );

        const improvedAdjustedFromValue = improvedFromActivation *
          aWeight;

        totalValue += improvedAdjustedFromValue;
      }
    }
    const currentBias = adjustedBias(neuron, config);

    const adjustedValue = (toList.length ? (totalValue / toList.length) : 0) +
      currentBias;

    const ns = state.node(neuron.index);
    accumulateBias(
      ns,
      targetValue,
      adjustedValue,
      currentBias,
      config,
    );

    const aBias = adjustedBias(neuron, config);

    const adjustedActivation = adjustedValue + aBias - currentBias;

    return this.range.limit(adjustedActivation);
  }
}
