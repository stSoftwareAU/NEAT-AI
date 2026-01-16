import type { Creature } from "../Creature.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import { ReLU } from "../methods/activations/types/ReLU.ts";
import type { InlineActivationInterface } from "./InlineActivationInterface.ts";
import type { InlineSquashInterface } from "./InlineSquashInterface.ts";
import { inlineActivation } from "./MakeNeuronActivation.ts";

/**
 * Squash function lookup table type.
 * Uses a single object lookup instead of individual function parameters
 * to reduce Function.bind() overhead (Issue #1017).
 *
 * The table can contain both standard squash functions (x: number) => number
 * and neuron activation functions (neuron: Neuron) => number.
 */
// deno-lint-ignore no-explicit-any
type SquashTable = Record<string, (...args: any[]) => number>;

export function makeCreatureActivationFunction(creature: Creature) {
  let functionBody = "const a = this.activations;\n";

  // Use a lookup table object instead of individual parameters (Issue #1017).
  // This reduces Function.bind() overhead and may improve V8 optimisation
  // for creatures with many non-inline squash functions.
  const squashTable: SquashTable = {};
  const squashList: string[] = [];

  for (let indx = creature.input; indx < creature.neurons.length; indx++) {
    const neuron = creature.neurons[indx];
    functionBody += inlineActivation(neuron);
    if (
      neuron.squash && !(neuron.squash in squashTable) &&
      neuron.squash !== ReLU.NAME
    ) {
      const sf = neuron.findSquash();
      const inlineSquash = (sf as unknown) as InlineSquashInterface;
      if (!inlineSquash.inlineSquash) {
        const inlineActivation = (sf as unknown) as InlineActivationInterface;
        if (!inlineActivation.inlineActivation) {
          const squashActivation = sf as ActivationInterface;

          if (squashActivation.squash) {
            const bound = squashActivation.squash.bind(squashActivation);
            squashTable[neuron.squash] = bound;
            squashList.push(neuron.squash);
          } else {
            const neuronActivation = sf as NeuronActivationInterface;
            const bound = neuronActivation.activate.bind(squashActivation);
            squashTable[neuron.squash] = bound;
            squashList.push(neuron.squash);
          }
        }
      }
    }
  }

  // Dynamically create the function with a single squash lookup table parameter
  // instead of many individual function parameters.
  try {
    const func = new Function(
      "neurons",
      "squash",
      functionBody,
    );

    const bondedFunction = func.bind(
      creature.state,
      creature.neurons,
      squashTable,
    ) as () => undefined;

    return {
      inlineFunction: bondedFunction,
      inlineText: functionBody,
      squashList: squashList,
    };
  } catch (e) {
    console.error("Error creating function", e);
    Deno.writeTextFileSync(".error-function.js", functionBody);
    console.error("Function body", functionBody);
    console.error("Squash list", squashList);
    console.error("Squash table", squashTable);
    throw e;
  }
}
