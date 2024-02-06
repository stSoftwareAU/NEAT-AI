import {
  BackPropagationConfig,
  limitActivation,
  limitValue,
} from "../../../architecture/BackPropagation.ts";
import { Neuron } from "../../../architecture/Neuron.ts";
import { NeuronActivationInterface } from "../NeuronActivationInterface.ts";

export class MEAN implements NeuronActivationInterface {
  public static NAME = "MEAN";

  getName() {
    return MEAN.NAME;
  }

  range(): { low: number; high: number } {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }

  activate(node: Neuron) {
    let sum = 0;

    const toList = node.creature.toConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const fromActivation = node.creature.getActivation(c.from);
      const activation = limitActivation(fromActivation);

      sum += activation * c.weight;
      if (Number.isFinite(sum) == false) {
        throw new Error(
          `Node: ${node.uuid} connection: ${
            c.from + ":" + c.to
          }, SUM: ${sum} is not finite. From Activation: ${fromActivation}, Activation: ${activation}, Weight: ${c.weight}`,
        );
      }
    }

    const value = limitValue(sum / toList.length);
    if (Number.isFinite(value) == false) {
      throw new Error(
        `Node: ${node.uuid} MEAN: ${value} is not finite sum: ${sum} toList.length: ${toList.length}`,
      );
    }
    return value;
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

  activateAndTrace(node: Neuron) {
    const activation = this.activate(node);

    const toList = node.creature.toConnections(node.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const cs = node.creature.state.connection(
        c.from,
        c.to,
      );
      cs.used = true;
    }

    return activation;
  }

  propagate(
    node: Neuron,
    _targetActivation: number,
    config: BackPropagationConfig,
  ): number {
    return node.adjustedActivation(config);
  }
}
