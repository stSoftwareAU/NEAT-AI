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
  // Accumulate total target values and activations.
  cs.totalValue += targetValue;
  cs.totalActivation += activation;

  // Track absolute total activation to consider overall influence.
  cs.absoluteTotalActivation += Math.abs(activation);

  const sign = Math.sign(activation) || 1; // Maintain sign, defaulting to 1 if activation is zero.
  let tmpActivation = activation;

  // Prevent division issues with small activation values.
  if (Math.abs(tmpActivation) < config.plankConstant) {
    tmpActivation = config.plankConstant * sign;
  }

  // Adjust the target value if it's too small.
  const tmpValue = Math.abs(targetValue) > config.plankConstant
    ? targetValue
    : config.plankConstant * Math.sign(targetValue);

  // Calculate a preliminary weight based on the adjusted values.
  const tmpWeight = tmpValue / tmpActivation;

  // Adjust the weight with limiting.
  const adjustedLimitedWeight = limitWeight(tmpWeight, currentWeight, config);
  cs.totalAdjustedValue += adjustedLimitedWeight * tmpActivation;
  cs.totalAdjustedActivation += tmpActivation;

  // Adjust weights based on the difference.
  if (Math.abs(activation) > config.plankConstant) {
    // Track positive and negative activations separately.
    if (activation > 0) {
      cs.totalPositiveActivation += activation;
      cs.totalPositiveValue += targetValue;
      cs.totalPositiveAdjustedValue += adjustedLimitedWeight * activation;
      cs.countPositiveActivations++;
    } else if (activation < 0) {
      cs.totalNegativeActivation += Math.abs(activation);
      cs.totalNegativeValue += targetValue;
      cs.totalNegativeAdjustedValue += adjustedLimitedWeight * activation;
      cs.countNegativeActivations++;
    }

    // Calculate the difference in target and activation.
    let difference = activation !== 0
      ? (targetValue - activation) / activation
      : (targetValue > 0 ? config.plankConstant : -config.plankConstant);

    // Apply clamping directly if exponential scaling is disabled.
    if (!config.disableExponentialScaling) {
      difference = Math.tanh(difference / config.maximumWeightAdjustmentScale) *
        config.maximumWeightAdjustmentScale;
    } else if (Math.abs(difference) > config.maximumWeightAdjustmentScale) {
      difference = Math.sign(difference) * config.maximumWeightAdjustmentScale;
    }

    const adjustedWeight = currentWeight + difference;

    // Update the average weight for smooth transition.
    cs.averageWeight = ((cs.averageWeight * cs.count) + adjustedWeight) /
      (cs.count + 1);
  }

  // Increment the count after processing the adjustment.
  cs.count++;
}

export function adjustedWeight(
  creatureState: CreatureState,
  c: Synapse,
  config: BackPropagationConfig,
) {
  const cs = creatureState.connection(c.from, c.to);

  if (cs.count) {
    // Ensure there is meaningful data to adjust the weights.
    if (
      cs.totalPositiveActivation > config.plankConstant ||
      cs.totalNegativeActivation > config.plankConstant
    ) {
      // Compute adjusted weights for positive and negative contributions.
      const positiveWeight = cs.totalPositiveActivation > 0
        ? cs.totalPositiveAdjustedValue / cs.totalPositiveActivation
        : 0; // Default to 0 if no positive activations.

      const negativeWeight = cs.totalNegativeActivation > 0
        ? Math.sign(cs.totalNegativeAdjustedValue) *
          Math.abs(cs.totalNegativeAdjustedValue) / cs.totalNegativeActivation
        : 0; // Default to 0 if no negative activations.

      // Blend these weights based on their relative counts.
      const totalActivationCount = cs.countPositiveActivations +
        cs.countNegativeActivations;
      assert(totalActivationCount > 0, "Invalid total activation count");

      // Incorporate the effect of previous adjustments and generational weight.
      const synapseAverageWeightTotal =
        positiveWeight * cs.countPositiveActivations +
        negativeWeight * cs.countNegativeActivations;

      const generations = config.generations;
      const totalGenerationalWeight = c.weight * generations;

      // Blend adjusted and generational weights.
      const averageWeight =
        (synapseAverageWeightTotal + totalGenerationalWeight) /
        (totalActivationCount + generations);

      return limitWeight(averageWeight, c.weight, config);
    }
  }

  // If no significant activations, return the current weight.
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
