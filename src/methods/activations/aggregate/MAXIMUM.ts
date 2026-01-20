import { assert } from "@std/assert";
import type { DiscoverRecord } from "../../../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { Neuron } from "../../../architecture/Neuron.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import {
  type BackPropagationConfig,
  toValue,
} from "../../../propagate/BackPropagation.ts";
import { accumulateBias, adjustedBias } from "../../../propagate/Bias.ts";
import { getOrComputeRecordValue } from "../../../propagate/RecordElasticity.ts";
import type { SparseConfig } from "../../../propagate/sparse/SparseConfig.ts";
import type { SynapseState } from "../../../propagate/SynapseState.ts";
import { accumulateWeight, adjustedWeight } from "../../../propagate/Weight.ts";
import type { ApplyLearningsInterface } from "../ApplyLearningsInterface.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";
import { IDENTITY } from "../types/IDENTITY.ts";

/**
 * MAXIMUM aggregate activation function.
 * Issue #1123: WASM Migration Phase 6 - Inline JS code generation removed.
 */
export class MAXIMUM
  implements NeuronActivationInterface, ApplyLearningsInterface {
  public static NAME = "MAXIMUM";
  public mutationProbability = 1;

  public readonly range = new ActivationRange(
    MAXIMUM.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  getName() {
    return MAXIMUM.NAME;
  }

  activate(neuron: Neuron): number {
    const fromList = neuron.creature.inwardConnections(neuron.index);
    let tmpValue = Number.NEGATIVE_INFINITY;
    const state = neuron.creature.state;
    const activations = state.activations;
    for (let i = 0, len = fromList.length; i < len; i++) {
      const { from, weight } = fromList[i];
      const value = activations[from] * weight;
      if (value > tmpValue) {
        tmpValue = value;
      }
    }

    const value = tmpValue + neuron.bias;

    return this.range.limit(value);
  }

  activateAndTrace(neuron: Neuron) {
    const state = neuron.creature.state;
    let tmpValue = Number.NEGATIVE_INFINITY;
    const fromList = neuron.creature.inwardConnections(neuron.index);
    let usedState: SynapseState | null = null;
    const activations = state.activations;
    for (let i = 0, len = fromList.length; i < len; i++) {
      const c = fromList[i];
      const { from, to, weight } = c;
      const cs = state.connection(from, to);
      if (cs.used === undefined) cs.used = false;

      const value = activations[from] * weight;
      if (value > tmpValue) {
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
      let tmpValue = -Infinity;

      let mainConnection;
      let mainActivation;
      let mainFromNeuron;
      for (let indx = inward.length; indx--;) {
        const c = inward[indx];

        const fromNeuron = neuron.creature.neurons[c.from];

        const fromActivation = fromNeuron.adjustedActivation(config);

        const fromWeight = adjustedWeight(state, c, config);
        const fromValue = fromWeight * fromActivation;
        if (fromValue > tmpValue) {
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

  record(
    neuron: Neuron,
    requestedActivation: number,
    discoverMap: Map<string, DiscoverRecord>,
  ): void {
    const toList = neuron.creature.inwardConnections(neuron.index);

    const state = neuron.creature.state;

    const currentActivation = state.activations[neuron.index];

    // Ensure the current neuron has a DiscoverRecord with activation field
    let discoverRecord = discoverMap.get(neuron.uuid);
    const isFirstVisit = discoverRecord === undefined;
    if (isFirstVisit) {
      discoverRecord = {
        activation: currentActivation,
        errors: [],
      };
      discoverMap.set(neuron.uuid, discoverRecord);
    }

    let error = 0;
    if (Math.abs(requestedActivation - currentActivation) > 1e-8) {
      const targetValue = toValue(neuron, requestedActivation);
      const currentValue = toValue(neuron, currentActivation);

      error = targetValue - currentValue;
    }

    // Only process on first visit to prevent duplicate errors
    if (!isFirstVisit) return;

    discoverRecord!.errors.push(error);

    let mainValue = Number.MIN_SAFE_INTEGER;
    let mainNeuron;
    let mainWeight;
    let mainSafeZone = 0;
    for (let indx = 0; indx < toList.length; indx++) {
      const c = toList[indx];
      if (c.from === c.to) continue;

      const fromNeuron = neuron.creature.neurons[c.from];

      if (
        c.weight &&
        fromNeuron.type !== "input" &&
        fromNeuron.type !== "constant"
      ) {
        const fromActivation = state.activations[fromNeuron.index];

        const fromValue = c.weight * fromActivation;
        let safeZone = 1;
        const squash = fromNeuron.findSquash();
        if (squash.safeZoneAdjustment) {
          const rawInput = getOrComputeRecordValue(fromNeuron, discoverMap);
          safeZone = squash.safeZoneAdjustment(rawInput, error, c.weight);
        }

        if (
          fromValue > mainValue ||
          (fromValue === mainValue && safeZone > mainSafeZone)
        ) {
          mainValue = fromValue;
          mainNeuron = fromNeuron;
          mainWeight = c.weight;
          mainSafeZone = safeZone;
        }
      }
    }
    if (mainNeuron) {
      assert(mainWeight, "mainWeight not found");
      if (mainSafeZone <= 1e-12) {
        // Fully blocked: don't force recursion through an immovable max path.
        return;
      }
      const targetFromValue = mainValue + error;

      const targetFromActivation = targetFromValue / mainWeight;
      mainNeuron.record(
        targetFromActivation,
        discoverMap,
      );
    }
  }
}
