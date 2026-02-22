import { assert } from "@std/assert";
import type { ConnectionOptions } from "../ConnectionOptions.ts";
import type { Neuron } from "../architecture/Neuron.ts";
import type { MutationBias } from "../predictiveCoding/PredictionErrorGuidedMutation.ts";
import {
  neuronBiasToIndexWeights,
  selectWeightedIndex,
} from "../predictiveCoding/PredictionErrorGuidedMutation.ts";
import { Synapse } from "../architecture/Synapse.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
import { AbstractMutationOperator } from "./AbstractMutationOperator.ts";

export class AddConnection extends AbstractMutationOperator {
  /**
   * Add a connection between two neurons.
   *
   * @param focusList - The list of focus indices.
   * @param options - The options for the connection.
   * @param options.weightScale - A scaling factor for the weight of the connection.
   */
  /**
   * Issue #1557: Accepts optional MutationBias for prediction-error-guided
   * connection selection. When provided, neuron pairs where at least one
   * neuron has high prediction error are more likely to be connected.
   *
   * The second parameter accepts either ConnectionOptions (for backward
   * compatibility with direct callers) or MutationBias (from the Mutator).
   */
  public override mutate(
    focusList?: number[],
    optionsOrBias?: ConnectionOptions | MutationBias,
    extraBias?: MutationBias,
  ): boolean {
    // Disambiguate the overloaded second parameter.
    let options: ConnectionOptions = { weightScale: 1 };
    let mutationBias: MutationBias | undefined;

    if (optionsOrBias) {
      if ("weightScale" in optionsOrBias) {
        options = optionsOrBias as ConnectionOptions;
        mutationBias = extraBias;
      } else if ("neuronWeights" in optionsOrBias) {
        mutationBias = optionsOrBias as MutationBias;
      }
    }
    // Create an array of all uncreated connections.
    //
    // When the creature is explicitly marked as forward-only, we must only
    // consider forward-only (feed-forward) index pairs. This must not rely on
    // semantic versions.
    const available: [number, number, Neuron, Neuron][] = [];
    const enforceForwardOnly = this.creature.forwardOnly === true;

    if (enforceForwardOnly) {
      // Issue #1584: Pre-mutation validate() removed — Mutator.repairAfterMutation()
      // handles fix + validate after the full mutation batch.

      // Forward-only invariant: neuron indices must be consistent.
      //
      // Rationale: if `neuron.index` does not match its
      // position in the `creature.neurons[]` array, the creature is corrupted.
      // In forward-only mode we must fail fast rather than attempting to
      // continue in a partially-valid state.
      for (let i = 0; i < this.creature.neurons.length; i++) {
        if (this.creature.neurons[i].index !== i) {
          throw new Error(
            `[AddConnection] Corrupt creature: neuron.index mismatch at neurons[${i}] ` +
              `(neuron.index=${this.creature.neurons[i].index}).`,
          );
        }
      }
    }

    // Issue #1098: Use cached available connections to avoid O(n²) iteration.
    // The cache is invalidated when structure changes (connect/disconnect/fix).
    // Issue #1036: getAvailableConnections uses Set-based O(1) connection lookup.
    const neurons = this.creature.neurons;
    const availablePairs = this.creature.getAvailableConnections(focusList);

    for (const [fromIndx, toIndx] of availablePairs) {
      const neuronFrom = neurons[fromIndx];
      const neuronTo = neurons[toIndx];
      // `fromIndx`/`toIndx` are the canonical neuron indices from the cache.
      // Do not use `neuron.index` here - it can be corrupted in bad exports and
      // would allow accidental backward connections.
      available.push([fromIndx, toIndx, neuronFrom, neuronTo]);
    }

    if (available.length === 0) {
      return false;
    }

    // Issue #1557: Use prediction-error-weighted selection when bias is available.
    // Weight each candidate pair by the maximum prediction error of the two neurons.
    let pair: [number, number, Neuron, Neuron];
    if (mutationBias && mutationBias.neuronWeights.size > 0) {
      const biasIndexWeights = neuronBiasToIndexWeights(
        mutationBias,
        this.creature,
      );
      // Build per-pair weight as max(fromWeight, toWeight).
      const pairWeights = new Map<number, number>();
      for (let i = 0; i < available.length; i++) {
        const [fromIdx, toIdx] = available[i];
        const fromW = biasIndexWeights.get(fromIdx) ?? 0;
        const toW = biasIndexWeights.get(toIdx) ?? 0;
        pairWeights.set(i, Math.max(fromW, toW));
      }
      const pairCandidates = Array.from(
        { length: available.length },
        (_, i) => i,
      );
      const selectedIndex = selectWeightedIndex(pairCandidates, pairWeights);
      pair = available[selectedIndex];
    } else {
      pair = available[
        Math.floor(getRandomNumberGenerator().random() * available.length)
      ];
    }
    const fromIndex = pair[0];
    const toIndex = pair[1];

    if (enforceForwardOnly) {
      // Defensive guard: forward-only creatures must never gain recurrent
      // connections.
      assert(
        fromIndex < toIndex,
        `[AddConnection] Forward-only violation: attempted to connect ${fromIndex} -> ${toIndex}`,
      );
    }

    const weight = Synapse.randomWeight(options.weightScale);

    this.creature.connect(fromIndex, toIndex, weight);

    // Issue #1584: Post-mutation validate() removed — Mutator.repairAfterMutation()
    // handles fix, validate, and version upgrade after the full mutation batch.

    delete this.creature.memetic;
    return true;
  }

  protected performMutation(_focusList?: number[]): boolean {
    // AddConnection overrides mutate() directly due to extra options parameter.
    // This method is never called.
    throw new Error("unreachable");
  }
}
