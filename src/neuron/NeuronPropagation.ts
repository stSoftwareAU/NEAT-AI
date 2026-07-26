/**
 * NeuronPropagation.ts - Backpropagation and error distribution for neurons.
 *
 * Extracted from Neuron.ts (Issue #1599) to keep the Neuron class
 * under 500 lines and each module focused on a single responsibility.
 */

import type { Neuron } from "@architecture/Neuron.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";
import type { NeuronActivationInterface } from "@methods/activations/NeuronActivationInterface.ts";
import {
  type BackPropagationConfig,
  toValue,
} from "@propagate/BackPropagation.ts";
import {
  accumulateBias,
  adjustedBias,
  calculateBias,
} from "@propagate/Bias.ts";
import { distributeElasticErrorTyped } from "@propagate/ElasticDistribution.ts";
import { BackpropBuffers } from "@propagate/BackpropBuffers.ts";
import type { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import {
  accumulateWeight,
  adjustedWeight,
  calculateWeight,
} from "@propagate/Weight.ts";
import { coordinateBackpropUpdates } from "@propagate/BackpropCoordination.ts";
import { noChangePropagate } from "@architecture/NoChangePropagate.ts";
import { clampAndTrack } from "@utils/OverflowGuardStats.ts";
import {
  fusedErrorDistribution,
  squash as wasmSquash,
} from "@wasm/ActivationMethods.ts";
import { SquashType } from "@wasm/SquashType.ts";

/**
 * Update weights and bias using backpropagation results.
 *
 * Issue #1471: Calculate candidate weights and bias, then coordinate
 * opposing changes before applying them.
 */
export function propagateUpdate(
  neuron: Neuron,
  config: BackPropagationConfig,
): void {
  const state = neuron.creature.state;
  const toList = neuron.creature.inwardConnections(neuron.index);
  const listLength = toList.length;

  const coordinationEnabled = config.biasWeightCoordinationFactor < 1;

  if (!coordinationEnabled) {
    // Issue #3477: Coordination disabled — apply each candidate weight inline.
    // No per-neuron scratch arrays are needed: coordination never runs, so the
    // current-weight and source-activation buffers are dead. `calculateBias`
    // reads only accumulated neuron state (not connection weights), so applying
    // the weights before the bias is order-independent.
    for (let i = 0; i < listLength; i++) {
      const c = toList[i];
      const cs = state.connectionFor(c); // Issue #3089: cached state lookup
      // Issue #2421: Clamp proactively so runaway gradients cannot escape.
      c.weight = clampAndTrack(
        calculateWeight(cs, c, config),
        "training.weight",
        "propagateUpdate",
      );
    }
    neuron.bias = clampAndTrack(
      calculateBias(neuron, config),
      "training.bias",
      "propagateUpdate",
    );
    return;
  }

  // Issue #3477: Coordination enabled — gather candidates into pooled scratch
  // buffers (sized to the maximum fan-in) instead of allocating growable arrays
  // per neuron.
  let backpropBuffers = state.backpropBuffers;
  if (backpropBuffers === undefined) {
    backpropBuffers = new BackpropBuffers();
    state.backpropBuffers = backpropBuffers;
  }
  const buf = backpropBuffers.acquire(listLength);
  const currentWeights = buf.currentWeights;
  const candidateWeights = buf.candidateWeights;
  const sourceActivations = buf.sourceActivations;

  let minSynapseCount = Infinity;
  for (let i = 0; i < listLength; i++) {
    const c = toList[i];
    const cs = state.connectionFor(c); // Issue #3089: cached state lookup
    currentWeights[i] = c.weight;
    candidateWeights[i] = calculateWeight(cs, c, config);
    sourceActivations[i] = state.activations[c.from];
    if (cs.count < minSynapseCount) minSynapseCount = cs.count;
  }

  const candidateBias = calculateBias(neuron, config);

  // Only coordinate when we have enough accumulated samples for
  // reliable cancellation detection. With very few samples, the
  // gradient signals are too noisy for coordination to help.
  // Require at least one full batch of samples.
  const MIN_SAMPLES_FOR_COORDINATION = Math.max(config.batchSize, 4);
  if (minSynapseCount >= MIN_SAMPLES_FOR_COORDINATION) {
    const coordinated = coordinateBackpropUpdates(
      neuron.bias,
      candidateBias,
      currentWeights,
      candidateWeights,
      sourceActivations,
      config.biasWeightCoordinationFactor,
      listLength, // Issue #3477: pooled buffers may exceed the fan-in
    );

    // Issue #2421: Clamp proactively after backprop computes candidates so
    // runaway gradient magnitudes cannot escape a single training step.
    for (let i = 0; i < listLength; i++) {
      toList[i].weight = clampAndTrack(
        coordinated.weights[i],
        "training.weight",
        "propagateUpdate/coordinated",
      );
    }
    neuron.bias = clampAndTrack(
      coordinated.bias,
      "training.bias",
      "propagateUpdate/coordinated",
    );
  } else {
    for (let i = 0; i < listLength; i++) {
      toList[i].weight = clampAndTrack(
        candidateWeights[i],
        "training.weight",
        "propagateUpdate",
      );
    }
    neuron.bias = clampAndTrack(
      candidateBias,
      "training.bias",
      "propagateUpdate",
    );
  }

  backpropBuffers.release(buf);
}

/**
 * Back-propagate the known activation (learn).
 *
 * Issue #1377 - Fused backward pass error distribution in WASM.
 * Issue #1379 - Reusable buffer pool for backpropagation arrays.
 */
export function propagate(
  neuron: Neuron,
  requestedActivation: number,
  config: BackPropagationConfig,
  sparseConfig: SparseConfig,
): number {
  const activation = adjustedActivation(neuron, config);
  if (
    sparseConfig.propagateNeeded(neuron.id) === false
  ) {
    return activation;
  }
  const squashMethod = neuron.findSquash();
  const targetActivation = squashMethod.range.limit(requestedActivation);

  const state = neuron.creature.state;
  const rawErrorAbs = Math.abs(targetActivation - activation);
  if (
    rawErrorAbs < config.plankConstant
  ) {
    noChangePropagate(neuron, activation, config);
    state.cacheAdjustedActivation.set(neuron.index, activation);
    return targetActivation;
  }

  const ns = state.node(neuron.index);
  ns.totalErrorAbsolute += rawErrorAbs;

  const updateNeeded = sparseConfig.updateNeeded(neuron.id);

  /* this node is not changed if the update is not needed */
  ns.noChange = updateNeeded === false;

  let limitedActivation: number;

  const propagateUpdateMethod = squashMethod as NeuronActivationInterface;
  if (propagateUpdateMethod.propagate !== undefined) {
    limitedActivation = propagateUpdateMethod.propagate(
      neuron,
      targetActivation,
      config,
      sparseConfig,
    );
  } else {
    let targetValue: number | undefined;

    const currentBias = adjustedBias(neuron, config);
    let improvedValue = currentBias;
    const inwardList = neuron.creature.inwardConnections(neuron.index);

    const listLength = inwardList.length;

    if (listLength) {
      // Issue #1377 - Fused backward pass error distribution in WASM.
      // Combines calculateError + safeZoneAdjustment + elastic distribution
      // into a single WASM call, eliminating S+1 boundary crossings and
      // keeping all intermediate float values in WASM linear memory.
      //
      // For non-eligible synapses (self-loops, input/constant neurons), we
      // use values that produce correct behaviour in the fused function:
      // - Self-loops: activation=0 → elastic score=0 (excluded from distribution)
      // - Input/constant: squash=Identity → safeZone=1 (fully safe)

      // Issue #1379: Acquire reusable buffers instead of allocating fresh
      // arrays. The pool is stack-based so recursive propagate() calls each
      // get their own set.
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

      for (let indx = 0; indx < listLength; indx++) {
        const c = inwardList[indx];
        const { from, to } = c;

        if (from === to) {
          // Self-loop: activation=0 makes elastic score=0
          fromActivationCache[indx] = 0;
          fromWeightCache[indx] = 0;
          fromValueCache[indx] = 0;
          fusedSquashTypes[indx] = SquashType.Identity;
          fusedHintValues[indx] = 0;
          fusedActivations[indx] = 0;
          fusedWeights[indx] = 0;
          continue;
        }

        const fromNeuron = neuron.creature.neurons[from];
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
          sparseConfig.propagateNeeded(fromNeuron.id)
        ) {
          // Eligible: use actual squash type and hint value
          // Issue #1378: Use pre-computed cached squash type
          const fromNS = state.node(from);
          fusedSquashTypes[indx] = fromNeuron.cachedSquashType();
          fusedHintValues[indx] = fromNS.hintValue;
        } else {
          // Input/constant/non-propagated: Identity squash → safeZone=1
          fusedSquashTypes[indx] = SquashType.Identity;
          fusedHintValues[indx] = 0;
        }
      }

      // Single fused WASM call: calculateError + safeZoneAdjustment + elastic
      // Issue #1378: Use pre-computed cached squash type
      // Issue #1379: Pass correctly-sized views since buffers may be
      // larger than listLength.
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

      // Extract safe zone factors for recursion guards below.
      // Override self-loops to 0 (the fused function sees Identity which
      // returns 1.0, but self-loops must be blocked for hasUsableSafeZone).
      for (let i = 0; i < listLength; i++) {
        const c = inwardList[i];
        if (c.from === c.to) {
          safeZoneFactorCache[i] = 0;
        } else {
          safeZoneFactorCache[i] = fusedResult.safeZoneFactors[i];
        }
      }

      // If every upstream link is blocked by safe-zone (eg. parents are deep
      // in saturation), the fused function's elastic denominator collapses to
      // ~0 and it falls back to an equal split. However, we prefer the
      // activation²-only distribution (ignoring safe zones) for this case.
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
        // Fallback: ignore safe zones, use activation² only.
        // Include weight data for the weight-based fallback when activations
        // are near zero (Issue #1388).
        //
        // Issue #3477: Feed the already-populated typed scratch buffers
        // directly to the WASM ABI with a uniform safeZoneFactor of 1, instead
        // of repacking them into `listLength` `ElasticLink` objects. The fused
        // buffers already hold the exact float32 activation (`fusedActivations`)
        // and synapse weight (`fusedWeights`) values the object path would have
        // supplied — `distributeElasticError` truncates both to float32 anyway
        // — so the result is numerically identical with no per-link allocation.
        perLinkError = distributeElasticErrorTyped(
          error,
          fusedActivations.subarray(0, listLength),
          fusedWeights.subarray(0, listLength),
          1,
          { plankConstant: config.plankConstant },
        );
      }

      for (let indx = 0; indx < listLength; indx++) {
        const c = inwardList[indx];
        const { from, to } = c;

        if (from === to) continue;

        const fromNeuron = neuron.creature.neurons[from];

        const fromActivation = fromActivationCache[indx];
        const fromWeight = fromWeightCache[indx];
        if (Math.abs(fromWeight) <= config.plankConstant) continue;

        const fromValue = fromValueCache[indx];
        const thisLinkError = perLinkError[indx] ?? 0;
        const targetFromValue = fromValue + thisLinkError;

        let improvedFromActivation = fromActivation;

        const type = fromNeuron.type;
        if (
          type !== "input" &&
          type !== "constant" &&
          sparseConfig.propagateNeeded(fromNeuron.id) &&
          Math.abs(targetFromValue - fromValue) > config.plankConstant
        ) {
          const targetFromActivation = targetFromValue / fromWeight;
          // Training-time constraint:
          // Avoid recursing into parents when the implied activation target is
          // infeasible for their squash range (common when this link's weight
          // is tiny: (fromValue + share) / weight explodes).
          const safeZoneFactor = safeZoneFactorCache[indx] ?? 1;
          if (Number.isFinite(safeZoneFactor) && safeZoneFactor > 0) {
            const fromSquash = fromNeuron.findSquash();
            const range = fromSquash.range;
            const eps = 1e-9;
            const outOfRange = targetFromActivation < range.low - eps ||
              targetFromActivation > range.high + eps;
            if (!outOfRange && Number.isFinite(targetFromActivation)) {
              improvedFromActivation = propagate(
                fromNeuron,
                targetFromActivation,
                config,
                sparseConfig,
              );
            }
          }
        }

        if (
          updateNeeded &&
          Math.abs(improvedFromActivation) > config.plankConstant
        ) {
          const cs = state.connectionFor(c); // Issue #3089: cached state lookup
          accumulateWeight(
            c.weight,
            cs,
            targetFromValue,
            improvedFromActivation,
            config,
          );
          const aWeight = adjustedWeight(state, c, config);

          const improvedFromValue = improvedFromActivation * aWeight;
          improvedValue += improvedFromValue;
        }
      }

      // Issue #1379: Return buffers to the pool for reuse by subsequent
      // neurons or future training samples.
      backpropBuffers.release(buf);
    }

    if (updateNeeded) {
      targetValue = toValue(neuron, targetActivation, ns.hintValue);

      accumulateBias(
        ns,
        targetValue,
        improvedValue,
        currentBias,
        config,
      );

      const aBias = adjustedBias(neuron, config);
      // Issue #1143 - Use WASM squash when available
      limitedActivation = wasmSquash(
        neuron.squash!,
        improvedValue + aBias - currentBias,
      );
    } else {
      // Issue #1143 - Use WASM squash when available
      limitedActivation = wasmSquash(
        neuron.squash!,
        improvedValue,
      );
    }
  }

  if (updateNeeded) {
    ns.traceActivation(limitedActivation);
  }
  state.cacheAdjustedActivation.set(
    neuron.index,
    limitedActivation,
  );
  return limitedActivation;
}

