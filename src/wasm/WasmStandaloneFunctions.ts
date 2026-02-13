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
import {
  getCalculateErrorFn,
  getDerivativeFn,
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
