import type { NeuronState } from "../architecture/CreatureState.ts";
import { ValidationError } from "../errors/ValidationError.ts";
import type { Neuron } from "../architecture/Neuron.ts";
import { wasmCalculateBias } from "../wasm/WasmStandaloneFunctions.ts";
import type { BackPropagationConfig } from "./BackPropagation.ts";

/**
 * Accumulates bias adjustments for a neuron during backpropagation.
 *
 * Issue #1314 - Non-finite pre-activation values are detected early and
 * the accumulation is skipped to prevent corruption of the neuron state.
 * This protects against Infinity, -Infinity, and NaN values.
 */
export function accumulateBias(
  ns: NeuronState,
  targetPreActivationValue: number,
  preActivationValue: number,
  currentBias: number,
  _config: BackPropagationConfig,
) {
  // Issue #1314: Guard against non-finite inputs that would produce non-finite bias
  if (
    !Number.isFinite(targetPreActivationValue) ||
    !Number.isFinite(preActivationValue) ||
    !Number.isFinite(currentBias)
  ) {
    // Skip this accumulation to prevent state corruption
    return;
  }

  const biasDelta = targetPreActivationValue - preActivationValue;

  // Issue #1314: Guard against non-finite biasDelta (e.g., from extreme values)
  if (!Number.isFinite(biasDelta)) {
    return;
  }

  const targetBias = currentBias + biasDelta;

  // Issue #1314: Guard against non-finite targetBias
  if (!Number.isFinite(targetBias)) {
    return;
  }

  ns.count++;
  ns.totalBias += targetBias;
  // Issue #1653: Accumulate raw target bias; limitBias applied in calculateBias.
  ns.totalAdjustedBias += targetBias;
}

export function adjustedBias(
  neuron: Neuron,
  config: BackPropagationConfig,
): number {
  if (neuron.type === "constant") {
    return neuron.bias;
  } else {
    if (config.disableBiasAdjustment || neuron.frozen) {
      return neuron.bias;
    }

    const ns = neuron.creature.state.node(neuron.index);

    if (ns.count && ns.count % config.batchSize === 0) {
      ns.batchBias = calculateBias(neuron, config);
    }

    if (ns.batchBias !== undefined) {
      return ns.batchBias;
    }

    return neuron.bias;
  }
}

export function calculateBias(
  neuron: Neuron,
  config: BackPropagationConfig,
): number {
  if (neuron.type === "constant") {
    return neuron.bias;
  } else {
    if (config.disableBiasAdjustment || neuron.frozen) {
      return neuron.bias;
    }
    const ns = neuron.creature.state.node(neuron.index);

    if (!ns.noChange && ns.count) {
      // Issue #1518: Try WASM first
      const wasmResult = wasmCalculateBias(
        ns.count,
        ns.totalAdjustedBias,
        neuron.bias,
        !!ns.noChange,
        config,
      );
      if (wasmResult !== undefined) {
        return wasmResult;
      }

      // TypeScript fallback
      // Issue #1436: Cap effective generations to avoid overwhelming the
      // gradient signal. Without this cap, high config.generations values
      // create excessive bias inertia that slows convergence.
      const effectiveGenerations = Math.min(
        config.generations,
        ns.count * 2,
      );
      const totalBias = ns.totalAdjustedBias +
        (neuron.bias * effectiveGenerations);
      const samples = ns.count + effectiveGenerations;

      const adjustedBias = totalBias / samples;

      return limitBias(adjustedBias, neuron.bias, config);
    }

    return neuron.bias;
  }
}

export function limitBias(
  targetBias: number,
  currentBias: number,
  config: BackPropagationConfig,
) {
  if (!Number.isFinite(targetBias)) {
    throw new ValidationError(
      `Bias must be a finite number, got ${targetBias}`,
      "OTHER",
    );
  }

  if (Math.abs(targetBias) < config.plankConstant) {
    return applyBiasRegularisation(0, config);
  }

  if (Math.abs(targetBias - currentBias) < 0.000_000_001) {
    return applyBiasRegularisation(currentBias, config);
  }

  const difference = config.learningRate * (targetBias - currentBias);
  const learntBias = currentBias + difference;
  let limitedBias = learntBias;
  if (Math.abs(difference) > config.maximumBiasAdjustmentScale) {
    limitedBias = currentBias +
      config.maximumBiasAdjustmentScale * Math.sign(difference);
  }

  if (Math.abs(limitedBias) >= config.limitBiasScale) {
    if (limitedBias > 0) {
      if (limitedBias > currentBias) {
        limitedBias = Math.max(currentBias, config.limitBiasScale);
      }
    } else {
      if (limitedBias < currentBias) {
        limitedBias = Math.min(currentBias, config.limitBiasScale * -1);
      }
    }
  }

  return applyBiasRegularisation(limitedBias, config);
}

