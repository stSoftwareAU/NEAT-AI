import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import {
  adjustedWeight,
  type BackPropagationConfig,
} from "./BackPropagation.ts";
import type { Neuron } from "./Neuron.ts";

export function noChangePropagate(
  neuron: Neuron,
  activation: number,
  config: BackPropagationConfig,
) {
  const ns = neuron.creature.state.node(neuron.index);

  const squashMethod = neuron.findSquash();

  const propagateUpdateMethod = squashMethod as NeuronActivationInterface;
  if (propagateUpdateMethod.propagate !== undefined) {
    if (!ns.noChange) {
      const toList = neuron.creature.inwardConnections(neuron.index);

      for (let i = toList.length; i--;) {
        const c = toList[i];
        const fromNS = neuron.creature.state.node(c.from);
        if (!fromNS.noChange) {
          const fromNeuron = neuron.creature.neurons[c.from];
          if (
            fromNeuron.type !== "input" &&
            fromNeuron.type !== "constant"
          ) {
            const fromActivation = fromNeuron.adjustedActivation(config);
            noChangePropagate(fromNeuron, fromActivation, config);
          }
        }
      }
    }
  } else {
    if (!ns.noChange) {
      const toList = neuron.creature.inwardConnections(neuron.index);

      for (let indx = toList.length; indx--;) {
        const c = toList[indx];

        if (c.from === c.to) continue;

        const fromNeuron = neuron.creature.neurons[c.from];

        if (
          fromNeuron.type !== "input" &&
          fromNeuron.type !== "constant"
        ) {
          const fromNS = neuron.creature.state.node(fromNeuron.index);
          if (!fromNS.noChange) {
            const fromActivation = fromNeuron.adjustedActivation(config);
            noChangePropagate(fromNeuron, fromActivation, config);
          }
        }

        const cs = neuron.creature.state.connection(c.from, c.to);
        if (cs.count === 0) {
          const fromWeight = adjustedWeight(neuron.creature.state, c, config);

          cs.averageWeight = fromWeight;
        }
        cs.count++;
      }
    }

    ns.totalBias += neuron.bias;
    ns.count++;
  }

  ns.traceActivation(activation);
  ns.noChange = true;
}
