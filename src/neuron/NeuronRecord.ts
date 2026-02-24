/**
 * NeuronRecord.ts - Error recording for structural discovery.
 *
 * Extracted from Neuron.ts (Issue #1599) to keep the Neuron class
 * under 500 lines and each module focused on a single responsibility.
 */

import { assert } from "@std/assert";
import type { Neuron } from "../architecture/Neuron.ts";
import type { DiscoverRecord } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { TopologyError } from "../errors/TopologyError.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import { getLogger } from "../utils/Logger.ts";
import {
  buildRecordElasticLinks,
  constrainAndRedistributeRecordShares,
  distributeRecordError,
} from "../propagate/RecordElasticity.ts";
import {
  calculateError as wasmCalculateError,
} from "../wasm/ActivationMethods.ts";

/**
 * Record the error for the neuron, used for structural discovery.
 *
 * Uses first-visit tracking to prevent exponential recursion and
 * elastic attribution for error distribution.
 */
export function record(
  neuron: Neuron,
  requestedActivation: number,
  discoverMap: Map<string, DiscoverRecord>,
): void {
  const squashMethod = neuron.findSquash();
  const inwardList = neuron.creature.inwardConnections(neuron.index);
  const listLength = inwardList.length;
  const state = neuron.creature.state;
  const currentActivation = state.activations[neuron.index];

  let discoverRecord = discoverMap.get(neuron.uuid);
  const isNewRecord = discoverRecord === undefined;
  if (discoverRecord === undefined) {
    discoverRecord = {
      activation: currentActivation,
      errors: [],
    };
    assert(discoverRecord !== undefined);
    discoverMap.set(neuron.uuid, discoverRecord);
  }

  // DIAGNOSTIC: Log if we're accumulating excessive errors
  // Note: Errors accumulate from all paths (correct behaviour), but recursion should only happen once
  if (!isNewRecord && discoverRecord.errors.length > 200) {
    getLogger().warn(
      `⚠️  PERFORMANCE: Neuron ${neuron.uuid} has ${discoverRecord.errors.length} accumulated errors`,
    );
    getLogger().warn(
      `  Type: ${neuron.type}, Inward connections: ${listLength}`,
    );
    if (discoverRecord.errors.length > 500) {
      getLogger().error(
        `❌ CRITICAL: Neuron ${neuron.uuid} has ${discoverRecord.errors.length} errors - likely infinite recursion!`,
      );
      throw new TopologyError(
        `Excessive error accumulation detected on neuron ${neuron.uuid}. ` +
          `Got ${discoverRecord.errors.length} errors. ` +
          `This suggests infinite recursion in backpropagation.`,
        "EXCESSIVE_ERRORS",
      );
    }
  }

  const propagateUpdateMethod = squashMethod as NeuronActivationInterface;
  if (propagateUpdateMethod.record !== undefined) {
    propagateUpdateMethod.record(
      neuron,
      requestedActivation,
      discoverMap,
    );
  } else {
    const targetActivation = squashMethod.range.limit(requestedActivation);

    let currentValue = discoverRecord.value;
    if (Number.isFinite(currentValue) === false) {
      currentValue = neuron.bias;
      if (neuron.type !== "constant") {
        for (let indx = 0; indx < listLength; indx++) {
          const c = inwardList[indx];

          const fromActivation = state.activations[c.from];

          const fromValue = c.weight * fromActivation;
          currentValue += fromValue;
        }
      }
      discoverRecord.value = currentValue;
    }

    let error = 0;
    if (Math.abs(targetActivation - currentActivation) > 1e-8) {
      // Issue #1143 - Use WASM calculateError when available
      // This handles both activation-specific error semantics (eg. STEP/BIPOLAR
      // clamp error) and falls back appropriately when not supported.
      error = wasmCalculateError(
        neuron.squash!,
        currentActivation,
        targetActivation,
        currentValue!,
      );
    }

    // CRITICAL FIX: Track if this is the first visit to this neuron
    // Only process and record error on first visit to prevent exponential recursion
    const isFirstVisit = discoverRecord.errors.length === 0;

    // Only process on first visit (prevents duplicate errors and exponential recursion)
    if (isFirstVisit) {
      discoverRecord.errors.push(error);

      if (listLength) {
        // Elastic record attribution: prefer pushing error through upstream
        // neurons that are in their safe zone (plastic), and avoid pushing
        // saturated parents unless there is no alternative.
        const provisionalErrorPerLink = error / listLength;
        const links = buildRecordElasticLinks(
          neuron,
          inwardList,
          discoverMap,
          provisionalErrorPerLink,
        );
        const { links: chosenLinks, shares } = distributeRecordError(
          error,
          links,
          {
            plankConstant: 1e-12,
            allowEqualFallback: true, // last resort if all are blocked
          },
        );

        const plankConstant = 1e-12;

        // Clamp each per-link share to what its upstream squash can actually
        // accept (or what we strongly prefer), then redistribute residue.
        //
        // Example: ABSOLUTE ∈ [0, +∞). If a share implies a negative target,
        // we clamp to the boundary (target=0) and push the remaining error
        // into other links.
        const constrainedShares = constrainAndRedistributeRecordShares(
          error,
          chosenLinks,
          shares,
          { plankConstant },
        );

        for (let i = 0; i < chosenLinks.length; i++) {
          const link = chosenLinks[i];
          const share = constrainedShares[i] ?? 0;
          if (!Number.isFinite(share) || Math.abs(share) <= plankConstant) {
            continue;
          }

          // Safe-zone hard guard: do not recurse into fully blocked parents.
          if (
            !Number.isFinite(link.safeZoneFactor) || link.safeZoneFactor <= 0
          ) {
            continue;
          }

          const fromNeuron = link.fromNeuron;
          const weight = link.synapse.weight;
          if (!weight) continue;

          const targetFromValue = link.fromValue + share;
          const targetFromActivation = targetFromValue / weight;

          record(fromNeuron, targetFromActivation, discoverMap);
        }
      }
    }
  }
}
