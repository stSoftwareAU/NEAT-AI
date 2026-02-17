/**
 * WASM Standalone Functions
 *
 * Issue #1405 - Extracted from WasmActivation.ts as part of facade refactoring.
 *
 * Provides standalone WASM function wrappers for squash, derivative, unSquash,
 * safe zone adjustment, calculate error, fused error distribution, range
 * operations, and version queries. Each function delegates to the corresponding
 * WASM function pointer obtained via WasmModuleLoader.
 */

import { WasmError } from "../errors/WasmError.ts";
import type { BackPropagationConfig } from "../propagate/BackPropagation.ts";
import type { NeuronState } from "../architecture/CreatureState.ts";
import type { SynapseState } from "../propagate/SynapseState.ts";
import {
  getAccumulateBiasBatch4WayFn,
  getAccumulateBiasBatch8WayFn,
  getAccumulateWeightBatch4WayFn,
  getAccumulateWeightBatch8WayFn,
  getCalculateBiasWasmFn,
  getCalculateErrorFn,
  getCalculateWeightWasmFn,
  getDerivativeFn,
  getDistributeElasticErrorFn,
  getFusedErrorDistributionFn,
  getGetRangeFn,
  getLimitRangeFn,
  getSafeZoneAdjustmentBatchFn,
  getSafeZoneAdjustmentFn,
  getSquashFn,
  getUnsquashFn,
  getValidateRangeFn,
  getVersionFn,
} from "./WasmModuleLoader.ts";

/**
 * Issue #1377 - Result from fused backward pass error distribution.
 */
export interface FusedErrorDistributionResult {
  /** The calculated error in value-space */
  error: number;
  /** Safe zone factors (0-1) for each synapse */
  safeZoneFactors: Float32Array;
  /** Per-link error shares (sum equals error) */
  perLinkError: Float32Array;
}

/**
 * Range information for an activation function.
 * Issue #1142 - WASM Migration Phase 10: Implement range validation in Rust/WASM
 */
export interface WasmActivationRange {
  low: number;
  high: number;
}

/**
 * Standalone squash function test (for verification)
 */
export function wasmSquash(squashType: number, value: number): number {
  const fn = getSquashFn();
  if (!fn) {
    throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
  }
  return fn(squashType, value);
}

/**
 * Standalone derivative function
 * Issue #1138 - WASM Migration Phase 6: Implement derivative() in Rust/WASM
 */
export function wasmDerivative(squashType: number, value: number): number {
  const fn = getDerivativeFn();
  if (!fn) {
    throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
  }
  return fn(squashType, value);
}

/**
 * Standalone unsquash function
 * Issue #1139 - WASM Migration Phase 7: Implement unSquash() in Rust/WASM
 */
export function wasmUnSquash(
  squashType: number,
  activation: number,
  hint?: number,
): number {
  const fn = getUnsquashFn();
  if (!fn) {
    throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
  }
  return fn(squashType, activation, hint ?? Number.NaN);
}

/**
 * Standalone safe zone adjustment function
 * Issue #1140 - WASM Migration Phase 8: Implement safeZoneAdjustment() in Rust/WASM
 */
export function wasmSafeZoneAdjustment(
  squashType: number,
  rawInput: number,
  error: number,
  weight?: number,
): number {
  const fn = getSafeZoneAdjustmentFn();
  if (!fn) {
    throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
  }
  return fn(squashType, rawInput, error, weight ?? Number.NaN);
}

/**
 * Issue #1376 - Batch safe zone adjustment to eliminate per-synapse WASM boundary crossings.
 */
export function wasmSafeZoneAdjustmentBatch(
  squashTypes: Uint8Array,
  rawInputs: Float32Array,
  error: number,
  weights: Float32Array,
): Float32Array {
  const fn = getSafeZoneAdjustmentBatchFn();
  if (!fn) {
    throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
  }
  return fn(squashTypes, rawInputs, error, weights);
}

/**
 * Standalone calculate error function
 * Issue #1141 - WASM Migration Phase 9: Implement calculateError() in Rust/WASM
 */
export function wasmCalculateError(
  squashType: number,
  currentActivation: number,
  targetActivation: number,
  currentValue: number,
): number {
  const fn = getCalculateErrorFn();
  if (!fn) {
    throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
  }
  return fn(squashType, currentActivation, targetActivation, currentValue);
}

/**
 * Issue #1377 - Fused backward pass error distribution.
 */
