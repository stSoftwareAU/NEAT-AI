/**
 * Type guards for activation interface duck-typing.
 *
 * These replace unsafe `as unknown` casts when checking whether an activation
 * implements optional capabilities like `unSquash()` or `simplifyBias()`.
 *
 * @module
 */

import type { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import type { UnSquashInterface } from "./UnSquashInterface.ts";
import type { SimplifyBiasInterface } from "../../optimize/SimplifyBiasInterface.ts";

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
