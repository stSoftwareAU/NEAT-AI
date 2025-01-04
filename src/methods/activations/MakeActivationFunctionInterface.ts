import type { Neuron } from "../../architecture/Neuron.ts";
import type { FuncationCache } from "./FunctionCache.ts";
import type { NeuronActivationInterface } from "./NeuronActivationInterface.ts";

export type ActivationFunction = () => {
  activation: number;
  value: number;
};

export interface MakeActivationFunctionInterface
  extends NeuronActivationInterface {
  makeActivationFunction(
    neuron: Neuron,
    cache: FuncationCache,
  ): ActivationFunction;
}
