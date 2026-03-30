/**
 * Issue #1522 - Persistent Training State in WASM Linear Memory
 *
 * TypeScript wrapper for the Rust persistent training state functions.
 * Keeps synapse and neuron training state (accumulators, counts) in WASM
 * linear memory across backpropagation iterations, eliminating per-iteration
 * JS↔WASM marshalling overhead.
 *
 * ## Usage
 *
 * ```ts
 * // At epoch start
 * initTrainingState(numSynapses, numNeurons);
 *
 * // During training iterations — state stays in WASM
 * wasmAccumulateWeightPersistent4Way(startIndex, weights, targets, acts, config);
 * wasmAccumulateBiasPersistent4Way(startIndex, targetPre, pre, biases, config);
 *
 * // At epoch end — read results in bulk
 * const synapseState = readSynapseState(index);
 * const neuronState = readNeuronState(index);
 *
 * // Between epochs
 * resetTrainingState();
 *
 * // When training is complete
 * freeTrainingState();
 * ```
 */

import type { BackPropagationConfig } from "@propagate/BackPropagation.ts";
import type { NeuronState } from "@architecture/CreatureState.ts";
import type { SynapseState } from "@propagate/SynapseState.ts";
import {
  getAccumulateBiasPersistent4WayFn,
  getAccumulateBiasPersistent8WayFn,
  getAccumulateWeightPersistent4WayFn,
  getAccumulateWeightPersistent8WayFn,
  getFreeTrainingStateFn,
  getInitTrainingStateFn,
  getReadAllNeuronStateFn,
  getReadAllSynapseStateFn,
  getReadNeuronStateFn,
  getReadSynapseStateFn,
  getResetTrainingStateFn,
} from "./WasmModuleLoader.ts";

// Pre-allocated reusable buffers to avoid per-call Float64Array allocations.
const _pBuf4a = new Float64Array(4);
const _pBuf4b = new Float64Array(4);
const _pBuf4c = new Float64Array(4);
const _pBuf8a = new Float64Array(8);
const _pBuf8b = new Float64Array(8);
const _pBuf8c = new Float64Array(8);

/** Number of f64 fields per synapse in the persistent state. */
const SYNAPSE_FIELDS = 7;

/** Number of f64 fields per neuron in the persistent state. */
const NEURON_FIELDS = 3;

/** Fill a pre-allocated Float64Array from a JS array. */
function fillBuffer(buf: Float64Array, src: number[]): Float64Array {
  for (let i = 0; i < buf.length; i++) {
    buf[i] = src[i];
  }
  return buf;
}

/**
 * Initialise persistent training state for an epoch.
 *
 * Allocates and zeroes synapse/neuron state arrays in WASM linear memory.
 * Returns true if WASM was used, false if unavailable.
 */
export function initTrainingState(
  numSynapses: number,
  numNeurons: number,
): boolean {
  const fn = getInitTrainingStateFn();
  if (!fn) return false;
  fn(numSynapses, numNeurons);
  return true;
}

/**
 * Reset all training state to zero without deallocating.
 *
 * More efficient than `initTrainingState` when the network size
 * hasn't changed — avoids reallocation.
 */
export function resetTrainingState(): boolean {
  const fn = getResetTrainingStateFn();
  if (!fn) return false;
  fn();
  return true;
}

/**
 * Free all training state memory.
 *
 * Call this when training is complete to release WASM linear memory.
 */
export function freeTrainingState(): boolean {
  const fn = getFreeTrainingStateFn();
  if (!fn) return false;
  fn();
  return true;
}

/**
 * Read persistent state for a single synapse.
 *
 * Returns a packed Float64Array with 7 values:
 *   [count, totalPositiveActivation, totalNegativeActivation,
 *    countPositiveActivations, countNegativeActivations,
 *    totalPositiveAdjustedValue, totalNegativeAdjustedValue]
 *
 * Returns undefined if WASM is unavailable.
 */
export function readSynapseState(
  index: number,
): Float64Array | undefined {
  const fn = getReadSynapseStateFn();
  if (!fn) return undefined;
  return fn(index);
}

/**
 * Read persistent state for a single neuron.
 *
 * Returns a packed Float64Array with 3 values:
 *   [count, totalBias, totalAdjustedBias]
 *
 * Returns undefined if WASM is unavailable.
 */
export function readNeuronState(
  index: number,
): Float64Array | undefined {
  const fn = getReadNeuronStateFn();
  if (!fn) return undefined;
  return fn(index);
}

/**
 * Read all synapse state as a bulk Float64Array.
 *
 * Returns the entire synapse state buffer (numSynapses × 7 values).
 * More efficient than calling `readSynapseState` per synapse.
 */
export function readAllSynapseState(): Float64Array | undefined {
  const fn = getReadAllSynapseStateFn();
  if (!fn) return undefined;
  return fn();
}

/**
 * Read all neuron state as a bulk Float64Array.
 *
 * Returns the entire neuron state buffer (numNeurons × 3 values).
 * More efficient than calling `readNeuronState` per neuron.
 */
export function readAllNeuronState(): Float64Array | undefined {
  const fn = getReadAllNeuronStateFn();
  if (!fn) return undefined;
  return fn();
}

/**
 * Accumulate weight adjustments for 4 synapses into persistent WASM state.
 *
 * Results are accumulated directly into the persistent state buffer rather
 * than being returned to JavaScript. Returns true if WASM was used.
 */
