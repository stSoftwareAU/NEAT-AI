import type { Creature } from "../Creature.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import { ReLU } from "../methods/activations/types/ReLU.ts";
import type { InlineActivationInterface } from "./InlineActivationInterface.ts";
import type { InlineSquashInterface } from "./InlineSquashInterface.ts";
import { inlineActivation } from "./MakeNeuronActivation.ts";

export function makeCreatureActivationFunction(creature: Creature) {
  let functionBody = "const a = this.activations;\n";

  const squashMap = new Map<string, () => number>();
  for (let indx = creature.input; indx < creature.neurons.length; indx++) {
    const neuron = creature.neurons[indx];
    functionBody += inlineActivation(neuron);
    if (
      neuron.squash && !squashMap.has(neuron.squash) &&
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
            squashMap.set(neuron.squash, bound as () => number);
          } else {
            const neuronActivation = sf as NeuronActivationInterface;
            const bound = neuronActivation.activate.bind(squashActivation);
            squashMap.set(neuron.squash, bound as () => number);
          }
        }
      }
    }
  }

  const squashList = Array.from(squashMap.keys());
  // Dynamically create the function
  try {
    const func = new Function(
      "neurons",
      ...squashList,
      functionBody,
    ) as () => undefined;

    const bondedFunction = func.bind(
      creature.state,
      creature.neurons,
      ...squashMap.values(),
    );

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
    console.error("Squash map", squashMap);
    throw e;
  }
}
