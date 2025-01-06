import type { Neuron } from "../architecture/Neuron.ts";
import type { FunctionCache } from "./FunctionCache.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";

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
