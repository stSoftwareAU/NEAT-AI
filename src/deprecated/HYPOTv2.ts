import { assert } from "@std/assert";
import type { DiscoverRecord } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { Neuron } from "../architecture/Neuron.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import { IDENTITY } from "../methods/activations/types/IDENTITY.ts";
import { ActivationRange } from "../propagate/ActivationRange.ts";
import type { BackPropagationConfig } from "../propagate/BackPropagation.ts";
import type { SparseConfig } from "../propagate/sparse/SparseConfig.ts";

/**
 * @deprecated No longer used since v2.0.0. A normal neural network can mimic the behaviour using SQRT & SQUARE.
 * Issue #1123: WASM Migration Phase 6 - Inline JS code generation removed.
 */
export class HYPOTv2 implements NeuronActivationInterface {
  public mutationProbability = 0;
  public static NAME = "HYPOTv2";
  complexityPenalty = 9_000;

  public readonly range = new ActivationRange(
    HYPOTv2.NAME,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  propagate(
    neuron: Neuron,
    targetActivation: number,
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ): number {
    const activation = neuron.adjustedActivation(config);

    const error = targetActivation - activation;

    const hypotValue = activation || 1;
    assert(Number.isFinite(hypotValue), "hypotValue must be finite");
    const inward = neuron.creature.inwardConnections(neuron.index);
    const values: number[] = new Array(inward.length);
    for (let indx = inward.length; indx--;) {
      const c = inward[indx];

      const fromNeuron = neuron.creature.neurons[c.from];

      const fromActivation = fromNeuron.adjustedActivation(config);
      if (fromNeuron.type === "hidden") {
        let improvedActivation = fromActivation;
        if (c.to !== c.from) {
          if (sparseConfig.propagateNeeded(fromNeuron.uuid)) {
            const currentValue = neuron.bias + improvedActivation * c.weight;
            const partialDerivative = currentValue / hypotValue;
            const fromError = error * partialDerivative;
            improvedActivation = fromNeuron.propagate(
              fromActivation + fromError,
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
      if (c.from === c.to) {
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

  record(
    _neuron: Neuron,
    _requestedActivation: number,
    _discoverMap: Map<string, DiscoverRecord>,
  ): void {
    // Do nothing
  }
}
