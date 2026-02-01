import type { Neuron } from "../architecture/Neuron.ts";
import type { Synapse } from "../architecture/Synapse.ts";

/**
 * Builds a string representation of a synapse's contribution for inline activation.
 * Used by aggregate activations (IF, MINIMUM, MAXIMUM) for their inlineActivation implementations.
 * Extracted from MakeNeuronActivation.ts (Issue #1238 - WASM migration).
 */
export function makeSynapsesValue(synapse: Synapse, neurons: Neuron[]): string {
  const { from, weight } = synapse;
  const fromNeuron = neurons[from];
  if (fromNeuron.type === "constant") {
    const value = fromNeuron.bias * weight;
    return `${value}`;
  } else if (weight === 1) {
    return `a[${from}]`;
  } else if (weight === -1) {
    return `-a[${from}]`;
  } else {
    return `a[${from}]*${weight}`;
  }
}
