import type { BackPropagationConfig } from "../../../architecture/BackPropagation.ts";
import type { Neuron } from "../../../architecture/Neuron.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";

export class HYPOTv2 implements NeuronActivationInterface {
  public readonly range: ActivationRange = new ActivationRange(
    this,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  propagate(
    neuron: Neuron,
    _targetActivation: number,
    _config: BackPropagationConfig,
  ): number {
    const activations = neuron.creature.state.activations;
    const activation = activations[neuron.index];
    this.range.validate(activation);
    return activation;
  }

  public static NAME = "HYPOTv2";

  getName() {
    return HYPOTv2.NAME;
  }

  activate(neuron: Neuron) {
    const toList = neuron.creature.inwardConnections(neuron.index);
    const values: number[] = [];
    const activations = neuron.creature.state.activations;
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const value = neuron.bias + activations[c.from] * c.weight;

      if (Number.isFinite(value)) {
        values.push(value);
      }
    }

    if (values.length == 0) {
      return 0;
    }

    const value = Math.hypot(...values);
    return this.range.limit(value);
  }

  activateAndTrace(neuron: Neuron) {
    return this.activate(neuron);
  }

  fix(neuron: Neuron) {
    const inwardA = neuron.creature.inwardConnections(neuron.index);
    for (let i = inwardA.length; i--;) {
      const c = inwardA[i];
      if (c.from == c.to) {
        neuron.creature.disconnect(c.from, c.to);
      }
    }

    const inwardB = neuron.creature.inwardConnections(neuron.index);

    if (inwardB.length < 2) {
      neuron.creature.makeRandomConnection(neuron.index);
    }
  }
}
