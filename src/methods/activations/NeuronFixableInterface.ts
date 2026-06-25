/**
 * @module
 *
 * Optional contract for activations that can repair a `Neuron` into a valid
 * state via `fix()` — e.g. clamping bias or pruning incompatible connections
 * after a mutation. Implemented only by activations that need post-mutation
 * fix-up; most activations do not.
 */

import type { AbstractActivationInterface } from "@methods/activations/AbstractActivationInterface.ts";
import type { Neuron } from "@architecture/Neuron.ts";

export interface NeuronFixableInterface extends AbstractActivationInterface {
  fix(node: Neuron): void;
}
