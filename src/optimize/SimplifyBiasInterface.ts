/**
 * Contract for activation functions that can simplify a neuron's bias.
 *
 * Implementers map a raw bias to an equivalent simplified value during a
 * simplification pass, letting `Simplify` fold the bias into the activation
 * without changing the neuron's output.
 *
 * @module
 */

export interface SimplifyBiasInterface {
  simplifyBias(bias: number): number;
}
