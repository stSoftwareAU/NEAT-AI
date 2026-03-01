/**
 * TopologicalBackpropagation.ts - Iterative backpropagation using topological ordering.
 *
 * Issue #1641 - Replaces the recursive backpropagation traversal with an
 * iterative approach that processes neurons in reverse topological order.
 * Each neuron is visited exactly once, eliminating the combinatorial
 * explosion of revisits in densely connected networks.
 *
 * The recursive approach revisits neurons up to 700x on average (3000x+ max)
 * in large networks. This iterative approach accumulates all downstream
 * error signals for each neuron before processing it, achieving the same
 * gradient distribution in a single pass.
 */

import type { Creature } from "../Creature.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import { type BackPropagationConfig, toValue } from "./BackPropagation.ts";
import { accumulateBias, adjustedBias } from "./Bias.ts";
import { distributeElasticError } from "./ElasticDistribution.ts";
import type { SparseConfig } from "./sparse/SparseConfig.ts";
import { accumulateWeight, adjustedWeight } from "./Weight.ts";
import { noChangePropagate } from "../architecture/NoChangePropagate.ts";
import {
  fusedErrorDistribution,
  squash as wasmSquash,
} from "../wasm/ActivationMethods.ts";
import { SquashType } from "../wasm/SquashType.ts";
import { adjustedActivation } from "../neuron/NeuronPropagation.ts";
import { BackpropBuffers } from "./BackpropBuffers.ts";
import { computeReverseTopologicalOrder } from "./TopologicalOrder.ts";

/**
 * Propagate expected values backward through the network using
 * iterative topological ordering instead of recursive traversal.
 *
 * Each neuron is visited exactly once. Error signals from all downstream
 * paths are accumulated before processing, then distributed to upstream
 * connections in a single pass.
 */
