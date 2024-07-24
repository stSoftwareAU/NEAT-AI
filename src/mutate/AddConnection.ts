import type { ConnectionOptions, Creature } from "../Creature.ts";
import type { Neuron } from "../architecture/Neuron.ts";
import { Synapse } from "../architecture/Synapse.ts";
import type { MutatorInterface } from "./MutatorInterface.ts";

export class AddConnection implements MutatorInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  /**
   * Add a connection between two neurons.
   *
   * @param focusList - The list of focus indices. If provided, only neurons at these indices will be considered for connection.
   * @param options - The options for the connection.
   * @param options.weightScale - A scaling factor for the weight of the connection.
   */
  public mutate(focusList?: number[], options: ConnectionOptions = {
    weightScale: 1,
  }): boolean {
    // Create an array of all uncreated (feedforward) connections
    const available: [Neuron, Neuron][] = [];

    for (
      let fromIndx = 0;
      fromIndx < this.creature.neurons.length;
      fromIndx++
    ) {
      const neuronFrom = this.creature.neurons[fromIndx];

      const fromInFocus = this.creature.inFocus(fromIndx, focusList);
      for (
        let toIndx = Math.max(fromIndx + 1, this.creature.input);
        toIndx < this.creature.neurons.length;
        toIndx++
      ) {
        if (!fromInFocus && !this.creature.inFocus(toIndx, focusList)) continue;
        const neuronTo = this.creature.neurons[toIndx];

        if (neuronTo.type === "constant") continue;

        if (!neuronFrom.isProjectingTo(neuronTo)) {
          available.push([neuronFrom, neuronTo]);
        }
      }
    }

    if (available.length === 0) {
      return false;
    }

    const pair = available[Math.floor(Math.random() * available.length)];
    const fromIndex = pair[0].index;
    const toIndex = pair[1].index;
    const weightScale = options.weightScale || 1;
    const weight = Synapse.randomWeight() * weightScale;

    this.creature.connect(fromIndex, toIndex, weight);

    return true;
  }
}
