import { BackPropagationConfig } from "../../../architecture/BackPropagation.ts";
import { Neuron } from "../../../architecture/Neuron.ts";
import { NeuronActivationInterface } from "../NeuronActivationInterface.ts";

export class HYPOT implements NeuronActivationInterface {
  propagate(
    node: Neuron,
    _targetActivation: number,
    config: BackPropagationConfig,
  ): number {
    return node.adjustedActivation(config);
  }

  range(): { low: number; high: number } {
    return { low: 0, high: Number.POSITIVE_INFINITY };
  }

  public static NAME = "HYPOT";

  getName() {
    return HYPOT.NAME;
  }

  activate(node: Neuron) {
    const toList = node.creature.toConnections(node.index);
    const values: number[] = new Array(toList.length);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      values[i] = node.creature.getActivation(c.from) * c.weight;
    }

    const value = Math.hypot(...values);
    return value;
  }

  activateAndTrace(node: Neuron) {
    return this.activate(node);
  }

  fix(node: Neuron) {
    const toListA = node.creature.toConnections(node.index);
    for (let i = toListA.length; i--;) {
      const c = toListA[i];
      if (c.from == c.to) {
        node.creature.disconnect(c.from, c.to);
      }
    }

    for (let attempts = 12; attempts--;) {
      const toList = node.creature.toConnections(node.index);

      if (toList.length < 2) {
        node.creature.makeRandomConnection(node.index);
      } else {
        break;
      }
    }
  }
}
