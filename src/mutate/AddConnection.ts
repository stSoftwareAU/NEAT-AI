import { assert } from "@std/assert";
import type { ConnectionOptions } from "../ConnectionOptions.ts";
import type { Creature } from "../Creature.ts";
import type { Neuron } from "../architecture/Neuron.ts";
import { Synapse } from "../architecture/Synapse.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";
import { getMajorVersion } from "../upgrade/Upgrade.ts";

function bumpToFourIfForwardOnlyConfirmed(creature: Creature): void {
  const major = getMajorVersion(creature.semanticVersion);
  if (major === 2 || major === 3) {
    creature.semanticVersion = "4.0.0";
  }
}

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
      const major = getMajorVersion(this.creature.semanticVersion);
      // Fail fast for 4.x+ (hard invariant). For pre-4.x we repair and continue,
      // because forward-only is not yet a hard guarantee until validated+upgraded.
      try {
        this.creature.validate({ forwardOnly: true });
        bumpToFourIfForwardOnlyConfirmed(this.creature);
      } catch (e) {
        const error = e as Error;
        if (major >= 4) {
          throw new Error(
            `[AddConnection] CRITICAL: 4.x forward-only creature is invalid before mutation: ` +
              `${error.name} - ${error.message}`,
          );
        }

        if (
          error.name === "SELF_CONNECTION" || error.name === "RECURSIVE_SYNAPSE"
        ) {
          // Australian English: forward-only pre-4.x may temporarily be invalid; repair it
          // so we can continue evolution and only lock the invariant once confirmed.
          this.creature.fix({ forwardOnly: true });
          this.creature.validate({ forwardOnly: true });
          bumpToFourIfForwardOnlyConfirmed(this.creature);
        } else {
          throw e;
        }
      }

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

    // Issue #1036: Use Set-based O(1) connection lookup instead of O(k) isProjectingTo.
    // This changes complexity from O(n² * k) to O(n² + m) where m = number of connections.
    const connectionSet = this.creature.getConnectionSet();
    const neurons = this.creature.neurons;
    const neuronCount = neurons.length;
    const inputCount = this.creature.input;

    for (let fromIndx = 0; fromIndx < neuronCount; fromIndx++) {
      const neuronFrom = neurons[fromIndx];
      const fromInFocus = this.creature.inFocus(fromIndx, focusList);

      // Start toIndx at max(fromIndx + 1, input) to ensure forward-only connections
      // and that we don't connect to input neurons
      const startTo = Math.max(fromIndx + 1, inputCount);

      for (let toIndx = startTo; toIndx < neuronCount; toIndx++) {
        if (!fromInFocus && !this.creature.inFocus(toIndx, focusList)) continue;

        const neuronTo = neurons[toIndx];

        if (neuronTo.type === "constant") continue;

        // O(1) connection existence check using Set instead of O(k) isProjectingTo
        const key = `${fromIndx}-${toIndx}`;
        if (!connectionSet.has(key)) {
          // `fromIndx`/`toIndx` are the canonical neuron indices. Do not use
          // `neuron.index` here - it can be corrupted in bad exports and would
          // allow accidental backward connections.
          available.push([fromIndx, toIndx, neuronFrom, neuronTo]);
        }
      }
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
      const major = getMajorVersion(this.creature.semanticVersion);
      try {
        this.creature.validate({ forwardOnly: true });
        bumpToFourIfForwardOnlyConfirmed(this.creature);
      } catch (e) {
        const error = e as Error;
        if (major >= 4) {
          throw new Error(
            `[AddConnection] CRITICAL: 4.x forward-only creature became invalid after mutation: ` +
              `${error.name} - ${error.message}`,
          );
        }

        if (
          error.name === "SELF_CONNECTION" || error.name === "RECURSIVE_SYNAPSE"
        ) {
          this.creature.fix({ forwardOnly: true });
          this.creature.validate({ forwardOnly: true });
          bumpToFourIfForwardOnlyConfirmed(this.creature);
        } else {
          throw e;
        }
      }
    }
    delete this.creature.memetic;
    return true;
  }
}