export function wasmFusedErrorDistribution(
  neuronSquashType: number,
  neuronActivation: number,
  neuronTargetActivation: number,
  neuronHintValue: number,
  upstreamSquashTypes: Uint8Array,
  upstreamHintValues: Float32Array,
  upstreamActivations: Float32Array,
  synapseWeights: Float32Array,
): FusedErrorDistributionResult {
  const fn = getFusedErrorDistributionFn();
  if (!fn) {
    throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
  }
  const flat = fn(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );

  const count = upstreamSquashTypes.length;
  const error = flat[0];
  const safeZoneFactors = flat.subarray(1, 1 + count);
  const perLinkError = flat.subarray(1 + count, 1 + 2 * count);

  return { error, safeZoneFactors, perLinkError };
}

/**
 * Issue #1519 - Standalone WASM elastic error distribution.
 *
 * Distributes `error` across links proportional to activation² × safeZoneFactor,
 * with weight-based fallback when activations are near zero, and equal split
 * as a last resort.
 *
 * Returns the error shares as a Float32Array, or undefined if WASM is unavailable.
 */
export function wasmDistributeElasticError(
  error: number,
  activations: Float32Array,
  safeZoneFactors: Float32Array,
  weights: Float32Array,
  plankConstant: number,
): Float32Array | undefined {
  const fn = getDistributeElasticErrorFn();
  if (!fn) return undefined;
  return fn(error, activations, safeZoneFactors, weights, plankConstant);
}

/**
 * Get the valid output range for an activation function.
 */
export function wasmGetRange(squashType: number): WasmActivationRange {
  const fn = getGetRangeFn();
  if (!fn) {
    throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
  }
  const arr = fn(squashType);
  return { low: arr[0], high: arr[1] };
}

/**
 * Validate that an activation value is within the valid range.
 */
export function wasmValidateRange(
  squashType: number,
  activation: number,
): boolean {
  const fn = getValidateRangeFn();
  if (!fn) {
    throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
  }
  return fn(squashType, activation);
}

/**
 * Clamp a value to the valid range for an activation function.
 */
export function wasmLimitRange(squashType: number, value: number): number {
  const fn = getLimitRangeFn();
  if (!fn) {
    throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
  }
  return fn(squashType, value);
}

/**
 * Get WASM module version
 */
export function wasmVersion(): string {
  const fn = getVersionFn();
  if (!fn) {
    return "not loaded";
  }
  return fn();
}

// ---------------------------------------------------------------------------
// Issue #1518 - WASM batch weight/bias accumulation
// ---------------------------------------------------------------------------

// Pre-allocated reusable buffers to avoid per-call Float64Array allocations.
// Three buffers per size (one per argument slot).
const _buf4a = new Float64Array(4);
const _buf4b = new Float64Array(4);
const _buf4c = new Float64Array(4);
const _buf8a = new Float64Array(8);
const _buf8b = new Float64Array(8);
const _buf8c = new Float64Array(8);

/** Fill a pre-allocated Float64Array from a JS array. */
function fillBuffer(buf: Float64Array, src: number[]): Float64Array {
  for (let i = 0; i < buf.length; i++) {
    buf[i] = src[i];
  }
  return buf;
}

/**
 * Issue #1518 - Batch weight accumulation for 4 synapses via WASM.
 *
 * Processes 4 synapses in a single WASM call and unpacks the results
 * into the provided SynapseState objects. Returns true if WASM was used,
 * false if WASM is unavailable (caller should fall back to TS).
 */
export function wasmAccumulateWeightBatch4Way(
  currentWeights: number[],
  csArray: SynapseState[],
  targetValues: number[],
  activations: number[],
  config: BackPropagationConfig,
): boolean {
  const fn = getAccumulateWeightBatch4WayFn();
  if (!fn) return false;

  const result = fn(
    fillBuffer(_buf4a, currentWeights),
    fillBuffer(_buf4b, targetValues),
    fillBuffer(_buf4c, activations),
    config.plankConstant,
    config.learningRate,
    config.maximumWeightAdjustmentScale,
    config.limitWeightScale,
  );

  // Unpack 7 values per synapse into the SynapseState objects
  for (let i = 0; i < 4; i++) {
    const base = i * 7;
    const count = result[base];
    if (count > 0) {
      const cs = csArray[i];
      cs.count += count;
      cs.totalPositiveActivation += result[base + 1];
      cs.totalNegativeActivation += result[base + 2];
      cs.countPositiveActivations += result[base + 3];
      cs.countNegativeActivations += result[base + 4];
      cs.totalPositiveAdjustedValue += result[base + 5];
      cs.totalNegativeAdjustedValue += result[base + 6];
    }
  }

  return true;
}

/**
 * Issue #1518 - Batch weight accumulation for 8 synapses via WASM.
 */
