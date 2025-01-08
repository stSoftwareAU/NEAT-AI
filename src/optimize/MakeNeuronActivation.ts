import type { Neuron } from "../architecture/Neuron.ts";
import type { Synapse } from "../architecture/Synapse.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import type { InlineActivationInterface } from "./InlineActivationInterface.ts";
import type { InlineSquashInterface } from "./InlineSquashInterface.ts";

export function makeSynpasesValue(synapse: Synapse, neurons: Neuron[]): string {
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

export function inlineActivation(neuron: Neuron): string {
  if (neuron.type === "constant") {
    return `a[${neuron.index}]=${neuron.bias};\n`;
  }
  const squash = neuron.findSquash();

  if (isInlineActivationInterface(squash)) {
    return (squash as InlineActivationInterface).inlineActivation(neuron);
  }

  function isInlineActivationInterface(
    obj: object,
  ): obj is InlineActivationInterface {
    return "inlineActivation" in obj;
  }

  function isNeuronActivationInterface(
    obj: object,
  ): obj is NeuronActivationInterface {
    return "activate" in obj;
  }

  if (isNeuronActivationInterface(squash)) {
    return `a[${neuron.index}] = ${neuron.squash}(neurons[${neuron.index}]);\n`;
  }
  let valueLine = neuron.bias ? `${neuron.bias}` : "";

  const inwardList = neuron.creature.inwardConnections(neuron.index);
  const neurons = neuron.creature.neurons;
  const inwardListClone = inwardList.slice(0).sort((a, b) => a.from - b.from);
  for (let i = 0, len = inwardListClone.length; i < len; i++) {
    const value = makeSynpasesValue(inwardListClone[i], neurons);

    if (valueLine !== "") {
      valueLine += "+";
    }
    valueLine += value;
  }

  function isInlineSquashInterface(
    obj: object,
  ): obj is InlineSquashInterface {
    return "inlineSquash" in obj;
  }

  if (isInlineSquashInterface(squash)) {
    return `a[${neuron.index}]= ${squash.inlineSquash(valueLine)};\n`;
  }

  const functionBody = `a[${neuron.index}]= ${neuron.squash}(${valueLine});\n`;

  return functionBody;
}
