import { removeHiddenNeuron } from "../compact/CompactUtils.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { AbstractMutationOperator } from "./AbstractMutationOperator.ts";

export class SubNeuron extends AbstractMutationOperator {
  /**
   * Subtract a neuron from the network.
   * Operates directly on the creature's arrays — no export/import cycle.
   */
  protected performMutation(focusList?: number[]): boolean {
    const creature = this.creature;
    const rng = getRandomNumberGenerator();

    if (creature.neurons.length === creature.input + creature.output) {
      return false;
    }

    let selectedIndx = -1;

    for (let attempts = 0; attempts < 24; attempts++) {
      const indx = Math.floor(
        rng.random() *
            (creature.neurons.length - creature.output - creature.input) +
          creature.input,
      );

      if (attempts < 12 && !creature.inFocus(indx, focusList)) continue;

      selectedIndx = indx;
      break;
    }

    if (selectedIndx === -1) {
      return false;
    }

    removeHiddenNeuron(creature, selectedIndx);

    this.#cascadeCleanup();
    this.#cleanupInvalidIfNeurons();

    delete creature.memetic;
    return true;
  }

  /**
   * After removing a neuron, scan all hidden/constant neurons for orphans:
   * - No outward connections → remove
   * - Hidden with outward but no inward → convert to constant
   *
   * Iterates backwards (high-to-low index) so removals don't invalidate
   * unprocessed indices. Repeats until stable.
   */
  #cascadeCleanup(): void {
    const creature = this.creature;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = creature.neurons.length - 1; i >= creature.input; i--) {
        const n = creature.neurons[i];
        if (n.type !== "hidden" && n.type !== "constant") continue;

        if (creature.outwardConnections(i).length === 0) {
          removeHiddenNeuron(creature, i);
          changed = true;
          continue;
        }

        if (n.type === "hidden" && creature.inwardConnections(i).length === 0) {
          const squash = n.findSquash();
          const activation = squash as ActivationInterface;
          if ("squash" in activation) {
            n.bias = (activation as ActivationInterface).squash(n.bias);
          }
          n.type = "constant";
          n.setSquash(undefined);
          changed = true;
        }
      }
    }
  }

  /**
   * After removing a neuron and its synapses, IF neurons may lose required
   * connection types. Fix them on the live creature.
   */
  #cleanupInvalidIfNeurons(): void {
    const creature = this.creature;
    let changed: boolean;
    do {
      changed = false;
      for (
        let i = creature.neurons.length - 1;
        i >= creature.input;
        i--
      ) {
        const neuron = creature.neurons[i];
        if (neuron.squash !== "IF") continue;

        const inward = creature.inwardConnections(i);
        let hasCondition = false;
        let hasPositive = false;
        let hasNegative = false;

        for (const syn of inward) {
          const synapseType = syn.type ?? "positive";
          if (synapseType === "condition") hasCondition = true;
          else if (synapseType === "positive") hasPositive = true;
          else if (synapseType === "negative") hasNegative = true;
        }

        if (!hasCondition || !hasPositive || !hasNegative) {
          if (neuron.type === "output") {
            neuron.setSquash("IDENTITY");
            for (const syn of inward) {
              if (syn.type) {
                delete syn.type;
              }
            }
          } else {
            removeHiddenNeuron(creature, i);
            changed = true;
          }
        }
      }
    } while (changed);
  }
}