/**
 * Gets the adjusted activation, using cache when available.
 */
export function adjustedActivation(
  neuron: Neuron,
  config: BackPropagationConfig,
): number {
  const state = neuron.creature.state;
  const cache = state.cacheAdjustedActivation;
  const cachedValue = cache.get(neuron.index);

  if (cachedValue !== undefined) {
    return cachedValue;
  }
  const value = rawAdjustedActivation(neuron, config);

  cache.set(neuron.index, value);
  return value;
}

/**
 * Calculates the raw adjusted activation based on the current state.
 */
export function rawAdjustedActivation(
  neuron: Neuron,
  config: BackPropagationConfig,
): number {
  const state = neuron.creature.state;
  if (neuron.type === "input") {
    return state.activations[neuron.index];
  } else if (neuron.type === "constant") {
    return neuron.bias;
  } else {
    const squashMethod = neuron.findSquash();
    if (
      (squashMethod as NeuronActivationInterface).activateAndTrace !== undefined
    ) {
      const activation = (squashMethod as NeuronActivationInterface).activate(
        neuron,
      );
      squashMethod.range.validate(activation);
      return activation;
    } else {
      // All activation sources coming from the node itself
      const toList = neuron.creature.inwardConnections(neuron.index);
      const aBias = adjustedBias(neuron, config);
      let value = aBias;

      for (let i = toList.length; i--;) {
        const c = toList[i];
        if (c.from === c.to) continue;
        const fromActivation = adjustedActivation(
          neuron.creature.neurons[c.from],
          config,
        );

        const fromWeight = adjustedWeight(
          state,
          c,
          config,
        );

        const fromValue = fromActivation * fromWeight;
        value += fromValue;
      }

      const activationSquash = squashMethod as ActivationInterface;
      // Squash the values received
      const activation = activationSquash.squash(value);
      activationSquash.range.validate(activation);

      return activation;
    }
  }
}
