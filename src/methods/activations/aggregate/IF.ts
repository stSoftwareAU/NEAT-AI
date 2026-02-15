import { CreatureUtil } from "../../../architecture/CreatureUtils.ts";
import type { DiscoverRecord } from "../../../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { Neuron } from "../../../architecture/Neuron.ts";
import { Mutation } from "../../../NEAT/Mutation.ts";
import { findActivationFunction } from "../../../optimize/FunctionCache.ts";
import type { InlineActivationInterface } from "../../../optimize/InlineActivationInterface.ts";
import type { MakeActivationFunctionInterface } from "../../../optimize/MakeActivationFunctionInterface.ts";
import { makeSynapsesValue } from "../../../optimize/makeSynapsesValue.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import {
  type BackPropagationConfig,
  limitValue,
  toValue,
} from "../../../propagate/BackPropagation.ts";
import { accumulateBias, adjustedBias } from "../../../propagate/Bias.ts";
import {
  buildRecordElasticLinks,
  constrainAndRedistributeRecordShares,
  distributeRecordError,
} from "../../../propagate/RecordElasticity.ts";
import type { SparseConfig } from "../../../propagate/sparse/SparseConfig.ts";
import { accumulateWeight, adjustedWeight } from "../../../propagate/Weight.ts";
import type { ApplyLearningsInterface } from "../ApplyLearningsInterface.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";
import { IDENTITY } from "../types/IDENTITY.ts";
import { getRandomNumberGenerator } from "../../../utils/RandomNumberGenerator.ts";

