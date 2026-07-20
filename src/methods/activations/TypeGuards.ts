/**
 * Type guards for activation interface duck-typing.
 *
 * These replace unsafe `as unknown` casts when checking whether an activation
 * implements optional capabilities like `unSquash()` or `simplifyBias()`.
 *
 * @module
 */

import type { AbstractActivationInterface } from "@methods/activations/AbstractActivationInterface.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";
import type { UnSquashInterface } from "@methods/activations/UnSquashInterface.ts";
import type { SimplifyBiasInterface } from "@optimize/SimplifyBiasInterface.ts";

/**
 * Check whether an activation exposes a scalar `squash(x)` method.
 *
 * Aggregate activations (`MAXIMUM`, `MINIMUM`, `IF`) operate over a whole
 * neuron via `activate(neuron)` and do NOT implement `squash(x)`, so they are
 * excluded by this guard. Callers use it to avoid the unchecked cast that threw
 * `squash is not a function` on aggregate-squash neurons (Issue #3419).
 */
export function hasScalarSquash(
  activation: AbstractActivationInterface,
): activation is ActivationInterface {
  return typeof (activation as ActivationInterface).squash === "function";
}

/** Check whether an activation implements the `unSquash()` method. */
export function hasUnSquash(
  activation: AbstractActivationInterface,
): activation is AbstractActivationInterface & UnSquashInterface {
  return typeof (activation as unknown as UnSquashInterface).unSquash ===
    "function";
}

/** Check whether an activation implements the `simplifyBias()` method. */
export function hasSimplifyBias(
  activation: AbstractActivationInterface,
): activation is AbstractActivationInterface & SimplifyBiasInterface {
  return typeof (activation as unknown as SimplifyBiasInterface)
    .simplifyBias === "function";
}
