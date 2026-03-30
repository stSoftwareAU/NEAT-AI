import { removeHiddenNeuron } from "../compact/CompactUtils.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
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

    const incomingConnections = creature.inwardConnections(selectedIndx);
    const outgoingConnections = creature.outwardConnections(selectedIndx);

    const sourcesToCheck = new Set<number>();
    for (const conn of incomingConnections) {
      sourcesToCheck.add(conn.from);
    }

    const targetsToCheck = new Set<number>();
    for (const conn of outgoingConnections) {
      targetsToCheck.add(conn.to);
    }

    removeHiddenNeuron(creature, selectedIndx);

    this.#cascadeCleanup(selectedIndx, sourcesToCheck, targetsToCheck);
    this.#cleanupInvalidIfNeurons();

    delete creature.memetic;
    return true;
  }

  /**
   * After removing a neuron, check its former neighbours:
   * - Sources that lost all outward connections → remove
   * - Targets that lost all inward connections → convert to constant or remove
   *
   * Runs iteratively until no more changes (handles cascading orphans).
   */
  #cascadeCleanup(
    removedIndx: number,
    sourcesToCheck: Set<number>,
    targetsToCheck: Set<number>,
  ): void {
    const creature = this.creature;
    let changed = true;
    while (changed) {
      changed = false;

      const adjustIndex = (idx: number) => idx > removedIndx ? idx - 1 : idx;

      const adjustedSources = [...sourcesToCheck].map(adjustIndex);
      const adjustedTargets = [...targetsToCheck].map(adjustIndex);

      const toRemove: number[] = [];

      for (const srcIndx of adjustedSources) {
        if (srcIndx < 0 || srcIndx >= creature.neurons.length) continue;
        const n = creature.neurons[srcIndx];
        if (n.type !== "hidden" && n.type !== "constant") continue;
        if (creature.outwardConnections(srcIndx).length === 0) {
          toRemove.push(srcIndx);
        }
      }

      for (const tgtIndx of adjustedTargets) {
        if (tgtIndx < 0 || tgtIndx >= creature.neurons.length) continue;
        const n = creature.neurons[tgtIndx];
        if (n.type !== "hidden") continue;

        const inward = creature.inwardConnections(tgtIndx);
        if (inward.length === 0) {
          const outward = creature.outwardConnections(tgtIndx);
          if (outward.length === 0) {
            if (!toRemove.includes(tgtIndx)) toRemove.push(tgtIndx);
          } else {
            const squash = n.findSquash();
            const activation = squash as ActivationInterface;
            if ("squash" in activation) {
              n.bias = (activation as ActivationInterface).squash(n.bias);
            }
            n.type = "constant";
            n.setSquash(undefined);
          }
        }
      }

      toRemove.sort((a, b) => b - a);
      for (const idx of toRemove) {
        const n = creature.neurons[idx];
        if (n.type === "hidden" || n.type === "constant") {
          const newSources = new Set<number>();
          for (const conn of creature.inwardConnections(idx)) {
            newSources.add(conn.from);
          }
          const newTargets = new Set<number>();
          for (const conn of creature.outwardConnections(idx)) {
            newTargets.add(conn.to);
          }

          removeHiddenNeuron(creature, idx);
          removedIndx = idx;
          sourcesToCheck = newSources;
          targetsToCheck = newTargets;
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