export function wasmAccumulateWeightBatch8Way(
  currentWeights: number[],
  csArray: SynapseState[],
  targetValues: number[],
  activations: number[],
  config: BackPropagationConfig,
): boolean {
  const fn = getAccumulateWeightBatch8WayFn();
  if (!fn) return false;

  const result = fn(
    fillBuffer(_buf8a, currentWeights),
    fillBuffer(_buf8b, targetValues),
    fillBuffer(_buf8c, activations),
    config.plankConstant,
    config.learningRate,
    config.maximumWeightAdjustmentScale,
    config.limitWeightScale,
  );

  for (let i = 0; i < 8; i++) {
    const base = i * 7;
    const count = result[base];
    if (count > 0) {
      const cs = csArray[i];
      cs.count += count;
      cs.totalPositiveActivation += result[base + 1];
      cs.totalNegativeActivation += result[base + 2];
      cs.countPositiveActivations += result[base + 3];
      cs.countNegativeActivations += result[base + 4];
      cs.totalPositiveAdjustedValue += result[base + 5];
      cs.totalNegativeAdjustedValue += result[base + 6];
    }
  }

  return true;
}

/**
 * Issue #1518 - Batch bias accumulation for 4 neurons via WASM.
 */
export function wasmAccumulateBiasBatch4Way(
  nsArray: NeuronState[],
  targetPreActivationValues: number[],
  preActivationValues: number[],
  currentBiases: number[],
  config: BackPropagationConfig,
): boolean {
  const fn = getAccumulateBiasBatch4WayFn();
  if (!fn) return false;

  const result = fn(
    fillBuffer(_buf4a, targetPreActivationValues),
    fillBuffer(_buf4b, preActivationValues),
    fillBuffer(_buf4c, currentBiases),
    config.plankConstant,
    config.learningRate,
    config.maximumBiasAdjustmentScale,
    config.limitBiasScale,
  );

  // Unpack 3 values per neuron into the NeuronState objects
  for (let i = 0; i < 4; i++) {
    const base = i * 3;
    const count = result[base];
    if (count > 0) {
      const ns = nsArray[i];
      ns.count++;
      ns.totalBias += result[base + 1];
      ns.totalAdjustedBias += result[base + 2];
    }
  }

  return true;
}

/**
 * Issue #1518 - Batch bias accumulation for 8 neurons via WASM.
 */
export function wasmAccumulateBiasBatch8Way(
  nsArray: NeuronState[],
  targetPreActivationValues: number[],
  preActivationValues: number[],
  currentBiases: number[],
  config: BackPropagationConfig,
): boolean {
  const fn = getAccumulateBiasBatch8WayFn();
  if (!fn) return false;

  const result = fn(
    fillBuffer(_buf8a, targetPreActivationValues),
    fillBuffer(_buf8b, preActivationValues),
    fillBuffer(_buf8c, currentBiases),
    config.plankConstant,
    config.learningRate,
    config.maximumBiasAdjustmentScale,
    config.limitBiasScale,
  );

  for (let i = 0; i < 8; i++) {
    const base = i * 3;
    const count = result[base];
    if (count > 0) {
      const ns = nsArray[i];
      ns.count++;
      ns.totalBias += result[base + 1];
      ns.totalAdjustedBias += result[base + 2];
    }
  }

  return true;
}

/**
 * Issue #1518 - Calculate finalised weight via WASM.
 *
 * Returns the calculated weight, or undefined if WASM is unavailable.
 */
export function wasmCalculateWeight(
  cs: SynapseState,
  currentWeight: number,
  config: BackPropagationConfig,
): number | undefined {
  const fn = getCalculateWeightWasmFn();
  if (!fn) return undefined;

  return fn(
    cs.count,
    cs.totalPositiveActivation,
    cs.totalNegativeActivation,
    cs.countPositiveActivations,
    cs.countNegativeActivations,
    cs.totalPositiveAdjustedValue,
    cs.totalNegativeAdjustedValue,
    currentWeight,
    config.generations,
    config.plankConstant,
    config.learningRate,
    config.maximumWeightAdjustmentScale,
    config.limitWeightScale,
  );
}

/**
 * Issue #1518 - Calculate finalised bias via WASM.
 *
 * Returns the calculated bias, or undefined if WASM is unavailable.
 */
export function wasmCalculateBias(
  count: number,
  totalAdjustedBias: number,
  currentBias: number,
  noChange: boolean,
  config: BackPropagationConfig,
): number | undefined {
  const fn = getCalculateBiasWasmFn();
  if (!fn) return undefined;

  return fn(
    count,
    totalAdjustedBias,
    currentBias,
    noChange,
    config.generations,
    config.plankConstant,
    config.learningRate,
    config.maximumBiasAdjustmentScale,
    config.limitBiasScale,
  );
}