export class IF
  implements
    NeuronActivationInterface,
    ApplyLearningsInterface,
    MakeActivationFunctionInterface,
    InlineActivationInterface {
  public mutationProbability = 1;
  public static NAME = "IF";
  complexityPenalty = 3;
  public readonly range = new ActivationRange(
    IF.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  inlineActivation(neuron: Neuron) {
    let functionBody = "";
    let firstCondition = true;
    let negativeBody = ` a[${neuron.index}]=${neuron.bias}`;
    let positiveBody = ` a[${neuron.index}]=${neuron.bias}`;
    const inwardList = neuron.creature.inwardConnections(neuron.index);
    const inwardListClone = inwardList.slice(0).sort((a, b) => a.from - b.from);
    for (let i = 0, len = inwardListClone.length; i < len; i++) {
      const { type } = inwardListClone[i];

      const value = makeSynapsesValue(
        inwardListClone[i],
        neuron.creature.neurons,
      );

      if (type === "condition") {
        if (firstCondition) {
          firstCondition = false;
          functionBody += `if( ${value}`;
        } else {
          functionBody += `+ ${value}`;
        }
      } else if (type === "negative") {
        negativeBody += `+ ${value}`;
      } else {
        positiveBody += `+ ${value}`;
      }
    }
    functionBody += `>0){\n`;
    functionBody += positiveBody;
    functionBody += ";\n}else{\n";
    functionBody += negativeBody;
    functionBody += ";\n}\n";
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
    functionBody += `return { activation:a[${neuron.index}], value:0 };`;
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
  getName() {
    return IF.NAME;
  }

  fix(neuron: Neuron) {
    const toListA = neuron.creature.inwardConnections(neuron.index);
    for (let i = toListA.length; i--;) {
      const c = toListA[i];
      if (c.from === c.to) {
        neuron.creature.disconnect(c.from, c.to);
      }
    }

    const toList = neuron.creature.inwardConnections(neuron.index);
    const spareList = [];
    let foundPositive = false;
    let foundCondition = false;
    let foundNegative = false;

    for (let i = toList.length; i--;) {
      const c = toList[i];
      if (c.type === "condition") {
        if (foundCondition) {
          spareList.push(c);
        } else {
          foundCondition = true;
        }
      } else if (c.type === "negative") {
        if (foundNegative) {
          spareList.push(c);
        } else {
          foundNegative = true;
        }
      } else if (c.type === "positive") {
        if (foundPositive) {
          spareList.push(c);
        } else {
          foundPositive = true;
        }
      }
    }

    for (let i = toList.length; i--;) {
      const c = toList[i];
      if (c.type === undefined) {
        if (!foundCondition) {
          foundCondition = true;
          c.type = "condition";
        } else if (!foundNegative) {
          foundNegative = true;
          c.type = "negative";
        } else if (!foundPositive) {
          foundPositive = true;
          c.type = "positive";
        } else {
          switch (Math.floor(getRandomNumberGenerator().random() * 3)) {
            case 0:
              c.type = "condition";
              break;
            case 1:
              c.type = "negative";
              break;
            default:
              c.type = "positive";
          }
        }
      }
    }

    if (!foundCondition) {
      const c = neuron.creature.makeRandomConnection(neuron.index);
      if (c) {
        c.type = "condition";
        foundCondition = true;
      }
    }

    if (!foundNegative) {
      const c = neuron.creature.makeRandomConnection(neuron.index);

      if (c) {
        c.type = "negative";
        foundNegative = true;
      }
    }

    if (!foundPositive) {
      const c = neuron.creature.makeRandomConnection(neuron.index);

      if (c) {
        c.type = "positive";
        foundPositive = true;
      }
    }

    if (!foundCondition) {
      const c = spareList.pop();
      if (c) {
        foundCondition = true;
        c.type = "condition";
      }
    }

    if (!foundNegative) {
      const c = spareList.pop();
      if (c) {
        foundNegative = true;
        c.type = "negative";
      }
    }
    if (!foundPositive) {
      const c = spareList.pop();
      if (c) {
        foundPositive = true;
        c.type = "positive";
      }
    }

    const toList2 = neuron.creature.inwardConnections(neuron.index);

    if (toList2.length < 3 && neuron.index > 2) {
      // This topology cannot satisfy IF's three inbound requirements
      // (condition/positive/negative). In small networks, `makeRandomConnection()`
      // intentionally avoids connecting from outputs, so a final output neuron may
      // never reach 3 inbound links. Rather than throwing (flaky initialisation),
      // deterministically downgrade to a standard squash.
      if (neuron.type === "output") {
        neuron.squash = "IDENTITY";
      } else {
        neuron.squash = "TANH";
      }
      return;
    }

    if (!foundCondition || !foundNegative || !foundPositive) {
      neuron.mutate(Mutation.MOD_SQUASH.name);
    }
  }

  activateAndTrace(neuron: Neuron) {
    let condition = 0;
    let negative = 0;
    let positive = 0;

    const creature = neuron.creature;
    const state = creature.state;
    const activations = state.activations;
    const inward = creature.inwardConnections(neuron.index);
    for (let i = inward.length; i--;) {
      const { from, weight, type } = inward[i];

      const value = activations[from] * weight;
      switch (type) {
        case "condition":
          condition += value;
          break;
        case "negative":
          negative += value;
          break;
        default:
          positive += value;
      }
    }

    if (condition > 0) {
      for (let i = inward.length; i--;) {
        const { from, to, type } = inward[i];
        const cs = state.connection(from, to);
        switch (type) {
          case "condition":
          case "negative":
            if (cs.used === undefined) cs.used = false;
            break;
          default:
            cs.used = true;
        }
      }
    } else {
      for (let i = inward.length; i--;) {
        const { from, to, type } = inward[i];

        if (type === "negative") {
          state.connection(from, to).used = true;
        }
      }
    }

    const activation = (condition > 0 ? positive : negative) + neuron.bias;
    const limitedActivation = this.range.limit(activation);
    return limitedActivation;
  }

  activate(neuron: Neuron): number {
    let condition = 0;
    let negative = 0;
    let positive = 0;

    const creature = neuron.creature;
    const state = creature.state;
    const activations = state.activations;
    const inward = creature.inwardConnections(neuron.index);
    for (let i = 0, len = inward.length; i < len; i++) {
      const { from, weight, type } = inward[i];

      const value = activations[from] * weight;
      switch (type) {
        case "condition":
          condition += value;
          break;
        case "negative":
          negative += value;
          break;
        default:
          positive += value;
      }
    }

    const activation = (condition > 0 ? positive : negative) + neuron.bias;
    const limitedActivation = this.range.limit(activation);
    return limitedActivation;
  }

  applyLearnings(neuron: Neuron): boolean {
    const inward = neuron.creature.inwardConnections(neuron.index);

    let foundPositive = false;

    let foundNegative = false;
    const state = neuron.creature.state;
    for (let i = inward.length; i--;) {
      const c = inward[i];
      const cs = state.connection(c.from, c.to);
      switch (c.type) {
        case "condition":
          break;
        case "negative":
          if (cs.used) {
            foundNegative = true;
          }
          break;
        default:
          if (cs.used) {
            foundPositive = true;
          }
      }
    }

    if (foundNegative && foundPositive) {
      return false;
    }

    for (let i = inward.length; i--;) {
      const c = inward[i];

      switch (c.type) {
        case "condition":
          neuron.creature.disconnect(c.from, c.to);
          break;
        case "negative":
          if (foundPositive) {
            neuron.creature.disconnect(c.from, c.to);
          }
          break;
        default:
          if (foundNegative) {
            neuron.creature.disconnect(c.from, c.to);
          }
      }
    }

    neuron.setSquash(IDENTITY.NAME);

    return true;
  }

  propagate(
    neuron: Neuron,
    targetActivation: number,
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ): number {
    const activation = neuron.adjustedActivation(config);

    const inward = neuron.creature.inwardConnections(neuron.index);
    let condition = 0;
    let negativeCount = 0;
    let positiveCount = 0;
    const state = neuron.creature.state;
    const activations = state.activations;
    for (let i = inward.length; i--;) {
      const c = inward[i];

      const value = activations[c.from] * c.weight;

      switch (c.type) {
        case "condition":
          condition = limitValue(condition + value);
          break;
        case "negative":
          negativeCount++;
          break;
        default:
          positiveCount++;
      }
    }

    const ns = state.node(neuron.index);
    const currentBias = adjustedBias(neuron, config);
    const targetValue = toValue(neuron, targetActivation - currentBias);

    const activationValue = toValue(neuron, activation - currentBias);
    const error = targetValue - activationValue;

    let improvedValue = currentBias;

    const listLength = inward.length;
    const indices = Int32Array.from({ length: listLength }, (_, i) => i); // Create an array of indices

    if (!config.disableRandomSamples) {
      CreatureUtil.shuffle(indices);
    }

    const errorPerLink = error /
      (condition > 0 ? positiveCount : negativeCount);
    // Iterate over the shuffled indices
    for (let i = listLength; i--;) {
      const indx = indices[i];
      let thisPerLinkError = errorPerLink;

      const c = inward[indx];

      if (c.from === c.to) continue;
      if (c.type === "condition") continue;
      if (c.type === "positive" && condition <= 0) continue;
      if (c.type === "negative" && condition > 0) continue;

      const fromNeuron = neuron.creature.neurons[c.from];
      const fromActivation = fromNeuron.adjustedActivation(config);

      const cs = state.connection(c.from, c.to);

      const fromWeight = adjustedWeight(state, c, config);
      const fromValue = fromWeight * fromActivation;

      let improvedFromActivation = fromActivation;
      let targetFromActivation = fromActivation;
      const targetFromValue = fromValue + errorPerLink;
      let improvedFromValue = fromValue;
      if (
        fromWeight &&
        fromNeuron.type !== "input" &&
        fromNeuron.type !== "constant"
      ) {
        targetFromActivation = targetFromValue / fromWeight;
        if (sparseConfig.propagateNeeded(fromNeuron.uuid)) {
          improvedFromActivation = fromNeuron.propagate(
            targetFromActivation,
            config,
            sparseConfig,
          );
        }
        improvedFromValue = improvedFromActivation * fromWeight;

        thisPerLinkError = targetFromValue - improvedFromValue;
      }

      const targetFromValue2 = fromValue + thisPerLinkError;
      accumulateWeight(
        c.weight,
        cs,
        targetFromValue2,
        targetFromActivation,
        config,
      );

      const aWeight = adjustedWeight(state, c, config);
      const improvedAdjustedFromValue = improvedFromActivation *
        aWeight;

      improvedValue += improvedAdjustedFromValue;
    }

    accumulateBias(
      ns,
      targetValue,
      improvedValue,
      currentBias,
      config,
    );

    const aBias = adjustedBias(neuron, config);

    const adjustedActivation = improvedValue + aBias - currentBias;
    const limitedActivation = this.range.limit(adjustedActivation);
    return limitedActivation;
  }

  record(
    neuron: Neuron,
    requestedActivation: number,
    discoverMap: Map<string, DiscoverRecord>,
  ): void {
    const inward = neuron.creature.inwardConnections(neuron.index);
    let condition = 0;
    let negativeCount = 0;
    let positiveCount = 0;
    const state = neuron.creature.state;
    const activations = state.activations;
    for (let i = inward.length; i--;) {
      const c = inward[i];

      const value = activations[c.from] * c.weight;

      switch (c.type) {
        case "condition":
          condition = limitValue(condition + value);
          break;
        case "negative":
          negativeCount++;
          break;
        default:
          positiveCount++;
      }
    }

    const currentActivation = state.activations[neuron.index];

    let error = 0;
    if (Math.abs(requestedActivation - currentActivation) > 1e-8) {
      const targetValue = toValue(neuron, requestedActivation);
      const currentValue = toValue(neuron, currentActivation);

      error = targetValue - currentValue;
    }

    const eligible = inward.filter((c) => {
      if (c.from === c.to) return false;
      if (c.type === "condition") return false;
      if (c.type === "positive" && condition <= 0) return false;
      if (c.type === "negative" && condition > 0) return false;
      return true;
    });

    if (eligible.length === 0) return;

    const provisionalErrorPerLink = error / eligible.length;
    const links = buildRecordElasticLinks(
      neuron,
      eligible,
      discoverMap,
      provisionalErrorPerLink,
    );
    const { links: chosenLinks, shares } = distributeRecordError(error, links, {
      plankConstant: 1e-12,
      allowEqualFallback: true,
    });

    const plankConstant = 1e-12;

    const constrainedShares = constrainAndRedistributeRecordShares(
      error,
      chosenLinks,
      shares,
      { plankConstant },
    );

    for (let i = 0; i < chosenLinks.length; i++) {
      const link = chosenLinks[i];
      const share = constrainedShares[i] ?? 0;
      if (!Number.isFinite(share) || Math.abs(share) <= plankConstant) continue;

      if (!Number.isFinite(link.safeZoneFactor) || link.safeZoneFactor <= 0) {
        continue;
      }

      const weight = link.synapse.weight;
      if (!weight) continue;

      const targetFromValue = link.fromValue + share;
      const targetFromActivation = targetFromValue / weight;

      link.fromNeuron.record(targetFromActivation, discoverMap);
    }
  }
}
