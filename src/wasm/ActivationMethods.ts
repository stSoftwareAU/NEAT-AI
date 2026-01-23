/**
 * WASM Activation Methods Integration
 *
 * Issue #1143 - WASM Migration Phase 11: Integrate WASM activation methods into backpropagation
 *
 * This module provides unified wrapper functions that can delegate to either JS or WASM
 * implementations of activation methods. The WASM methods are used when available unless
 * explicitly disabled via environment variable or the useJs flag.
 *
 * Usage:
 * - Set NEAT_AI_USE_WASM_BACKPROP=false to force JS backpropagation
 * - Default is to use WASM when available
 */

import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";
import type { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";
import {
  getSquashType,
  isWasmActivationAvailable,
  resolveWasmSquashName,
  wasmCalculateError,
  wasmSafeZoneAdjustment,
  wasmSquash,
  wasmUnSquash,
} from "./mod.ts";

/**
 * Global flag to control WASM backpropagation usage.
 * Can be disabled via NEAT_AI_USE_WASM_BACKPROP=false environment variable.
 */
let useWasmBackprop: boolean | null = null;

/**
 * Check if WASM backpropagation should be used.
 * This checks:
 * 1. The environment variable NEAT_AI_USE_WASM_BACKPROP (cached on first access)
 * 2. Whether WASM activation is available
 */
export function shouldUseWasmBackprop(): boolean {
  if (useWasmBackprop === null) {
    try {
      const envValue = Deno.env.get("NEAT_AI_USE_WASM_BACKPROP")?.trim()
        .toLowerCase();
      // Default to true unless explicitly set to "false", "0", "no", or "off"
      useWasmBackprop = envValue !== "false" && envValue !== "0" &&
        envValue !== "no" && envValue !== "off";
    } catch {
      // If we can't read the environment variable (permissions), default to true
      useWasmBackprop = true;
    }
  }
  return useWasmBackprop && isWasmActivationAvailable();
}

/**
 * Reset the cached WASM backprop flag.
 * Useful for testing when environment variables change.
 */
export function resetWasmBackpropFlag(): void {
  useWasmBackprop = null;
}

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
 * Delegates to WASM when available and supported.
 *
 * @param squashName - The name of the squash function
 * @param currentActivation - The neuron's current output (after squash)
 * @param targetActivation - The desired output
 * @param currentValue - The pre-squash value (hint for unSquash)
 * @param useJs - Force JavaScript implementation
 * @returns The calculated error value
 */
export function calculateError(
  squashName: string,
  currentActivation: number,
  targetActivation: number,
  currentValue: number,
  useJs = false,
): number {
  // Try WASM if available and not forced to use JS
  if (!useJs && shouldUseWasmBackprop()) {
    const resolvedName = resolveWasmSquashName(squashName);
    if (resolvedName !== undefined) {
      const squashType = getSquashType(resolvedName);
      return wasmCalculateError(
        squashType,
        currentActivation,
        targetActivation,
        currentValue,
      );
    }
  }

  // Fall back to JS implementation
  const squash = Activations.find(squashName) as ActivationInterface;
  if (squash.calculateError) {
    return squash.calculateError(
      currentActivation,
      targetActivation,
      currentValue,
    );
  }

  // If no calculateError method exists, return a simple difference
  // This matches the fallback behaviour in Neuron.ts record()
  if (squash as unknown as UnSquashInterface) {
    const unSquash = squash as unknown as UnSquashInterface;
    if (unSquash.unSquash) {
      const targetValue = unSquash.unSquash(targetActivation, currentValue);
      return targetValue - currentValue;
    }
  }

  return targetActivation - currentActivation;
}

/**
 * Get the safe zone adjustment factor for backpropagation.
 * Delegates to WASM when available and supported.
 *
 * @param squashName - The name of the squash function
 * @param rawInput - The raw input value before squashing
 * @param error - The error value from backpropagation
 * @param weight - An optional synapse weight (defaults to 1.0)
 * @param useJs - Force JavaScript implementation
 * @returns A value between 0 and 1 indicating backpropagation safety
 */
export function safeZoneAdjustment(
  squashName: string,
  rawInput: number,
  error: number,
  weight?: number,
  useJs = false,
): number {
  // Try WASM if available and not forced to use JS
  if (!useJs && shouldUseWasmBackprop()) {
    const resolvedName = resolveWasmSquashName(squashName);
    if (resolvedName !== undefined) {
      const squashType = getSquashType(resolvedName);
      return wasmSafeZoneAdjustment(squashType, rawInput, error, weight);
    }
  }

  // Fall back to JS implementation
  const squash = Activations.find(squashName);
  if (squash.safeZoneAdjustment) {
    return squash.safeZoneAdjustment(rawInput, error, weight ?? 1);
  }

  // Default to fully safe if no safeZoneAdjustment method exists
  return 1;
}

/**
 * Convert activation value back to pre-squash value.
 * Delegates to WASM when available and supported.
 *
 * @param squashName - The name of the squash function
 * @param activation - The squashed activation value to invert
 * @param hint - An optional hint value to guide the inverse
 * @param useJs - Force JavaScript implementation
 * @returns The unsquashed value
 */
export function unSquash(
  squashName: string,
  activation: number,
  hint?: number,
  useJs = false,
): number {
  // StdInverse can easily produce values around ±1e12 for tiny activations.
  // Returning those via f32 (WASM) introduces ~kilounit rounding error at that scale,
  // which breaks backprop roundtrip invariants (see test/propagate/ToValue.ts).
  // Use the JS implementation (f64) for correctness.
  if (squashName === "StdInverse") {
    useJs = true;
  }

  // Try WASM if available and not forced to use JS
  if (!useJs && shouldUseWasmBackprop()) {
    const resolvedName = resolveWasmSquashName(squashName);
    if (resolvedName !== undefined) {
      const squashType = getSquashType(resolvedName);
      return wasmUnSquash(squashType, activation, hint);
    }
  }

  // Fall back to JS implementation
  const squash = Activations.find(squashName) as unknown as UnSquashInterface;
  if (squash.unSquash) {
    return squash.unSquash(activation, hint);
  }

  // If no unSquash method exists, return the activation as-is
  return activation;
}

/**
 * Apply squash function to a value.
 * Delegates to WASM when available and supported.
 *
 * @param squashName - The name of the squash function
 * @param value - The value to squash
 * @param useJs - Force JavaScript implementation
 * @returns The squashed activation value
 */
export function squash(
  squashName: string,
  value: number,
  useJs = false,
): number {
  // See note in unSquash(): keep StdInverse in JS for precision.
  if (squashName === "StdInverse") {
    useJs = true;
  }

  // Try WASM if available and not forced to use JS
  if (!useJs && shouldUseWasmBackprop()) {
    const resolvedName = resolveWasmSquashName(squashName);
    if (resolvedName !== undefined) {
      const squashType = getSquashType(resolvedName);
      return wasmSquash(squashType, value);
    }
  }

  // Fall back to JS implementation
  const squashFn = Activations.find(squashName) as ActivationInterface;
  return squashFn.squash(value);
}
