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

  // Adjust weights based on the difference.
  if (Math.abs(activation) > config.plankConstant) {
    // Track positive and negative activations separately.
    if (activation > 0) {
      cs.totalPositiveActivation += activation;
      cs.totalPositiveAdjustedValue += adjustedLimitedWeight * activation;
      cs.countPositiveActivations++;
    } else if (activation < 0) {
      cs.totalNegativeActivation += Math.abs(activation);
      cs.totalNegativeAdjustedValue += adjustedLimitedWeight * activation;
      cs.countNegativeActivations++;
    }
  }

  // Increment the count after processing the adjustment.
  cs.count++;
}

export function adjustedWeight(
  creatureState: CreatureState,
  c: Synapse,
  config: BackPropagationConfig,
): number {
  if (config.disableWeightAdjustment) {
    return c.weight;
  }
  const cs = creatureState.connection(c.from, c.to);
  if (cs.count && cs.count % config.batchSize === 0) {
    cs.batchAverageWeight = calculateWeight(cs, c, config);
  }

  if (cs.batchAverageWeight !== undefined) {
    return cs.batchAverageWeight;
  }

  return c.weight;
}

export function calculateWeight(
  cs: SynapseState,
  c: Synapse,
  config: BackPropagationConfig,
) {
  if (config.disableWeightAdjustment) {
    return c.weight;
  }
  if (cs.count) {
    // Ensure there is meaningful data to adjust the weights.
    if (
      cs.totalPositiveActivation > config.plankConstant ||
      cs.totalNegativeActivation > config.plankConstant
    ) {
      // Compute adjusted weights for positive and negative contributions.
      const positiveWeight = cs.totalPositiveActivation > config.plankConstant
        ? cs.totalPositiveAdjustedValue / cs.totalPositiveActivation
        : 0; // Default to 0 if no positive activations.

      const negativeWeight = cs.totalNegativeActivation > config.plankConstant
        ? cs.totalNegativeAdjustedValue / (cs.totalNegativeActivation * -1)
        : 0; // Default to 0 if no negative activations.

      // Blend these weights based on their relative counts.
      const totalActivationCount = cs.countPositiveActivations +
        cs.countNegativeActivations;
      assert(
        totalActivationCount <= cs.count,
        "Total count exceeds activation count",
      );
      assert(totalActivationCount > 0, "Invalid total activation count");

      // Incorporate the effect of previous adjustments and generational weight.
      const synapseAverageWeightTotal =
        positiveWeight * cs.countPositiveActivations +
        negativeWeight * cs.countNegativeActivations;

      const generations = config.generations + cs.count - totalActivationCount;
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

  if (Math.abs(targetWeight - currentWeight) < config.plankConstant) {
    return currentWeight;
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
