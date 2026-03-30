import type { NeuronState } from "@architecture/CreatureState.ts";
import type { Neuron } from "@architecture/Neuron.ts";
import { wasmCalculateBias } from "@wasm/WasmStandaloneFunctions.ts";
import type { BackPropagationConfig } from "@propagate/BackPropagation.ts";

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

/**
 * Issue #1953: Calculate the finalised bias via WASM exclusively.
 *
 * WASM is mandatory — no TypeScript fallback. Throws WasmError if the
 * WASM module is not loaded.
 */
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
      return wasmCalculateBias(
        ns.count,
        ns.totalAdjustedBias,
        neuron.bias,
        !!ns.noChange,
        config,
      );
    }

    return neuron.bias;
  }
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
