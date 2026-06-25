/**
 * @module
 *
 * Mutation operator that removes a feed-forward connection from the network,
 * operating directly on the creature's arrays with no export/import cycle.
 * Any neuron left without connections is cleaned up so the topology stays
 * valid.
 */
import { moveConstantNeuronIntoPrefix } from "@architecture/NormaliseComputationalNeuronOrder.ts";
import { removeHiddenNeuron } from "@compact/CompactUtils.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";
import type { Synapse } from "@architecture/Synapse.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { AbstractMutationOperator } from "@mutate/AbstractMutationOperator.ts";

export class SubConnection extends AbstractMutationOperator {
  /**
   * Subtract a connection from the network.
   * Operates directly on the creature's arrays — no export/import cycle.
   */
  protected performMutation(focusList?: number[]): boolean {
    const creature = this.creature;
    const rng = getRandomNumberGenerator();

    const possible: Synapse[] = [];

    for (const conn of creature.synapses) {
      if (conn.to <= conn.from) continue;

      if (this.#wouldBreakIfNeuron(conn)) continue;

      if (
        creature.inFocus(conn.to, focusList) ||
        creature.inFocus(conn.from, focusList)
      ) {
        possible.push(conn);
      }
    }

    if (possible.length === 0) {
      return false;
    }

    const randomConn = possible[Math.floor(rng.random() * possible.length)];
    const fromIndx = randomConn.from;
    const toIndx = randomConn.to;

    creature.disconnect(fromIndx, toIndx);

    const inwardList = creature.inwardConnections(toIndx);

    if (inwardList.length === 0) {
      const neuron = creature.neurons[toIndx];
      if (neuron.type === "hidden") {
        const outwardList = creature.outwardConnections(toIndx);
        if (outwardList.length === 0) {
          removeHiddenNeuron(creature, toIndx);
        } else {
          const squash = neuron.findSquash();
          const activation = squash as ActivationInterface;
          if (activation.squash) {
            neuron.bias = activation.squash(neuron.bias);
          }
          neuron.type = "constant";
          neuron.setSquash(undefined);
          moveConstantNeuronIntoPrefix(creature, toIndx);
        }
      }
    }

    const fromOutwardList = creature.outwardConnections(fromIndx);
    if (fromOutwardList.length === 0) {
      const fromNeuron = creature.neurons[fromIndx];
      if (fromNeuron.type === "hidden" || fromNeuron.type === "constant") {
        removeHiddenNeuron(creature, fromIndx);
      }
    }

    delete creature.memetic;
    return true;
  }

  /**
   * Check if removing a synapse would leave an IF neuron without required
   * connection types (condition, positive, negative).
   */
  #wouldBreakIfNeuron(synapse: Synapse): boolean {
    const creature = this.creature;
    const targetNeuron = creature.neurons[synapse.to];
    if (targetNeuron.squash !== "IF") return false;

    const inward = creature.inwardConnections(synapse.to);
    let conditionCount = 0;
    let positiveCount = 0;
    let negativeCount = 0;

    for (const conn of inward) {
      const synapseType = conn.type ?? "positive";
      if (synapseType === "condition") conditionCount++;
      else if (synapseType === "positive") positiveCount++;
      else if (synapseType === "negative") negativeCount++;
    }

    const synapseType = synapse.type ?? "positive";
    if (synapseType === "condition" && conditionCount <= 1) return true;
    if (synapseType === "positive" && positiveCount <= 1) return true;
    if (synapseType === "negative" && negativeCount <= 1) return true;

    return false;
  }
}
