import type { CreatureState } from "@architecture/CreatureState.ts";
import type { Synapse } from "@architecture/Synapse.ts";
import { wasmCalculateWeight } from "@wasm/WasmStandaloneFunctions.ts";
import type { BackPropagationConfig } from "@propagate/BackPropagation.ts";
import type { SynapseState } from "@propagate/SynapseState.ts";

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
  if (config.disableWeightAdjustment || c.frozen) {
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

/**
 * Issue #1953: Calculate the finalised weight via WASM exclusively.
 *
 * WASM is mandatory — no TypeScript fallback. Throws WasmError if the
 * WASM module is not loaded.
 */
export function calculateWeight(
  cs: SynapseState,
  c: Synapse,
  config: BackPropagationConfig,
) {
  if (config.disableWeightAdjustment || c.frozen) {
    return c.weight;
  }

  return wasmCalculateWeight(cs, c.weight, config);
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
