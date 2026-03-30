import { assert } from "@std/assert";
import type { ConnectionOptions } from "@connectionOptions";
import type { Neuron } from "@architecture/Neuron.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import type { MutationBias } from "@predictiveCoding/PredictionErrorGuidedMutation.ts";
import {
  neuronBiasToIndexWeights,
  selectWeightedIndex,
} from "@predictiveCoding/PredictionErrorGuidedMutation.ts";
import { Synapse } from "@architecture/Synapse.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { AbstractMutationOperator } from "@mutate/AbstractMutationOperator.ts";

/**
 * Maximum number of rejection sampling attempts before falling back to
 * the full available-connections list. Keeps the expected cost well
 * below the O(N²) full-scan for sparse networks.
 */
const MAX_REJECTION_ATTEMPTS = 20;

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

    const enforceForwardOnly = this.creature.forwardOnly === true;

    if (enforceForwardOnly) {
      // Forward-only invariant: neuron indices must be consistent.
      for (let i = 0; i < this.creature.neurons.length; i++) {
        if (this.creature.neurons[i].index !== i) {
          throw new TopologyError(
            `[AddConnection] Corrupt creature: neuron.index mismatch at neurons[${i}] ` +
              `(neuron.index=${this.creature.neurons[i].index}).`,
            "INVALID_STATE",
          );
        }
      }
    }

    // Issue #1587: Use rejection sampling for the simple case (no focusList,
    // no mutationBias). Randomly pick (from, to) pairs and check validity
    // in O(1) instead of building the full O(N²) available-connections list.
    const hasFocus = focusList !== undefined && focusList.length > 0;
    const hasBias = mutationBias !== undefined &&
      mutationBias.neuronWeights.size > 0;

    if (!hasFocus && !hasBias) {
      const result = this.tryRejectionSampling(options);
      if (result !== undefined) {
        return result;
      }
      // Rejection sampling exhausted attempts — fall through to full scan.
    }

    // Full scan path: build the complete available-connections list.
    // Used when rejection sampling fails (dense network), or when
    // focusList/mutationBias requires weighted selection over all candidates.
    return this.fullScanMutate(
      focusList,
      options,
      mutationBias,
      enforceForwardOnly,
    );
  }

  /**
   * Issue #1587: Rejection sampling — randomly pick neuron pairs and check
   * if they form a valid new connection. Returns `true` if a connection was
   * added, `false` if no connections are possible (fully connected), or
   * `undefined` if sampling was exhausted and the caller should fall back
   * to the full scan.
   */
  private tryRejectionSampling(
    options: ConnectionOptions,
  ): boolean | undefined {
    const neurons = this.creature.neurons;
    const inputCount = this.creature.input;
    const neuronCount = neurons.length;
    const rng = getRandomNumberGenerator();

    // Build list of valid "to" neuron indices (exclude constant neurons
    // and input neurons, which cannot be targets).
    const validToIndices: number[] = [];
    for (let i = inputCount; i < neuronCount; i++) {
      if (neurons[i].type !== "constant") {
        validToIndices.push(i);
      }
    }

    if (validToIndices.length === 0) {
      return false;
    }

    for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
      // Pick a random "to" neuron from valid targets.
      const toIndex =
        validToIndices[Math.floor(rng.random() * validToIndices.length)];

      // Pick a random "from" neuron with forward ordering (from < to),
      // matching the constraint used by computeAvailableConnections().
      if (toIndex === 0) continue;
      const fromIndex = Math.floor(rng.random() * toIndex);

      // Check if this connection already exists (O(1) lookup).
      if (this.creature.hasConnection(fromIndex, toIndex)) {
        continue;
      }

      // Valid pair found — create the connection.
      const weight = Synapse.randomWeight(options.weightScale);
      this.creature.connect(fromIndex, toIndex, weight);
      delete this.creature.memetic;
      return true;
    }

    // Exhausted attempts — signal caller to fall back to full scan.
    return undefined;
  }

  /**
   * Original full-scan approach: builds the complete list of available
   * connections and selects from it. Used as fallback from rejection
   * sampling, and always used when focusList or mutationBias is active.
   */
  private fullScanMutate(
    focusList: number[] | undefined,
    options: ConnectionOptions,
    mutationBias: MutationBias | undefined,
    enforceForwardOnly: boolean,
  ): boolean {
    const neurons = this.creature.neurons;
    const availablePairs = this.creature.getAvailableConnections(focusList);

    const available: [number, number, Neuron, Neuron][] = [];
    for (const [fromIndx, toIndx] of availablePairs) {
      const neuronFrom = neurons[fromIndx];
      const neuronTo = neurons[toIndx];
      available.push([fromIndx, toIndx, neuronFrom, neuronTo]);
    }

    if (available.length === 0) {
      return false;
    }

    // Issue #1557: Use prediction-error-weighted selection when bias is available.
    let pair: [number, number, Neuron, Neuron];
    if (mutationBias && mutationBias.neuronWeights.size > 0) {
      const biasIndexWeights = neuronBiasToIndexWeights(
        mutationBias,
        this.creature,
      );
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
      assert(
        fromIndex < toIndex,
        `[AddConnection] Forward-only violation: attempted to connect ${fromIndex} -> ${toIndex}`,
      );
    }

    const weight = Synapse.randomWeight(options.weightScale);
    this.creature.connect(fromIndex, toIndex, weight);
    delete this.creature.memetic;
    return true;
  }

  protected performMutation(_focusList?: number[]): boolean {
    // AddConnection overrides mutate() directly due to extra options parameter.
    // This method is never called.
    throw new TopologyError("unreachable", "INVALID_STATE");
  }
}