export function propagateTopological(
  creature: Creature,
  expected: Float32Array,
  config: BackPropagationConfig,
  sparseConfig: SparseConfig,
): void {
  creature.state.cacheAdjustedActivation.clear();

  if (creature.state.backpropBuffers === undefined) {
    creature.state.backpropBuffers = new BackpropBuffers();
  }

  const neurons = creature.neurons;
  const neuronCount = neurons.length;
  const inputCount = creature.input;

  // Get reverse topological order (outputs first, then hidden toward inputs).
  const order = computeReverseTopologicalOrder(creature);

  // Accumulator: for each neuron, collect the sum of activation deltas
  // requested by all downstream connections.
  const targetDeltaSum = new Float64Array(neuronCount);
  const targetDeltaCount = new Uint32Array(neuronCount);

  // Seed output neurons with their expected values.
  const lastOutputIdx = neuronCount - creature.output;
  for (let i = 0; i < creature.output; i++) {
    const nodeIndex = lastOutputIdx + i;
    const n = neurons[nodeIndex];
    if (sparseConfig.propagateNeeded(n.uuid)) {
      const activation = adjustedActivation(n, config);
      targetDeltaSum[nodeIndex] = expected[i] - activation;
      targetDeltaCount[nodeIndex] = 1;
    }
  }

  // Process each neuron exactly once in reverse topological order.
  for (let orderIdx = 0; orderIdx < order.length; orderIdx++) {
    const neuronIndex = order[orderIdx];

    // Skip neurons with no accumulated error signal.
    if (targetDeltaCount[neuronIndex] === 0) continue;

    const neuron = neurons[neuronIndex];
    if (!sparseConfig.propagateNeeded(neuron.uuid)) continue;

    const activation = adjustedActivation(neuron, config);
    const squashMethod = neuron.findSquash();
    const downstreamCount = targetDeltaCount[neuronIndex];

    // Use the average delta for error distribution. This matches the
    // per-visit error magnitude from the recursive approach, where each
    // downstream path contributes one visit with its own error.
    const averageDelta = targetDeltaSum[neuronIndex] / downstreamCount;
    const requestedActivation = activation + averageDelta;
    const targetActivation = squashMethod.range.limit(requestedActivation);

    const rawErrorAbs = Math.abs(targetActivation - activation);
    if (rawErrorAbs < config.plankConstant) {
      noChangePropagate(neuron, activation, config);
      creature.state.cacheAdjustedActivation.set(neuronIndex, activation);
      continue;
    }

    const state = creature.state;
    const ns = state.node(neuronIndex);
    ns.totalErrorAbsolute += rawErrorAbs;

    const updateNeeded = sparseConfig.updateNeeded(neuron.uuid);
    ns.noChange = updateNeeded === false;

    let limitedActivation: number;

    // Check for custom propagate methods (IF, MAXIMUM, MINIMUM).
    // These have specialised backpropagation logic that we delegate to.
    const propagateUpdateMethod = squashMethod as NeuronActivationInterface;
    if (propagateUpdateMethod.propagate !== undefined) {
      // Fall back to the custom propagation for this neuron.
      // The custom method handles its own recursive traversal internally.
      limitedActivation = propagateUpdateMethod.propagate(
        neuron,
        targetActivation,
        config,
        sparseConfig,
      );
    } else {
      const currentBias = adjustedBias(neuron, config);
      let improvedValue = currentBias;
      const inwardList = creature.inwardConnections(neuronIndex);
      const listLength = inwardList.length;

      if (listLength) {
        const backpropBuffers = state.backpropBuffers!;
        const buf = backpropBuffers.acquire(listLength);
        const fromActivationCache = buf.fromActivationCache;
        const fromWeightCache = buf.fromWeightCache;
        const fromValueCache = buf.fromValueCache;
        const safeZoneFactorCache = buf.safeZoneFactorCache;
        const fusedSquashTypes = buf.fusedSquashTypes;
        const fusedHintValues = buf.fusedHintValues;
        const fusedActivations = buf.fusedActivations;
        const fusedWeights = buf.fusedWeights;

        // Build arrays for fused WASM error distribution call.
        for (let indx = 0; indx < listLength; indx++) {
          const c = inwardList[indx];
          const { from, to } = c;

          if (from === to) {
            fromActivationCache[indx] = 0;
            fromWeightCache[indx] = 0;
            fromValueCache[indx] = 0;
            fusedSquashTypes[indx] = SquashType.Identity;
            fusedHintValues[indx] = 0;
            fusedActivations[indx] = 0;
            fusedWeights[indx] = 0;
            continue;
          }

          const fromNeuron = neurons[from];
          const fromActivation = adjustedActivation(fromNeuron, config);
          const fromWeight = adjustedWeight(state, c, config);

          fromActivationCache[indx] = fromActivation;
          fromWeightCache[indx] = fromWeight;
          fromValueCache[indx] = fromWeight * fromActivation;
          fusedActivations[indx] = fromActivation;
          fusedWeights[indx] = fromWeight;

          const type = fromNeuron.type;
          if (
            type !== "input" &&
            type !== "constant" &&
            sparseConfig.propagateNeeded(fromNeuron.uuid)
          ) {
            const fromNS = state.node(from);
            fusedSquashTypes[indx] = fromNeuron.cachedSquashType();
            fusedHintValues[indx] = fromNS.hintValue;
          } else {
            fusedSquashTypes[indx] = SquashType.Identity;
            fusedHintValues[indx] = 0;
          }
        }

        // Single fused WASM call for error distribution.
        const fusedResult = fusedErrorDistribution(
          neuron.cachedSquashType(),
          activation,
          targetActivation,
          ns.hintValue,
          fusedSquashTypes.subarray(0, listLength),
          fusedHintValues.subarray(0, listLength),
          fusedActivations.subarray(0, listLength),
          fusedWeights.subarray(0, listLength),
        );

        const error = fusedResult.error;

        // Extract safe zone factors, blocking self-loops.
        for (let i = 0; i < listLength; i++) {
          const c = inwardList[i];
          if (c.from === c.to) {
            safeZoneFactorCache[i] = 0;
          } else {
            safeZoneFactorCache[i] = fusedResult.safeZoneFactors[i];
          }
        }

        // Handle safe zone collapse fallback.
        let perLinkError: Float32Array | number[];
        let hasUsableSafeZone = false;
        for (let i = 0; i < listLength; i++) {
          const safe = safeZoneFactorCache[i] ?? 1;
          if (Number.isFinite(safe) && safe > config.plankConstant) {
            hasUsableSafeZone = true;
            break;
          }
        }
        if (hasUsableSafeZone) {
          perLinkError = fusedResult.perLinkError;
        } else {
          const fallbackMeta = new Array(listLength);
          for (let i = 0; i < listLength; i++) {
            fallbackMeta[i] = {
              activation: fusedActivations[i],
              safeZoneFactor: 1,
              weight: fromWeightCache[i],
            };
          }
          perLinkError = distributeElasticError(error, fallbackMeta, {
            plankConstant: config.plankConstant,
          });
        }

        // Distribute error to inbound connections and accumulate upstream targets.
        for (let indx = 0; indx < listLength; indx++) {
          const c = inwardList[indx];
          const { from, to } = c;

          if (from === to) continue;

          const fromNeuron = neurons[from];
          const fromActivation = fromActivationCache[indx];
          const fromWeight = fromWeightCache[indx];
          if (Math.abs(fromWeight) <= config.plankConstant) continue;

          const fromValue = fromValueCache[indx];
          const thisLinkError = perLinkError[indx] ?? 0;
          const targetFromValue = fromValue + thisLinkError;

          const type = fromNeuron.type;
          if (
            type !== "input" &&
            type !== "constant" &&
            sparseConfig.propagateNeeded(fromNeuron.uuid) &&
            Math.abs(targetFromValue - fromValue) > config.plankConstant
          ) {
            const targetFromActivation = targetFromValue / fromWeight;
            const safeZoneFactor = safeZoneFactorCache[indx] ?? 1;
            if (Number.isFinite(safeZoneFactor) && safeZoneFactor > 0) {
              const fromSquash = fromNeuron.findSquash();
              const range = fromSquash.range;
              const eps = 1e-9;
              const outOfRange = targetFromActivation < range.low - eps ||
                targetFromActivation > range.high + eps;
              if (!outOfRange && Number.isFinite(targetFromActivation)) {
                // Instead of recursing, accumulate the target delta for the
                // upstream neuron. It will be processed later in the
                // topological order.
                if (from >= inputCount) {
                  targetDeltaSum[from] += targetFromActivation - fromActivation;
                  targetDeltaCount[from]++;
                }
              }
            }
          }

          // Accumulate weight using the current forward-pass activation.
          // Repeat downstreamCount times to match the recursive approach's
          // count behaviour, where each downstream path increments cs.count.
          if (
            updateNeeded &&
            Math.abs(fromActivation) > config.plankConstant
          ) {
            const cs = state.connection(from, to);
            for (let rep = 0; rep < downstreamCount; rep++) {
              accumulateWeight(
                c.weight,
                cs,
                targetFromValue,
                fromActivation,
                config,
              );
            }
            const aWeight = adjustedWeight(state, c, config);
            const improvedFromValue = fromActivation * aWeight;
            improvedValue += improvedFromValue;
          }
        }

        backpropBuffers.release(buf);
      }

      if (updateNeeded) {
        const targetValue = toValue(neuron, targetActivation, ns.hintValue);

        // Repeat downstreamCount times to match the recursive approach's
        // count behaviour, where each downstream path increments the count.
        for (let rep = 0; rep < downstreamCount; rep++) {
          accumulateBias(
            ns,
            targetValue,
            improvedValue,
            currentBias,
            config,
          );
        }

        const aBias = adjustedBias(neuron, config);
        limitedActivation = wasmSquash(
          neuron.squash!,
          improvedValue + aBias - currentBias,
        );
      } else {
        limitedActivation = wasmSquash(
          neuron.squash!,
          improvedValue,
        );
      }
    }

    if (updateNeeded) {
      ns.traceActivation(limitedActivation);
    }
    state.cacheAdjustedActivation.set(neuronIndex, limitedActivation);
  }
}
