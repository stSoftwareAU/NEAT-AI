import { assert } from "@std/assert/assert";
import type { Neuron } from "../../../architecture/Neuron.ts";
import { findActivationFunction } from "../../../optimize/FunctionCache.ts";
import type { MakeActivationFunctionInterface } from "../../../optimize/MakeActivationFunctionInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type {
  BackPropagationConfig,
} from "../../../propagate/BackPropagation.ts";
import { accumulateBias, adjustedBias } from "../../../propagate/Bias.ts";
import type { SparseConfig } from "../../../propagate/sparse/SparseConfig.ts";
import type { SynapseState } from "../../../propagate/SynapseState.ts";
import { accumulateWeight, adjustedWeight } from "../../../propagate/Weight.ts";
import type { ApplyLearningsInterface } from "../ApplyLearningsInterface.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";
import { IDENTITY } from "../types/IDENTITY.ts";
import type { InlineActivationInterface } from "../../../optimize/InlineActivationInterface.ts";
import { makeSynapsesValue } from "../../../optimize/MakeNeuronActivation.ts";

export class MINIMUM
  implements
    NeuronActivationInterface,
    ApplyLearningsInterface,
    MakeActivationFunctionInterface,
    InlineActivationInterface {
  inlineActivation(neuron: Neuron) {
    let valueList = "";

    const inwardList = neuron.creature.inwardConnections(neuron.index);
    const inwardListClone = inwardList.slice(0).sort((a, b) => a.from - b.from);
    for (let i = 0, len = inwardListClone.length; i < len; i++) {
      if (i > 0) {
        valueList += ",";
      }
      const value = makeSynapsesValue(
        inwardListClone[i],
        neuron.creature.neurons,
      );
      valueList += value;
    }
    let functionBody = `a[${neuron.index}]= Math.min(${valueList})`;

    if (neuron.bias > 0) {
      functionBody += `+${neuron.bias};\n`;
    } else if (neuron.bias < 0) {
      functionBody += `${neuron.bias};\n`;
    } else {
      functionBody += `;\n`;
    }

    return functionBody;
  }

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
    let tmpValue = Number.POSITIVE_INFINITY;
    const state = neuron.creature.state;
    const activations = state.activations;
    for (let i = 0, len = fromList.length; i < len; i++) {
      const { from, weight } = fromList[i];
      const value = activations[from] * weight;
      if (value < tmpValue) {
        tmpValue = value;
      }
    }

    const value = tmpValue + neuron.bias;

    return this.range.limit(value);
  }

  activateAndTrace(neuron: Neuron) {
    const state = neuron.creature.state;
    let tmpValue = Number.POSITIVE_INFINITY;
    const fromList = neuron.creature.inwardConnections(neuron.index);
    let usedState: SynapseState | null = null;
    const activations = state.activations;
    for (let i = 0, len = fromList.length; i < len; i++) {
      const c = fromList[i];
      const { from, to, weight } = c;
      const cs = state.connection(from, to);
      if (cs.used === undefined) cs.used = false;

      const value = activations[from] * weight;
      if (value < tmpValue) {
        tmpValue = value;
        usedState = cs;
      }
    }

    usedState!.used = true;

    const value = tmpValue + neuron.bias;

    return this.range.limit(value);
  }

  fix(neuron: Neuron) {
    const fromListA = neuron.creature.inwardConnections(neuron.index);
    for (let i = fromListA.length; i--;) {
      const c = fromListA[i];
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

  applyLearnings(neuron: Neuron): boolean {
    let changed = false;

    const state = neuron.creature.state;
    const inward = neuron.creature.inwardConnections(neuron.index);
    for (let i = inward.length; i--;) {
      const c = inward[i];

      assert(c.to === neuron.index, "mismatched index");
      if (c.from === c.to) continue;

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

    const error = targetActivation - activation;

    if (Math.abs(error) < config.plankConstant) return targetActivation;

    const inward = neuron.creature.inwardConnections(neuron.index);
    const state = neuron.creature.state;

    let remainingError = error;
    const currentBias = adjustedBias(neuron, config);
    let improvedValue = 0;
    if (inward.length) {
      let tmpValue = Infinity;

      let mainConnection;
      let mainActivation;
      let mainFromNeuron;
      for (let indx = inward.length; indx--;) {
        const c = inward[indx];

        const fromNeuron = neuron.creature.neurons[c.from];

        const fromActivation = fromNeuron.adjustedActivation(config);

        const fromWeight = adjustedWeight(state, c, config);
        const fromValue = fromWeight * fromActivation;
        if (fromValue < tmpValue) {
          tmpValue = fromValue;
          mainConnection = c;
          mainActivation = fromActivation;
          mainFromNeuron = fromNeuron;
        }
      }

      const { from, to, weight } = mainConnection!;

      const mainCS = state.connection(from, to);
      accumulateWeight(
        weight,
        mainCS,
        tmpValue,
        mainActivation!,
        config,
      );

      const fromWeightAdjusted = adjustedWeight(
        state,
        mainConnection!,
        config,
      );
      let targetFromActivation = mainActivation!;
      let improvedFromActivation = targetFromActivation;
      const fromValue = fromWeightAdjusted * mainActivation!;
      if (sparseConfig.propagateNeeded(mainFromNeuron!.uuid)) {
        const targetFromValue = fromValue + error;
        const fromType = mainFromNeuron!.type;
        if (
          fromWeightAdjusted &&
          fromType !== "input" &&
          fromType !== "constant"
        ) {
          targetFromActivation = targetFromValue / fromWeightAdjusted;

          if (from !== to) {
            improvedFromActivation = mainFromNeuron!.propagate(
              targetFromActivation,
              config,
              sparseConfig,
            );

            const improvedFromValue = improvedFromActivation *
              fromWeightAdjusted;

            remainingError = targetFromValue - improvedFromValue;
          }
        }
      }

      const targetFromValue2 = fromValue + remainingError;

      accumulateWeight(
        weight,
        mainCS,
        targetFromValue2,
        targetFromActivation,
        config,
      );

      const aWeight = adjustedWeight(
        state,
        mainConnection!,
        config,
      );

      const improvedAdjustedFromValue = improvedFromActivation *
        aWeight;

      improvedValue = improvedAdjustedFromValue + currentBias;
    }

    const ns = neuron.creature.state.node(neuron.index);
    accumulateBias(
      ns,
      targetActivation,
      improvedValue,
      currentBias,
      config,
    );

    const aBias = adjustedBias(neuron, config);

    const adjustedActivation = improvedValue - currentBias + aBias;

    return adjustedActivation;
  }
}
