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

import { assert } from "@std/assert";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";
import type { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";
import {
  getSquashType,
  resolveWasmSquashName,
  wasmCalculateError,
  wasmSafeZoneAdjustment,
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
  assert(
    resolvedName !== undefined,
    `Squash function '${squashName}' must be defined in WASM`,
  );
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
  assert(
    resolvedName !== undefined,
    `Squash function '${squashName}' must be defined in WASM`,
  );
  const squashType = getSquashType(resolvedName);
  return wasmSafeZoneAdjustment(squashType, rawInput, error, weight);
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
  assert(
    resolvedName !== undefined,
    `Squash function '${squashName}' must be defined in WASM`,
  );
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
  assert(
    resolvedName !== undefined,
    `Squash function '${squashName}' must be defined in WASM`,
  );
  const squashType = getSquashType(resolvedName);
  return wasmSquash(squashType, value);
}
