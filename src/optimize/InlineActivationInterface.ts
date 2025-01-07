import type { Neuron } from "../architecture/Neuron.ts";

export interface InlineActivationInterface {
  inlineActivation(neuron: Neuron): string;
}
