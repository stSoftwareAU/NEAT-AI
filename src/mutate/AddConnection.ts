import { assert } from "@std/assert";
import type { ConnectionOptions } from "../ConnectionOptions.ts";
import type { Creature } from "../Creature.ts";
import type { Neuron } from "../architecture/Neuron.ts";
import { Synapse } from "../architecture/Synapse.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";
import { validateAndBumpForwardOnly } from "./MutationUtils.ts";

export class AddConnection implements RadioactiveInterface {
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
    // Create an array of all uncreated connections.
    //
    // When the creature is explicitly marked as forward-only, we must only
    // consider forward-only (feed-forward) index pairs. This must not rely on
    // semantic versions.
    const available: [number, number, Neuron, Neuron][] = [];
    const enforceForwardOnly = this.creature.forwardOnly === true;

    if (enforceForwardOnly) {
      // Fail fast for 4.x+ (hard invariant). For pre-4.x we repair and continue,
      // because forward-only is not yet a hard guarantee until validated+upgraded.
      validateAndBumpForwardOnly(
        this.creature,
        "AddConnection before mutation",
      );

      // Forward-only invariant: neuron indices must be consistent.
      //
      // Rationale:if `neuron.index` does not match its
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

    for (let i = 0; i < availablePairs.length; i++) {
      const [fromIndx, toIndx] = availablePairs[i];
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

    const pair = available[Math.floor(Math.random() * available.length)];
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
    if (enforceForwardOnly) {
      // Validation is useful. For 4.x+ this is a hard failure; for pre-4.x we can
      // repair and continue, then bump to 4.x once forward-only is confirmed.
      validateAndBumpForwardOnly(
        this.creature,
        "AddConnection after mutation",
      );
    }
    delete this.creature.memetic;
    return true;
  }
}
