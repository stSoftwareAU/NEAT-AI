import type { Neuron } from "../../architecture/Neuron.ts";

type acticationFunction = (activations: Float32Array) => number;
export interface MakeActivationFunctionInterface {
  makeActivationFunction(
    neuron: Neuron,
    cache: Map<string, { function: acticationFunction; used: boolean }>,
  ): acticationFunction;
}
