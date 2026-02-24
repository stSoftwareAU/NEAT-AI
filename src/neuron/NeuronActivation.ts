/**
 * NeuronActivation.ts - Activation function management and computation.
 *
 * Extracted from Neuron.ts (Issue #1599) to keep the Neuron class
 * under 500 lines and each module focused on a single responsibility.
 */

import type { Neuron } from "../architecture/Neuron.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import type { ApplyLearningsInterface } from "../methods/activations/ApplyLearningsInterface.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import type { NeuronFixableInterface } from "../methods/activations/NeuronFixableInterface.ts";
import type { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";
import type { MakeActivationFunctionInterface } from "../optimize/MakeActivationFunctionInterface.ts";
import {
  findActivationFunction,
  type FunctionCache,
} from "../optimize/FunctionCache.ts";

/**
 * Type guard: checks if an activation implements NeuronActivationInterface.
 */
export function isNodeActivation(
  activation:
    | NeuronActivationInterface
    | ActivationInterface
    | UnSquashInterface,
): activation is NeuronActivationInterface {
  return (activation as NeuronActivationInterface).activateAndTrace !==
    undefined;
}

/**
 * Type guard: checks if an activation has applyLearnings support.
 */
export function hasApplyLearnings(
  activation:
    | ApplyLearningsInterface
    | NeuronActivationInterface
    | ActivationInterface
    | UnSquashInterface,
): activation is ApplyLearningsInterface {
  return (activation as ApplyLearningsInterface).applyLearnings !== undefined;
}

/**
 * Type guard: checks if an activation is fixable.
 */
export function isFixableActivation(
  activation:
    | NeuronActivationInterface
    | ActivationInterface
    | NeuronFixableInterface
    | UnSquashInterface,
): activation is NeuronFixableInterface {
  return (activation as NeuronFixableInterface).fix !== undefined;
}

/**
 * Creates a function that calculates the activation of the neuron.
 * Uses dynamic function compilation for performance.
 */
export function makeFunction(
  neuron: Neuron,
  functionCache: FunctionCache,
  squashProxy: (value: number) => number,
): () => { activation: number; value: number } {
  let functionBody = "const activations = state.activations;\n";
  functionBody += `const value = ${neuron.bias}`;

  const inwardList = neuron.creature.inwardConnections(neuron.index);
  const inwardListClone = inwardList.slice(0).sort((a, b) => a.from - b.from);
  for (let i = 0, len = inwardListClone.length; i < len; i++) {
    const { from, weight } = inwardListClone[i];
    functionBody += `+\nactivations[${from}] * ${weight}`;
  }
  functionBody += `;\n`;

  functionBody += `const activation = squash(value);\n`;
  functionBody += `activations[${neuron.index}] = activation;\n`;
  functionBody += "return { activation, value };";

  const foundFunction = findActivationFunction(
    functionBody,
    functionCache,
    neuron.squash,
  );

  if (foundFunction) {
    return foundFunction;
  }

  // Dynamically create the function
  const func = new Function(
    "state", // Parameter: neuron state
    "squash", // Parameter: squash function
    functionBody,
  ) as (
    state: { activations: Float32Array },
    squash: (value: number) => number,
  ) => {
    activation: number;
    value: number;
  };

  // Bind static parameters: state and squash function
  const bondedFunction = func.bind(
    null,
    neuron.creature.state,
    squashProxy,
  );

  functionCache.function = bondedFunction;
  return bondedFunction;
}

/**
 * Updates the cached activation function based on neuron type and squash.
 * Sets up the activateNeuron and activateAndTraceNeuron methods on the neuron.
 */
export function prepare(
  neuron: Neuron,
  functionCache: FunctionCache,
):
  | NeuronActivationInterface
  | ActivationInterface
  | UnSquashInterface
  | undefined {
  if (neuron.type === "constant") {
    neuron.activateAndTraceNeuron = () => activateConstant(neuron);
    neuron.activateNeuron = () => activateConstant(neuron);
  } else if (neuron.squash) {
    const squashMethod = neuron.findSquash();
    if (isNodeActivation(squashMethod)) {
      neuron.activateAndTraceNeuron = () =>
        activateAndTraceNeuronActivation(neuron, squashMethod);

      if (
        (squashMethod as MakeActivationFunctionInterface)
          .makeActivationFunction
      ) {
        neuron.activateNeuron =
          (squashMethod as MakeActivationFunctionInterface)
            .makeActivationFunction(neuron, functionCache);
      } else {
        neuron.activateNeuron = () =>
          activateNeuronActivation(neuron, squashMethod);
      }
    } else {
      const squashActivation = squashMethod as ActivationInterface;
      const squashProxy = squashActivation.squash.bind(squashActivation);

      neuron.activateAndTraceNeuron = () => {
        const result = neuron.activateNeuron();
        const state = neuron.creature.state;
        const ns = state.node(neuron.index);
        ns.hintValue = result.value;
        return result;
      };

      neuron.activateNeuron = makeFunction(
        neuron,
        functionCache,
        squashProxy,
      );
    }
    return squashMethod;
  }
}

/**
 * Activation for constant neurons.
 */
function activateConstant(
  neuron: Neuron,
): { activation: number; value: number } {
  const state = neuron.creature.state;
  const activations = state.activations;
  const activation = neuron.bias;

  activations[neuron.index] = activation;
  return { activation, value: 0 };
}

/**
 * Activation using NeuronActivationInterface.
 */
function activateNeuronActivation(
  neuron: Neuron,
  squashMethod: NeuronActivationInterface,
): { activation: number; value: number } {
  const state = neuron.creature.state;
  const activations = state.activations;
  const activation = squashMethod.activate(neuron);

  activations[neuron.index] = activation;
  return { activation, value: 0 };
}

/**
 * Activation with tracing using NeuronActivationInterface.
 */
function activateAndTraceNeuronActivation(
  neuron: Neuron,
  squashMethod: NeuronActivationInterface,
): { activation: number; value: number } {
  const state = neuron.creature.state;
  const activations = state.activations;
  const activation = squashMethod.activateAndTrace(neuron);

  activations[neuron.index] = activation;
  return { activation, value: 0 };
}

/**
 * Apply the learnings from the previous training.
 * @returns true if changed
 */
export function applyLearnings(neuron: Neuron): boolean {
  const state = neuron.creature.state;
  const neuronState = state.node(neuron.index);
  if (neuronState.noChange) return false;
  if (neuron.type === "hidden" || neuron.type === "output") {
    const squashMethod = neuron.findSquash();

    if (hasApplyLearnings(squashMethod)) {
      return squashMethod.applyLearnings(neuron);
    }
  }

  return false;
}
