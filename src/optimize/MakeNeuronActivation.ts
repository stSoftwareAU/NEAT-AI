import type { Neuron } from "../architecture/Neuron.ts";
import type { Synapse } from "../architecture/Synapse.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import { ReLU } from "../methods/activations/types/ReLU.ts";
import type { InlineActivationInterface } from "./InlineActivationInterface.ts";
import type { InlineSquashInterface } from "./InlineSquashInterface.ts";

export function makeSynapsesValue(synapse: Synapse, neurons: Neuron[]): string {
  const { from, weight } = synapse;
  const fromNeuron = neurons[from];
  if (fromNeuron.type === "constant") {
    // Match WASM behavior: constants and weights are f32 in the compiled format.
    // We pre-round here to avoid JS f64-only constants diverging for large values.
    const value = Math.fround((fromNeuron.bias ?? 0) * Math.fround(weight));
    return `${value}`;
  } else if (weight === 1) {
    return `a[${from}]`;
  } else if (weight === -1) {
    return `-a[${from}]`;
  } else {
    // Match WASM behavior: weights are f32, multiplications are f32.
    const w = Math.fround(weight);
    return `Math.fround(a[${from}]*${w})`;
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
    return `a[${neuron.index}] = squash["${neuron.squash}"](neurons[${neuron.index}]);\n`;
  }

  const inwardList = neuron.creature.inwardConnections(neuron.index);
  // IMPORTANT: JS uses f64 math by default; WASM uses f32.
  // For large creatures with large weights (as seen in GRQ), f32 accumulation
  // error can materially change activations and therefore scores.
  //
  // To keep JS and WASM activation behavior aligned (and enable safe removal of
  // redundant JS code), we intentionally emulate f32 accumulation using
  // Math.fround on each multiply/add step.
  //
  // This is primarily relevant when the JS path is forced (useJs=true) and in
  // parity tests.
  const neurons = neuron.creature.neurons;
  const inwardListClone = inwardList.slice(0).sort((a, b) => a.from - b.from);

  const biasF32 = Math.fround(neuron.bias ?? 0);
  const tmp = `t${neuron.index}`;

  let functionBody = `let ${tmp}=Math.fround(${biasF32});\n`;
  for (let i = 0, len = inwardListClone.length; i < len; i++) {
    const term = makeSynapsesValue(inwardListClone[i], neurons);
    functionBody += `${tmp}=Math.fround(${tmp}+${term});\n`;
  }

  if (neuron.squash === ReLU.NAME) {
    functionBody += `a[${neuron.index}]=${tmp}>0?${tmp}:0;\n`;
    return functionBody;
  }

  function isInlineSquashInterface(
    obj: object,
  ): obj is InlineSquashInterface {
    return "inlineSquash" in obj;
  }

  if (isInlineSquashInterface(squash)) {
    // inlineSquash assumes it receives the pre-squash value expression; we
    // provide our f32-accumulated temp variable for parity with WASM.
    functionBody += `a[${neuron.index}]= ${squash.inlineSquash(tmp)};\n`;
    return functionBody;
  }

  functionBody += `a[${neuron.index}]= squash["${neuron.squash}"](${tmp});\n`;
  return functionBody;
}
