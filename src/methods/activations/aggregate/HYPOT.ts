import type { BackPropagationConfig } from "../../../architecture/BackPropagation.ts";
import type { Neuron } from "../../../architecture/Neuron.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";

export class HYPOT implements NeuronActivationInterface {
  public readonly range: ActivationRange = new ActivationRange(
    this,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  propagate(
    neuron: Neuron,
    _targetActivation: number,
    config: BackPropagationConfig,
  ): number {
    const inward = neuron.creature.inwardConnections(neuron.index);
    const values: number[] = new Array(inward.length);
    for (let indx = inward.length; indx--;) {
      const c = inward[indx];

      const fromNeuron = neuron.creature.neurons[c.from];

      const fromActivation = fromNeuron.adjustedActivation(config);
      const improvedActivation = fromNeuron.propagate(
        fromActivation,
        config,
      );
      values[indx] = improvedActivation * c.weight;
    }

    const value = Math.hypot(...values) + neuron.bias;
    return this.range.limit(value);
  }

  public static NAME = "HYPOT";

  getName() {
    return HYPOT.NAME;
  }

  activate(neuron: Neuron) {
    const toList = neuron.creature.inwardConnections(neuron.index);
    const values: number[] = new Array(toList.length);
    const activations = neuron.creature.state.activations;
    for (let i = toList.length; i--;) {
      const c = toList[i];

      values[i] = activations[c.from] * c.weight;
    }

    const value = Math.hypot(...values);

    return value + neuron.bias;
  }

  activateAndTrace(neuron: Neuron) {
    return this.activate(neuron);
  }

  fix(neuron: Neuron) {
    const toListA = neuron.creature.inwardConnections(neuron.index);
    for (let i = toListA.length; i--;) {
      const c = toListA[i];
      if (c.from == c.to) {
        neuron.creature.disconnect(c.from, c.to);
      }
    }

    for (let attempts = 12; attempts--;) {
      const toList = neuron.creature.inwardConnections(neuron.index);

      if (toList.length < 2) {
        neuron.creature.makeRandomConnection(neuron.index);
      } else {
        break;
      }
    }
  }
}
