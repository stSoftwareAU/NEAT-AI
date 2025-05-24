import { assert } from "@std/assert/assert";
import type { DiscoverRecord } from "../../../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { Neuron } from "../../../architecture/Neuron.ts";
import { findActivationFunction } from "../../../optimize/FunctionCache.ts";
import type { InlineActivationInterface } from "../../../optimize/InlineActivationInterface.ts";
import type { MakeActivationFunctionInterface } from "../../../optimize/MakeActivationFunctionInterface.ts";
import { makeSynapsesValue } from "../../../optimize/MakeNeuronActivation.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { BackPropagationConfig } from "../../../propagate/BackPropagation.ts";
import type { SparseConfig } from "../../../propagate/sparse/SparseConfig.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";
import { IDENTITY } from "../types/IDENTITY.ts";

export class HYPOTv2
  implements
    NeuronActivationInterface,
    MakeActivationFunctionInterface,
    InlineActivationInterface {
  public mutationProbability = 0;
  public static NAME = "HYPOTv2";
  complexityPenalty = 9_000;
  inlineActivation(neuron: Neuron) {
    let valueLine = "";

    const inwardList = neuron.creature.inwardConnections(neuron.index);
    const inwardListClone = inwardList.slice(0).sort((a, b) => a.from - b.from);
    for (let i = 0, len = inwardListClone.length; i < len; i++) {
      if (i > 0) {
        valueLine += ",";
      }
      const value = makeSynapsesValue(
        inwardListClone[i],
        neuron.creature.neurons,
      );
      valueLine += value;
      valueLine += ` + ${neuron.bias}`;
    }

    const functionBody = `a[${neuron.index}]= Math.hypot(${valueLine});\n`;

    return functionBody;
  }

  public readonly range = new ActivationRange(
    HYPOTv2.NAME,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  makeActivationFunction(
    neuron: Neuron,
    cache: {
      key: string;
      function: () => { activation: number; value: number };
    },
  ): () => {
    activation: number;
    value: number;
  } {
    let functionBody = "const a = this.activations;\n";
    functionBody += this.inlineActivation(neuron);

    functionBody += `return { activation: a[${neuron.index}], value:0 };`;
    const foundFunction = findActivationFunction(functionBody, cache);
    if (foundFunction) {
      return foundFunction;
    }

    // Dynamically create the function
    const func = new Function(
      functionBody,
    ) as () => {
      activation: number;
      value: number;
    };

    // Bind static parameters: state and squash function
    const bondedFunction = func.bind(
      neuron.creature.state,
    );
    cache.function = bondedFunction;
    return bondedFunction;
  }

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
