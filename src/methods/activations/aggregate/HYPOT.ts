import type { BackPropagationConfig } from "../../../architecture/BackPropagation.ts";
import type { Neuron } from "../../../architecture/Neuron.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";

export class HYPOT implements NeuronActivationInterface {
  public readonly range: ActivationRange = new ActivationRange(
    this,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  propagate(
    node: Neuron,
    _targetActivation: number,
    config: BackPropagationConfig,
  ): number {
    return node.adjustedActivation(config);
  }

  // range() {
  //   return { low: 0, high: Number.POSITIVE_INFINITY };
  // }

  public static NAME = "HYPOT";

  getName() {
    return HYPOT.NAME;
  }

  activate(node: Neuron) {
    const toList = node.creature.inwardConnections(node.index);
    const values: number[] = new Array(toList.length);
    const activations = node.creature.state.activations;
    for (let i = toList.length; i--;) {
      const c = toList[i];

      values[i] = activations[c.from] * c.weight;
    }

    const value = Math.hypot(...values);
    return value;
  }

  activateAndTrace(node: Neuron) {
    return this.activate(node);
  }

  fix(node: Neuron) {
    const toListA = node.creature.inwardConnections(node.index);
    for (let i = toListA.length; i--;) {
      const c = toListA[i];
      if (c.from == c.to) {
        node.creature.disconnect(c.from, c.to);
      }
    }

    for (let attempts = 12; attempts--;) {
      const toList = node.creature.inwardConnections(node.index);

      if (toList.length < 2) {
        node.creature.makeRandomConnection(node.index);
      } else {
        break;
      }
    }
  }
}