/**
 * Issue #1859: Apply L1/L2 bias regularisation (bias decay).
 *
 * L2 shrinks biases proportionally to their magnitude: b *= (1 - lr * λ₂)
 * L1 applies soft-thresholding to drive small biases to zero:
 *   b -= lr * λ₁ * sign(b), snapping to zero if the penalty exceeds |b|.
 */
function applyBiasRegularisation(
  bias: number,
  config: BackPropagationConfig,
): number {
  let result = bias;

  // L2 regularisation (bias decay)
  if (config.l2BiasDecay > 0) {
    result *= 1 - config.learningRate * config.l2BiasDecay;
  }

  // L1 regularisation (sparsity via soft-thresholding)
  if (config.l1BiasDecay > 0 && result !== 0) {
    const l1Penalty = config.learningRate * config.l1BiasDecay;
    if (l1Penalty >= Math.abs(result)) {
      result = 0;
    } else {
      result -= l1Penalty * Math.sign(result);
    }
  }

  return result;
}

/**
 * Issue #1760 - Generic batch bias accumulation parameterised by batch size.
 * Issue #1214 - Batch bias accumulation for N neurons simultaneously.
 * Issue #1314 - Non-finite values are skipped to prevent state corruption.
 *
 * Processes `batchSize` neurons in a single call, enabling SIMD optimisation
 * via V8 when processing mini-batches during backpropagation.
 *
 * @param nsArray Array of NeuronState objects to accumulate into
 * @param targetPreActivationValues Array of target pre-activation values
 * @param preActivationValues Array of current pre-activation values
 * @param currentBiases Array of current neuron biases
 * @param _config Backpropagation configuration
 * @param batchSize Number of neurons to process
 */
export function accumulateBiasBatchNWay(
  nsArray: NeuronState[],
  targetPreActivationValues: number[],
  preActivationValues: number[],
  currentBiases: number[],
  _config: BackPropagationConfig,
  batchSize: number,
) {
  for (let i = 0; i < batchSize; i++) {
    const targetPreActivation = targetPreActivationValues[i];
    const preActivation = preActivationValues[i];
    const currentBias = currentBiases[i];

    if (
      !Number.isFinite(targetPreActivation) ||
      !Number.isFinite(preActivation) ||
      !Number.isFinite(currentBias)
    ) {
      continue;
    }

    const biasDelta = targetPreActivation - preActivation;
    if (!Number.isFinite(biasDelta)) {
      continue;
    }

    const targetBias = currentBias + biasDelta;
    if (!Number.isFinite(targetBias)) {
      continue;
    }

    const ns = nsArray[i];
    ns.count++;
    ns.totalBias += targetBias;
    // Issue #1653: Accumulate raw target bias; limitBias applied in calculateBias.
    ns.totalAdjustedBias += targetBias;
  }
}

/**
 * Issue #1214 - Batch bias accumulation for 4 neurons simultaneously.
 * Delegates to the generic accumulateBiasBatchNWay (issue #1760).
 */
export function accumulateBiasBatch4Way(
  nsArray: NeuronState[],
  targetPreActivationValues: number[],
  preActivationValues: number[],
  currentBiases: number[],
  config: BackPropagationConfig,
) {
  accumulateBiasBatchNWay(
    nsArray,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
    4,
  );
}

/**
 * Issue #1214 - Batch bias accumulation for 8 neurons simultaneously.
 * Delegates to the generic accumulateBiasBatchNWay (issue #1760).
 */
export function accumulateBiasBatch8Way(
  nsArray: NeuronState[],
  targetPreActivationValues: number[],
  preActivationValues: number[],
  currentBiases: number[],
  config: BackPropagationConfig,
) {
  accumulateBiasBatchNWay(
    nsArray,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
    8,
  );
}
