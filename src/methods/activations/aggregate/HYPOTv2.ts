import type { BackPropagationConfig } from "../../../propagate/BackPropagation.ts";
import type { Neuron } from "../../../architecture/Neuron.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";
import type { SparseConfig } from "../../../propagate/sparse/SparseConfig.ts";
import { IDENTITY } from "../types/IDENTITY.ts";

export class HYPOTv2 implements NeuronActivationInterface {
  public static NAME = "HYPOTv2";

  public readonly range = new ActivationRange(
    HYPOTv2.NAME,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  propagate(
    neuron: Neuron,
    _targetActivation: number,
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ): number {
    const inward = neuron.creature.inwardConnections(neuron.index);
    const values: number[] = new Array(inward.length);
    for (let indx = inward.length; indx--;) {
      const c = inward[indx];

      const fromNeuron = neuron.creature.neurons[c.from];

      const fromActivation = fromNeuron.adjustedActivation(config);
      if (fromNeuron.type == "hidden") {
        let improvedActivation = fromActivation;
        if (c.to != c.from) {
          if (sparseConfig.propagateNeeded(fromNeuron.uuid)) {
            improvedActivation = fromNeuron.propagate(
              fromActivation,
              config,
              sparseConfig,
            );
          }
        }
        values[indx] = neuron.bias + improvedActivation * c.weight;
      } else {
        values[indx] = neuron.bias + fromActivation * c.weight;
      }
    }

    const value = Math.hypot(...values);
    return this.range.limit(value);
  }

  getName() {
    return HYPOTv2.NAME;
  }

  activate(neuron: Neuron) {
    const inward = neuron.creature.inwardConnections(neuron.index);
    const values: number[] = new Array(inward.length);
    const state = neuron.creature.state;
    const activations = state.activations;
    for (let i = inward.length; i--;) {
      const { from, weight } = inward[i];

      values[i] = neuron.bias + activations[from] * weight;
    }

    const value = Math.hypot(...values);
    return this.range.limit(value);
  }

  activateAndTrace(neuron: Neuron) {
    return this.activate(neuron);
  }

  fix(neuron: Neuron) {
    const inwardA = neuron.creature.inwardConnections(neuron.index);
    for (let i = inwardA.length; i--;) {
      const c = inwardA[i];
      if (c.from == c.to) {
        neuron.creature.disconnect(c.from, c.to);
      }
    }

    const inwardB = neuron.creature.inwardConnections(neuron.index);

    if (inwardB.length < 2) {
      neuron.setSquash(IDENTITY.NAME);
    }
  }
}
