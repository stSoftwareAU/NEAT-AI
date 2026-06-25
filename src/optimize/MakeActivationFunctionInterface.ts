/**
 * Contract for building compiled activation functions for a neuron.
 *
 * Defines the `ActivationFunction` shape returned at runtime and the
 * `makeActivationFunction` factory that, given a neuron and a {@link FunctionCache},
 * produces (or reuses) the compiled closure that computes that neuron's
 * activation and value.
 *
 * @module
 */

import type { Neuron } from "@architecture/Neuron.ts";
import type { FunctionCache } from "@optimize/FunctionCache.ts";
import type { NeuronActivationInterface } from "@methods/activations/NeuronActivationInterface.ts";

export type ActivationFunction = () => {
  activation: number;
  value: number;
};

export interface MakeActivationFunctionInterface
  extends NeuronActivationInterface {
  makeActivationFunction(
    neuron: Neuron,
    cache: FunctionCache,
  ): ActivationFunction;
}
