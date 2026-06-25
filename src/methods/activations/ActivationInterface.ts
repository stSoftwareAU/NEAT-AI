/**
 * @module
 *
 * Contract every standard activation function implements: the `squash(x)`
 * forward pass mapping a neuron's pre-activation value to its output. Extends
 * `AbstractActivationInterface` (naming, error, and range behaviour) and is the
 * base an integrator implements to add a new activation to the registry.
 */

import type { AbstractActivationInterface } from "@methods/activations/AbstractActivationInterface.ts";

interface SquashAndDeriveResult {
  activation: number;
  derivative: number;
}

export interface ActivationInterface extends AbstractActivationInterface {
  squash(x: number): number;
}
