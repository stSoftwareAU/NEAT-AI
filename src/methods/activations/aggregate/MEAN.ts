import {
  accumulateWeight,
  adjustedBias,
  adjustedWeight,
  type BackPropagationConfig,
  limitActivation,
  limitValue,
  toValue,
} from "../../../architecture/BackPropagation.ts";
import type { Neuron } from "../../../architecture/Neuron.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";

export class MEAN implements NeuronActivationInterface {
  public static NAME = "MEAN";
  public readonly range: ActivationRange = new ActivationRange(
    this,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  getName() {
    return MEAN.NAME;
  }

  // range() {
  //   return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  // }

  activate(node: Neuron) {
    let sum = 0;

    const toList = node.creature.inwardConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const fromActivation = node.creature.state.activations[c.from];
      if (fromActivation) {
        const activation = limitActivation(fromActivation);

        sum += activation * c.weight;
      }
    }

    const value = limitValue(sum / toList.length);
    if (Number.isFinite(value) == false) {
      throw new Error(
        `Node: ${node.uuid} MEAN: ${value} is not finite sum: ${sum} toList.length: ${toList.length}`,
      );
    }
    return value;
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

  activateAndTrace(node: Neuron) {
    const activation = this.activate(node);

    const toList = node.creature.inwardConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const cs = node.creature.state.connection(
        c.from,
        c.to,
      );
      cs.used = true;
    }

    return activation;
  }

  propagate(
    node: Neuron,
    targetActivation: number,
    config: BackPropagationConfig,
  ): number {
    const toList = node.creature.inwardConnections(node.index);

    const activation = node.adjustedActivation(config);

    const targetValue = toValue(node, targetActivation);

    const currentValue = toValue(node, activation);

    const error = targetValue - currentValue;
    const errorPerSynapse = error / toList.length;

    let remainingError = error;
    let totalValue = 0;
    for (let indx = toList.length; indx--;) {
      const c = toList[indx];
      if (c.from === c.to) continue;
      const fromNeuron = node.creature.neurons[c.from];

      const fromActivation = fromNeuron.adjustedActivation(config);

      const fromWeight = adjustedWeight(node.creature.state, c, config);

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
          improvedFromActivation = fromNeuron.propagate(
            targetFromActivation,
            config,
          );

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
          const cs = node.creature.state.connection(
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
          node.creature.state,
          c,
          config,
        );

        const improvedAdjustedFromValue = improvedFromActivation *
          aWeight;

        totalValue += improvedAdjustedFromValue;
      }
    }
    const currentBias = adjustedBias(node, config);

    const adjustedValue = (toList.length ? (totalValue / toList.length) : 0) +
      currentBias;

    const ns = node.creature.state.node(node.index);
    ns.accumulateBias(
      targetValue,
      adjustedValue,
      currentBias,
    );

    const aBias = adjustedBias(node, config);

    const adjustedActivation = adjustedValue + aBias - currentBias;

    return adjustedActivation;
  }
}
