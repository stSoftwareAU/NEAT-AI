import { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import {
  accumulateWeight,
  adjustedBias,
  adjustedWeight,
  BackPropagationConfig,
} from "./BackPropagation.ts";
import { Neuron } from "./Neuron.ts";

export function noChangePropagate(
  neuron: Neuron,
  activation: number,
  config: BackPropagationConfig,
) {
  const ns = neuron.creature.state.node(neuron.index);

  const squashMethod = neuron.findSquash();

  const propagateUpdateMethod = squashMethod as NeuronActivationInterface;
  if (propagateUpdateMethod.propagate !== undefined) {
    propagateUpdateMethod.propagate(
      neuron,
      activation,
      config,
    );
  } else {
    const currentBias = adjustedBias(neuron, config);
    const toList = neuron.creature.inwardConnections(neuron.index);

    const listLength = toList.length;

    if (listLength) {
      for (let indx = listLength; indx--;) {
        const c = toList[indx];

        if (c.from === c.to) continue;

        const fromNeuron = neuron.creature.neurons[c.from];

        const fromActivation = fromNeuron.adjustedActivation(config);

        const fromWeight = adjustedWeight(neuron.creature.state, c, config);
        const fromValue = fromWeight * fromActivation;

        if (
          fromWeight &&
          fromNeuron.type !== "input" &&
          fromNeuron.type !== "constant"
        ) {
          fromNeuron.propagate(
            fromActivation,
            config,
          );
        }

        if (
          Math.abs(fromActivation) > config.plankConstant &&
          Math.abs(fromWeight) > config.plankConstant
        ) {
          const cs = neuron.creature.state.connection(c.from, c.to);
          accumulateWeight(
            c.weight,
            cs,
            fromValue,
            fromActivation,
            config,
          );
        }
      }
    }

    ns.accumulateBias(
      ns.hintValue,
      ns.hintValue,
      config,
      activation,
      activation,
      currentBias,
    );
  }

  ns.traceActivation(activation);
}
