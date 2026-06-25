/**
 * Contract for activation functions that can emit inline source code.
 *
 * Implementers return a JavaScript expression that computes a neuron's
 * activation in place, letting the optimiser splice the activation directly
 * into a generated function body rather than calling through an interface.
 *
 * @module
 */

import type { Neuron } from "@architecture/Neuron.ts";

export interface InlineActivationInterface {
  inlineActivation(neuron: Neuron): string;
}
