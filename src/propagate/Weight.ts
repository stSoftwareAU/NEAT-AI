import { assert } from "@std/assert/assert";
import type { CreatureState } from "../architecture/CreatureState.ts";
import type { Synapse } from "../architecture/Synapse.ts";
import type { BackPropagationConfig } from "./BackPropagation.ts";
import type { SynapseState } from "./SynapseState.ts";

export function accumulateWeight(
  currentWeight: number,
  cs: SynapseState,
  targetValue: number,
  activation: number,
  config: BackPropagationConfig,
) {
  // Accumulate values for later averaging.
  cs.totalValue += targetValue;
  cs.totalActivation += activation;

  const sign = Math.sign(activation) || 1; // Maintain sign, defaulting to 1 if activation is zero.
  let tmpActivation = activation;

  // Ensure tmpActivation isn't too close to zero, to avoid division issues.
  if (Math.abs(tmpActivation) < config.plankConstant) {
    tmpActivation = config.plankConstant * sign;
  }

  // Adjust target value to ensure it's significant enough for calculations.
  const tmpValue = Math.abs(targetValue) > config.plankConstant
    ? targetValue
    : config.plankConstant * Math.sign(targetValue);

  // Calculate a preliminary weight based on target value and adjusted activation.
  const tmpWeight = tmpValue / tmpActivation;

  // Adjust the weight with a limit based on configuration.
  const adjustedLimitedWeight = limitWeight(tmpWeight, currentWeight, config);
  cs.totalAdjustedValue += adjustedLimitedWeight * tmpActivation;
  cs.totalAdjustedActivation += tmpActivation;

  // Fine-tune the weight adjustment based on target and current values.
  if (Math.abs(activation) > config.plankConstant) {
    // Adjust the difference based on target and activation.
    let difference = (targetValue - activation) / activation;

    // Apply exponential scaling or clamping to avoid drastic changes.
    if (!config.disableExponentialScaling) {
      difference = Math.tanh(difference / config.maximumWeightAdjustmentScale) *
        config.maximumWeightAdjustmentScale;
    } else if (Math.abs(difference) > config.maximumWeightAdjustmentScale) {
      difference = Math.sign(difference) * config.maximumWeightAdjustmentScale;
    }

    const adjustedWeight = currentWeight + difference;
    // Update the average weight.
    cs.averageWeight = ((cs.averageWeight * cs.count) + adjustedWeight) /
      (cs.count + 1);
  }
  cs.count++;
}

export function adjustedWeight(
  creatureState: CreatureState,
  c: Synapse,
  config: BackPropagationConfig,
) {
  const cs = creatureState.connection(c.from, c.to);

  if (cs.count) {
    if (Math.abs(cs.totalAdjustedActivation) > config.plankConstant) {
      // Calculate the weighted average of adjustments and generations.
      const synapseAverageWeight = cs.totalAdjustedValue /
        cs.totalAdjustedActivation;
      const synapseAverageWeightTotal = synapseAverageWeight * cs.count;
      const generations = config.generations;
      const totalGenerationalWeight = c.weight * generations;

      // Blend the generational and adjusted weights for smoothing.
      const averageWeight =
        (synapseAverageWeightTotal + totalGenerationalWeight) /
        (cs.count + generations);

      return limitWeight(averageWeight, c.weight, config);
    }
  }

  return c.weight;
}

export function limitWeight(
  targetWeight: number,
  currentWeight: number,
  config: BackPropagationConfig,
) {
  // Ensure weights are finite.
  assert(Number.isFinite(targetWeight), "Invalid target weight");
  assert(Number.isFinite(currentWeight), "Invalid current weight");

  // Prevent exceedingly small weights.
  if (Math.abs(targetWeight) < config.plankConstant) {
    return 0;
  }

  // Calculate and apply the difference with learning rate.
  const difference = config.learningRate * (targetWeight - currentWeight);
  let limitedWeight = currentWeight + difference;

  // Clamp the adjustment based on the configured max scale.
  if (Math.abs(difference) > config.maximumWeightAdjustmentScale) {
    limitedWeight = currentWeight +
      Math.sign(difference) * config.maximumWeightAdjustmentScale;
  }

  // Enforce the global weight scale limit.
  if (Math.abs(limitedWeight) > config.limitWeightScale) {
    limitedWeight = Math.sign(limitedWeight) * config.limitWeightScale;
  }

  return limitedWeight;
}
