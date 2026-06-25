/**
 * @module
 *
 * Optional contract for the inverse of `squash`: `unSquash(activation, hint?)`
 * recovers a pre-activation value from an output, used by optimisation passes
 * that reason backwards through a neuron. Only activations with a tractable
 * inverse implement this; callers feature-detect it via the `TypeGuards`.
 */

import type { AbstractActivationInterface } from "@methods/activations/AbstractActivationInterface.ts";

export interface UnSquashInterface extends AbstractActivationInterface {
  unSquash(activation: number, hint?: number): number;
}
