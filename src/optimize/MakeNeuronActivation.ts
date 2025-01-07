import type { Neuron } from "../architecture/Neuron.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import type { InlineActivationInterface } from "./InlineActivationInterface.ts";

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
  let valueLine = `${neuron.bias}`;

  const inwardList = neuron.creature.inwardConnections(neuron.index);
  const inwardListClone = inwardList.slice(0).sort((a, b) => a.from - b.from);
  for (let i = 0, len = inwardListClone.length; i < len; i++) {
    const { from, weight } = inwardListClone[i];
    valueLine += `+ a[${from}]*${weight}`;
  }

  const functionBody = `a[${neuron.index}] = ${neuron.squash}(${valueLine});\n`;

  return functionBody;
}
