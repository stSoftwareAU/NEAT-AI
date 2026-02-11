/**
 * WASM Activation Methods Integration
 *
 * Issue #1143 - WASM Migration Phase 11: Integrate WASM activation methods into backpropagation
 * Issue #1236 - Remove useJs parameter and JS activation fallback paths
 * Issue #1241 - Final cleanup: remove all WASM feature flags and env variables
 * Issue #1256 - Backend is an implementation detail. No env vars required for normal use.
 *
 * All activation methods delegate to WASM unconditionally. JS is only used for
 * StdInverse (which requires f64 precision to avoid kilounit rounding errors).
 * WASM must always be available and all squash functions must be defined in WASM.
 */

import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";
import type { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";
import {
  type FusedErrorDistributionResult,
  getSquashType,
  resolveWasmSquashName,
  wasmCalculateError,
  wasmFusedErrorDistribution,
  wasmSafeZoneAdjustment,
  wasmSafeZoneAdjustmentBatch,
  wasmSquash,
  wasmUnSquash,
} from "./mod.ts";

/**
 * Check if a squash function is supported by WASM.
 *
 * @param squashName - The name of the squash function
 * @returns true if the squash function is supported by WASM
 */
export function isWasmSquashSupported(squashName: string): boolean {
  return resolveWasmSquashName(squashName) !== undefined;
}

/**
 * Calculate the error in value-space for backpropagation.
 * Delegates to WASM unconditionally.
 *
 * @param squashName - The name of the squash function
 * @param currentActivation - The neuron's current output (after squash)
 * @param targetActivation - The desired output
 * @param currentValue - The pre-squash value (hint for unSquash)
 * @returns The calculated error value
 */
export function calculateError(
  squashName: string,
  currentActivation: number,
  targetActivation: number,
  currentValue: number,
): number {
  const resolvedName = resolveWasmSquashName(squashName);
  if (resolvedName === undefined) {
    throw new Error(
      `Squash function '${squashName}' is not defined in WASM. All squash functions must be implemented in Rust/WASM.`,
    );
  }
  const squashType = getSquashType(resolvedName);
  return wasmCalculateError(
    squashType,
    currentActivation,
    targetActivation,
    currentValue,
  );
}

/**
 * Get the safe zone adjustment factor for backpropagation.
 * Delegates to WASM unconditionally.
 *
 * @param squashName - The name of the squash function
 * @param rawInput - The raw input value before squashing
 * @param error - The error value from backpropagation
 * @param weight - An optional synapse weight (defaults to 1.0)
 * @returns A value between 0 and 1 indicating backpropagation safety
 */
export function safeZoneAdjustment(
  squashName: string,
  rawInput: number,
  error: number,
  weight?: number,
): number {
  const resolvedName = resolveWasmSquashName(squashName);
  if (resolvedName === undefined) {
    throw new Error(
      `Squash function '${squashName}' is not defined in WASM. All squash functions must be implemented in Rust/WASM.`,
    );
  }
  const squashType = getSquashType(resolvedName);
  return wasmSafeZoneAdjustment(squashType, rawInput, error, weight);
}

/**
 * Issue #1376 - Batch safe zone adjustment for backward pass inner loop.
 *
 * Processes multiple safe zone adjustments in a single WASM call, eliminating
 * per-synapse boundary crossing overhead. Replaces S individual WASM calls with 1.
 *
 * @param squashTypes - Uint8Array of SquashType enum values (pre-resolved)
 * @param rawInputs - Float32Array of pre-squash values for upstream neurons
 * @param error - The provisional error per link (same for all synapses)
 * @param weights - Float32Array of synapse weights
 * @returns Float32Array of safe zone factors (0.0 to 1.0)
 */
export function safeZoneAdjustmentBatch(
  squashTypes: Uint8Array,
  rawInputs: Float32Array,
  error: number,
  weights: Float32Array,
): Float32Array {
  return wasmSafeZoneAdjustmentBatch(squashTypes, rawInputs, error, weights);
}

/**
 * Convert activation value back to pre-squash value.
 * Delegates to WASM unconditionally (except StdInverse which requires f64 precision).
 *
 * @param squashName - The name of the squash function
 * @param activation - The squashed activation value to invert
 * @param hint - An optional hint value to guide the inverse
 * @returns The unsquashed value
 */
export function unSquash(
  squashName: string,
  activation: number,
  hint?: number,
): number {
  // StdInverse can easily produce values around ±1e12 for tiny activations.
  // Returning those via f32 (WASM) introduces ~kilounit rounding error at that scale,
  // which breaks backprop roundtrip invariants (see test/propagate/ToValue.ts).
  // Use the JS implementation (f64) for correctness.
  if (squashName === "StdInverse") {
    const sq = Activations.find(squashName) as unknown as UnSquashInterface;
    if (sq.unSquash) {
      return sq.unSquash(activation, hint);
    }
    return activation;
  }

  const resolvedName = resolveWasmSquashName(squashName);
  if (resolvedName === undefined) {
    throw new Error(
      `Squash function '${squashName}' is not defined in WASM. All squash functions must be implemented in Rust/WASM.`,
    );
  }
  const squashType = getSquashType(resolvedName);
  return wasmUnSquash(squashType, activation, hint);
}

/**
 * Apply squash function to a value.
 * Delegates to WASM unconditionally (except StdInverse which requires f64 precision).
 *
 * @param squashName - The name of the squash function
 * @param value - The value to squash
 * @returns The squashed activation value
 */
export function squash(
  squashName: string,
  value: number,
): number {
  // See note in unSquash(): keep StdInverse in JS for f64 precision.
  if (squashName === "StdInverse") {
    const squashFn = Activations.find(squashName) as ActivationInterface;
    return squashFn.squash(value);
  }

  const resolvedName = resolveWasmSquashName(squashName);
  if (resolvedName === undefined) {
    throw new Error(
      `Squash function '${squashName}' is not defined in WASM. All squash functions must be implemented in Rust/WASM.`,
    );
  }
  const squashType = getSquashType(resolvedName);
  return wasmSquash(squashType, value);
}

/**
 * Issue #1377 - Fused backward pass error distribution.
 *
 * Combines calculateError + safeZoneAdjustment + elastic error distribution
 * into a single WASM call, eliminating S+1 boundary crossings per neuron.
 * All intermediate values stay in WASM linear memory.
 *
 * @param neuronSquashType - The SquashType number for the neuron
 * @param neuronActivation - The neuron's current output (after squash)
 * @param neuronTargetActivation - The desired output for this neuron
 * @param neuronHintValue - The pre-squash value for this neuron
 * @param upstreamSquashTypes - Uint8Array of upstream neuron squash type enums
 * @param upstreamHintValues - Float32Array of upstream pre-squash values
 * @param upstreamActivations - Float32Array of upstream neuron activations
 * @param synapseWeights - Float32Array of inbound synapse weights
 * @returns FusedErrorDistributionResult with error, safeZoneFactors, and perLinkError
 */
export function fusedErrorDistribution(
  neuronSquashType: number,
  neuronActivation: number,
  neuronTargetActivation: number,
  neuronHintValue: number,
  upstreamSquashTypes: Uint8Array,
  upstreamHintValues: Float32Array,
  upstreamActivations: Float32Array,
  synapseWeights: Float32Array,
): FusedErrorDistributionResult {
  return wasmFusedErrorDistribution(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );
}
