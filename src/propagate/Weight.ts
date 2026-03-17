import { assert } from "@std/assert";
import type { CreatureState } from "../architecture/CreatureState.ts";
import type { Synapse } from "../architecture/Synapse.ts";
import { wasmCalculateWeight } from "../wasm/WasmStandaloneFunctions.ts";
import type { BackPropagationConfig } from "./BackPropagation.ts";
import type { SynapseState } from "./SynapseState.ts";

/**
 * Accumulates weight adjustments for a synapse during backpropagation.
 *
 * Issue #1314 - Non-finite activation and target values are detected early
 * and the accumulation is skipped to prevent corruption of the synapse state.
 * This protects against Infinity, -Infinity, and NaN values.
 */
export function accumulateWeight(
  currentWeight: number,
  cs: SynapseState,
  targetValue: number,
  activation: number,
  config: BackPropagationConfig,
) {
  // Issue #1314: Guard against non-finite inputs that would produce non-finite weights
  if (
    !Number.isFinite(activation) ||
    !Number.isFinite(targetValue) ||
    !Number.isFinite(currentWeight)
  ) {
    // Skip this accumulation to prevent state corruption
    return;
  }

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

  // Issue #1314: Guard against non-finite calculated weight
  if (!Number.isFinite(tmpWeight)) {
    return;
  }

  // Issue #1653: Accumulate the raw target weight without applying limitWeight.
  // The learning rate limiting is applied once in calculateWeight instead.

  // Adjust weights based on the difference.
  if (Math.abs(activation) > config.plankConstant) {
    // Track positive and negative activations separately.
    if (activation > 0) {
      cs.totalPositiveActivation += activation;
      cs.totalPositiveAdjustedValue += tmpWeight * activation;
      cs.countPositiveActivations++;
    } else if (activation < 0) {
      cs.totalNegativeActivation += Math.abs(activation);
      cs.totalNegativeAdjustedValue += tmpWeight * activation;
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

  // Issue #1518: Try WASM first
  const wasmResult = wasmCalculateWeight(cs, c.weight, config);
  if (wasmResult !== undefined) {
    return wasmResult;
  }

  return calculateWeightTS(cs, c, config);
}

/**
 * TypeScript fallback for weight calculation.
 */
function calculateWeightTS(
  cs: SynapseState,
  c: Synapse,
  config: BackPropagationConfig,
) {
  if (cs.count) {
    // Ensure there is meaningful data to adjust the weights.
    if (
      cs.totalPositiveActivation > config.plankConstant ||
      cs.totalNegativeActivation > config.plankConstant
    ) {
      // Compute adjusted weights for positive and negative contributions.
      const positiveWeight = cs.totalPositiveActivation > config.plankConstant
        ? cs.totalPositiveAdjustedValue / cs.totalPositiveActivation
        : 0;

      const negativeWeight = cs.totalNegativeActivation > config.plankConstant
        ? cs.totalNegativeAdjustedValue / (cs.totalNegativeActivation * -1)
        : 0;

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

      // Issue #1436: Cap effective generations
      const rawGenerations = config.generations + cs.count -
        totalActivationCount;
      const generations = Math.min(
        rawGenerations,
        totalActivationCount * 2,
      );
      const totalGenerationalWeight = c.weight * generations;

      const averageWeight =
        (synapseAverageWeightTotal + totalGenerationalWeight) /
        (totalActivationCount + generations);

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
    return applyWeightRegularisation(0, config);
  }

  if (Math.abs(targetWeight - currentWeight) < config.plankConstant) {
    return applyWeightRegularisation(currentWeight, config);
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

  return applyWeightRegularisation(limitedWeight, config);
}

/**
 * Issue #1859: Apply L1/L2 weight regularisation (weight decay).
 *
 * L2 shrinks weights proportionally to their magnitude: w *= (1 - lr * λ₂)
 * L1 applies soft-thresholding to drive small weights to zero:
 *   w -= lr * λ₁ * sign(w), snapping to zero if the penalty exceeds |w|.
 */
function applyWeightRegularisation(
  weight: number,
  config: BackPropagationConfig,
): number {
  let result = weight;

  // L2 regularisation (weight decay)
  if (config.l2WeightDecay > 0) {
    result *= 1 - config.learningRate * config.l2WeightDecay;
  }

  // L1 regularisation (sparsity via soft-thresholding)
  if (config.l1WeightDecay > 0 && result !== 0) {
    const l1Penalty = config.learningRate * config.l1WeightDecay;
    if (l1Penalty >= Math.abs(result)) {
      result = 0;
    } else {
      result -= l1Penalty * Math.sign(result);
    }
  }

  return result;
}

/**
 * Issue #1760 - Generic batch weight accumulation parameterised by batch size.
 * Issue #1214 - Batch weight accumulation for N synapses simultaneously.
 * Issue #1314 - Non-finite values are skipped to prevent state corruption.
 *
 * Processes `batchSize` synapses in a single call, enabling SIMD optimisation
 * via V8 when processing mini-batches during backpropagation.
 *
 * @param currentWeights Array of current synapse weights
 * @param csArray Array of SynapseState objects to accumulate into
 * @param targetValues Array of target values for weight calculation
 * @param activations Array of activation values from source neurons
 * @param config Backpropagation configuration
 * @param batchSize Number of synapses to process
 */
export function accumulateWeightBatchNWay(
  currentWeights: number[],
  csArray: SynapseState[],
  targetValues: number[],
  activations: number[],
  config: BackPropagationConfig,
  batchSize: number,
) {
  const plankConstant = config.plankConstant;

  for (let i = 0; i < batchSize; i++) {
    const activation = activations[i];
    const currentWeight = currentWeights[i];
    const targetValue = targetValues[i];

    if (
      !Number.isFinite(activation) ||
      !Number.isFinite(currentWeight) ||
      !Number.isFinite(targetValue)
    ) {
      continue;
    }

    const cs = csArray[i];

    const sign = Math.sign(activation) || 1;
    let tmpActivation = activation;

    if (Math.abs(tmpActivation) < plankConstant) {
      tmpActivation = plankConstant * sign;
    }

    const tmpValue = Math.abs(targetValue) > plankConstant
      ? targetValue
      : plankConstant * Math.sign(targetValue);

    const tmpWeight = tmpValue / tmpActivation;

    if (!Number.isFinite(tmpWeight)) {
      continue;
    }

    // Issue #1653: Accumulate raw target weight; limitWeight applied in calculateWeight.
    if (Math.abs(activation) > plankConstant) {
      if (activation > 0) {
        cs.totalPositiveActivation += activation;
        cs.totalPositiveAdjustedValue += tmpWeight * activation;
        cs.countPositiveActivations++;
      } else if (activation < 0) {
        cs.totalNegativeActivation += Math.abs(activation);
        cs.totalNegativeAdjustedValue += tmpWeight * activation;
        cs.countNegativeActivations++;
      }
    }

    cs.count++;
  }
}

/**
 * Issue #1214 - Batch weight accumulation for 4 synapses simultaneously.
 * Delegates to the generic accumulateWeightBatchNWay (issue #1760).
 */
export function accumulateWeightBatch4Way(
  currentWeights: number[],
  csArray: SynapseState[],
  targetValues: number[],
  activations: number[],
  config: BackPropagationConfig,
) {
  accumulateWeightBatchNWay(
    currentWeights,
    csArray,
    targetValues,
    activations,
    config,
    4,
  );
}

/**
 * Issue #1214 - Batch weight accumulation for 8 synapses simultaneously.
 * Delegates to the generic accumulateWeightBatchNWay (issue #1760).
 */
export function accumulateWeightBatch8Way(
  currentWeights: number[],
  csArray: SynapseState[],
  targetValues: number[],
  activations: number[],
  config: BackPropagationConfig,
) {
  accumulateWeightBatchNWay(
    currentWeights,
    csArray,
    targetValues,
    activations,
    config,
    8,
  );
}