export function wasmAccumulateWeightPersistent4Way(
  startIndex: number,
  currentWeights: number[],
  targetValues: number[],
  activations: number[],
  config: BackPropagationConfig,
): boolean {
  const fn = getAccumulateWeightPersistent4WayFn();
  if (!fn) return false;

  fn(
    startIndex,
    fillBuffer(_pBuf4a, currentWeights),
    fillBuffer(_pBuf4b, targetValues),
    fillBuffer(_pBuf4c, activations),
    config.plankConstant,
    config.learningRate,
    config.maximumWeightAdjustmentScale,
    config.limitWeightScale,
  );

  return true;
}

/**
 * Accumulate weight adjustments for 8 synapses into persistent WASM state.
 */
export function wasmAccumulateWeightPersistent8Way(
  startIndex: number,
  currentWeights: number[],
  targetValues: number[],
  activations: number[],
  config: BackPropagationConfig,
): boolean {
  const fn = getAccumulateWeightPersistent8WayFn();
  if (!fn) return false;

  fn(
    startIndex,
    fillBuffer(_pBuf8a, currentWeights),
    fillBuffer(_pBuf8b, targetValues),
    fillBuffer(_pBuf8c, activations),
    config.plankConstant,
    config.learningRate,
    config.maximumWeightAdjustmentScale,
    config.limitWeightScale,
  );

  return true;
}

/**
 * Accumulate bias adjustments for 4 neurons into persistent WASM state.
 */
export function wasmAccumulateBiasPersistent4Way(
  startIndex: number,
  targetPreActivationValues: number[],
  preActivationValues: number[],
  currentBiases: number[],
  config: BackPropagationConfig,
): boolean {
  const fn = getAccumulateBiasPersistent4WayFn();
  if (!fn) return false;

  fn(
    startIndex,
    fillBuffer(_pBuf4a, targetPreActivationValues),
    fillBuffer(_pBuf4b, preActivationValues),
    fillBuffer(_pBuf4c, currentBiases),
    config.plankConstant,
    config.learningRate,
    config.maximumBiasAdjustmentScale,
    config.limitBiasScale,
  );

  return true;
}

/**
 * Accumulate bias adjustments for 8 neurons into persistent WASM state.
 */
export function wasmAccumulateBiasPersistent8Way(
  startIndex: number,
  targetPreActivationValues: number[],
  preActivationValues: number[],
  currentBiases: number[],
  config: BackPropagationConfig,
): boolean {
  const fn = getAccumulateBiasPersistent8WayFn();
  if (!fn) return false;

  fn(
    startIndex,
    fillBuffer(_pBuf8a, targetPreActivationValues),
    fillBuffer(_pBuf8b, preActivationValues),
    fillBuffer(_pBuf8c, currentBiases),
    config.plankConstant,
    config.learningRate,
    config.maximumBiasAdjustmentScale,
    config.limitBiasScale,
  );

  return true;
}

/**
 * Unpack persistent synapse state into a SynapseState object.
 *
 * Reads the persistent state for synapse at `index` and adds the
 * accumulated values to the provided SynapseState.
 */
export function unpackSynapseState(
  index: number,
  cs: SynapseState,
): boolean {
  const data = readSynapseState(index);
  if (!data) return false;

  cs.count += data[0];
  cs.totalPositiveActivation += data[1];
  cs.totalNegativeActivation += data[2];
  cs.countPositiveActivations += data[3];
  cs.countNegativeActivations += data[4];
  cs.totalPositiveAdjustedValue += data[5];
  cs.totalNegativeAdjustedValue += data[6];

  return true;
}

/**
 * Unpack persistent neuron state into a NeuronState object.
 *
 * Reads the persistent state for neuron at `index` and adds the
 * accumulated values to the provided NeuronState.
 */
export function unpackNeuronState(
  index: number,
  ns: NeuronState,
): boolean {
  const data = readNeuronState(index);
  if (!data) return false;

  ns.count += data[0];
  ns.totalBias += data[1];
  ns.totalAdjustedBias += data[2];

  return true;
}

/**
 * Bulk unpack all persistent synapse state into SynapseState objects.
 *
 * More efficient than calling `unpackSynapseState` per synapse — uses
 * a single WASM boundary crossing to read all state at once.
 */
export function bulkUnpackSynapseState(
  states: Map<number, SynapseState> | SynapseState[],
  numSynapses: number,
): boolean {
  const allData = readAllSynapseState();
  if (!allData) return false;

  if (Array.isArray(states)) {
    for (let i = 0; i < numSynapses && i < states.length; i++) {
      const base = i * SYNAPSE_FIELDS;
      const cs = states[i];
      cs.count += allData[base];
      cs.totalPositiveActivation += allData[base + 1];
      cs.totalNegativeActivation += allData[base + 2];
      cs.countPositiveActivations += allData[base + 3];
      cs.countNegativeActivations += allData[base + 4];
      cs.totalPositiveAdjustedValue += allData[base + 5];
      cs.totalNegativeAdjustedValue += allData[base + 6];
    }
  }

  return true;
}

/**
 * Bulk unpack all persistent neuron state into NeuronState objects.
 */
export function bulkUnpackNeuronState(
  states: NeuronState[],
  numNeurons: number,
): boolean {
  const allData = readAllNeuronState();
  if (!allData) return false;

  for (let i = 0; i < numNeurons && i < states.length; i++) {
    const base = i * NEURON_FIELDS;
    const ns = states[i];
    ns.count += allData[base];
    ns.totalBias += allData[base + 1];
    ns.totalAdjustedBias += allData[base + 2];
  }

  return true;
}
