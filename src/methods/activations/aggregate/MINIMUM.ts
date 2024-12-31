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
import type { SparseConfig } from "../../../propagate/sparse/SparseConfig.ts";

export class MINIMUM
  implements NeuronActivationInterface, ApplyLearningsInterface {
  public static NAME = "MINIMUM";

  public readonly range = new ActivationRange(
    MINIMUM.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  getName() {
    return MINIMUM.NAME;
  }

  activate(neuron: Neuron): number {
    const fromList = neuron.creature.inwardConnections(neuron.index);
    let minValue = Number.POSITIVE_INFINITY;
    const state = neuron.creature.state;
    const activations = state.activations;
    for (let i = fromList.length; i--;) {
      const { from, weight } = fromList[i];
      const value = activations[from] * weight;
      if (value < minValue) {
        minValue = value;
      }
    }

    const value = minValue + neuron.bias;

    return this.range.limit(value);
  }

  activateAndTrace(neuron: Neuron) {
    const state = neuron.creature.state;
    let minValue = Number.POSITIVE_INFINITY;
    const fromList = neuron.creature.inwardConnections(neuron.index);
    let usedConnection: SynapseInternal | null = null;
    const activations = state.activations;
    for (let i = fromList.length; i--;) {
      const c = fromList[i];
      const cs = state.connection(c.from, c.to);
      if (cs.used == undefined) cs.used = false;

      const value = activations[c.from] * c.weight;
      if (value < minValue) {
        minValue = value;
        usedConnection = c;
      }
    }

    if (usedConnection != null) {
      const cs = state.connection(
        usedConnection.from,
        usedConnection.to,
      );
      cs.used = true;
    }

    const value = minValue + neuron.bias;

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

    const state = neuron.creature.state;
    const inward = neuron.creature.inwardConnections(neuron.index);
    for (let i = inward.length; i--;) {
      const c = inward[i];

      assert(c.to == neuron.index, "mismatched index");
      if (c.from == c.to) continue;

      const cs = state.connection(c.from, c.to);
      if (!cs.used) {
        neuron.creature.disconnect(c.from, c.to);
        changed = true;
      }
    }

    return changed;
  }

  propagate(
    neuron: Neuron,
    targetActivation: number,
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ): number {
    const activation = neuron.adjustedActivation(config);

    const inward = neuron.creature.inwardConnections(neuron.index);
    const targetValue = toValue(neuron, targetActivation);

    const activationValue = toValue(neuron, activation);
    const state = neuron.creature.state;
    const error = targetValue - activationValue;
    let remainingError = error;
    const currentBias = adjustedBias(neuron, config);
    let improvedValue = 0;
    if (inward.length) {
      let minValue = Infinity;

      let mainConnection;
      let mainActivation;

      for (let indx = inward.length; indx--;) {
        const c = inward[indx];

        const fromNeuron = neuron.creature.neurons[c.from];

        const fromActivation = fromNeuron.adjustedActivation(config);

        const fromWeight = adjustedWeight(state, c, config);
        const fromValue = fromWeight * fromActivation;
        if (fromValue < minValue) {
          minValue = fromValue;
          mainConnection = c;
          mainActivation = fromActivation;
        }
      }

      assert(mainConnection != undefined);

      const { from, to, weight } = mainConnection;
      const mainFromNeuron = neuron.creature.neurons[from];

      const fromActivation = mainFromNeuron.adjustedActivation(config);

      /** No Change Propagate */
      if (
        mainFromNeuron.type !== "input" && mainFromNeuron.type !== "constant"
      ) {
        if (from != to) {
          mainFromNeuron.propagate(fromActivation, config, sparseConfig);
        }
      }

      const mainCS = state.connection(from, to);
      accumulateWeight(
        weight,
        mainCS,
        minValue,
        fromActivation,
        config,
      );

      assert(mainActivation != undefined);
      const fromNeuron = neuron.creature.neurons[from];

      const fromWeightAdjusted = adjustedWeight(
        state,
        mainConnection,
        config,
      );
      const fromValue = fromWeightAdjusted * mainActivation;

      let improvedFromActivation = mainActivation;
      let targetFromActivation = mainActivation;
      const targetFromValue = fromValue + error;
      if (
        fromWeightAdjusted &&
        fromNeuron.type !== "input" &&
        fromNeuron.type !== "constant"
      ) {
        targetFromActivation = targetFromValue / fromWeightAdjusted;

        if (mainConnection.from != mainConnection.to) {
          if (sparseConfig.propagateNeeded(fromNeuron.uuid)) {
            improvedFromActivation = fromNeuron.propagate(
              targetFromActivation,
              config,
              sparseConfig,
            );
          }
        }

        const improvedFromValue = improvedFromActivation * fromWeightAdjusted;

        remainingError = targetFromValue - improvedFromValue;
      }

      const targetFromValue2 = fromValue + remainingError;

      const cs = state.connection(
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
        state,
        mainConnection,
        config,
      );

      const improvedAdjustedFromValue = improvedFromActivation *
        aWeight;

      improvedValue = improvedAdjustedFromValue + currentBias;
    }

    const ns = neuron.creature.state.node(neuron.index);
    accumulateBias(
      ns,
      targetValue,
      improvedValue,
      currentBias,
      config,
    );

    const aBias = adjustedBias(neuron, config);

    const adjustedActivation = improvedValue - currentBias + aBias;

    return adjustedActivation;
  }
}
