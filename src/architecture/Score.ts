import { assert } from "@std/assert";
import type { CachedScoreComponents, Creature } from "@creature";
import { SEMANTIC_MAJOR_VERSION } from "@upgrade/Upgrade.ts";
import { getLogger } from "@utils/Logger.ts";
import {
  assertFiniteNonNegative,
  assertFiniteNumber,
} from "@utils/NumericValidation.ts";
import {
  wasmComputeScoreComponents,
  wasmScanMaxBias,
  wasmScanMaxWeight,
} from "@wasm/WasmStandaloneFunctions.ts";

/**
 * Calculates the fitness score for a creature based on its error and complexity.
 *
 * The score is computed as: 1 - error - complexityPenalty - versionPenalty
 * where complexityPenalty accounts for the number of hidden neurons, synapses,
 * and activation function complexity.
 *
 * Issue #1011: Weight/bias statistics are now cached to avoid redundant iterations
 * over synapses and neurons on every score calculation.
 *
 * @param creature - The creature to score
 * @param error - The error value from fitness evaluation
 * @param growthCost - The cost factor for network complexity
 * @returns A score between 0 and 1, where higher is better
 * @throws {Error} When input parameters are invalid (NaN, negative, etc.)
 *
 * @example
 * ```ts
 * const score = calculate(creature, 0.1, 0.0001);
 * getLogger().info(`Creature score: ${score}`);
 * ```
 */
export function calculate(
  creature: Creature,
  error: number,
  growthCost: number,
): number {
  assertFiniteNonNegative(error, "Error");

  // Get cached weight/bias statistics (Issue #1011)
  const cached = computeAndCacheScoreComponents(creature);
  const max = cached.maxWeightBias;
  const avg = cached.avgWeightBias;

  assertFiniteNumber(max, "Max");
  assertFiniteNumber(avg, "Avg");
  const penalty = calculatePenalty(max, avg);
  assertFiniteNumber(penalty, "Penalty");
  const score = calculateScore(error, creature, penalty, growthCost);

  assertFiniteNumber(score, "Score");
  return score;
}

/**
 * Calculates a penalty value based on the magnitude of a given value.
 *
 * This function applies a penalty that increases with the magnitude of the input,
 * encouraging the network to use smaller weights and biases. The penalty is
 * designed to prevent values from growing too large while still allowing
 * reasonable values.
 *
 * @param value - The value to calculate penalty for (must be non-negative)
 * @returns A penalty value between 0 and 1
 * @throws {Error} When the value is negative or non-finite
 *
 * @example
 * ```ts
 * const penalty = valuePenalty(10.5);
 * getLogger().info(`Penalty for value 10.5: ${penalty}`);
 * ```
 */
export function valuePenalty(value: number): number {
  assert(value >= 0, `Value: ${value} is negative`);
  if (value <= 1) return 0;

  assert(Number.isFinite(value), `Value: ${value} is not finite`);
  assert(value <= Number.MAX_SAFE_INTEGER, `Value: ${value} is too large`);

  const primaryPenalty = 1 / (1 + 1 / value); // Simplified from Math.exp(-Math.log(value))

  if (primaryPenalty > 0.999) {
    const compressPenalty = 0.999 + valuePenalty(Math.log(value)) / 1000;
    assert(
      compressPenalty < 1,
      `Compressed Penalty: ${compressPenalty} is greater than or equal to 1`,
    );
    return compressPenalty;
  }

  assert(
    primaryPenalty < 1,
    `Primary Penalty: ${primaryPenalty} is greater than or equal to 1`,
  );
  return primaryPenalty;
}

function calculatePenalty(max: number, avg: number): number {
  const penalty = (valuePenalty(max) + valuePenalty(avg)) / 2;

  assertFiniteNonNegative(penalty, "Penalty");
  assert(
    penalty < 1,
    `Penalty: ${penalty} is greater than or equal to 1`,
  );

  return penalty;
}

// Issue #2126: Module-level pooled buffers for extractWeights/extractBiases.
// Buffers grow as needed and return subarray views, avoiding per-call
// Float64Array allocations in the score update hot path.
// PR #2138: Pools now downsize when oversized (4x threshold) to prevent
// unbounded memory retention during coverage collection.
let _weightPool = new Float64Array(0);
let _biasPool = new Float64Array(0);

/**
 * Extracts flat Float64Array of synapse weights from a creature.
 * Issue #1521: Helper for WASM score scan functions.
 * Issue #2126: Uses pooled buffer to avoid per-call allocations.
 */
function extractWeights(creature: Creature): Float64Array {
  const synapses = creature.synapses;
  const len = synapses.length;
  if (_weightPool.length < len || _weightPool.length > len * 4) {
    _weightPool = new Float64Array(len);
  }
  for (let i = 0; i < len; i++) {
    _weightPool[i] = synapses[i].weight;
  }
  // Use slice (not subarray) when pool is oversized so WASM receives a
  // correctly-sized buffer — subarray views can expose the full underlying
  // ArrayBuffer to wasm-bindgen, causing stale data and incorrect counts.
  if (_weightPool.length === len) return _weightPool;
  return _weightPool.slice(0, len);
}

/**
 * Extracts flat Float64Array of non-input neuron biases from a creature.
 * Issue #1521: Helper for WASM score scan functions.
 * Issue #2126: Uses pooled buffer to avoid per-call allocations.
 */
function extractBiases(creature: Creature): Float64Array {
  const neurons = creature.neurons;
  const numBiases = neurons.length - creature.input;
  if (_biasPool.length < numBiases || _biasPool.length > numBiases * 4) {
    _biasPool = new Float64Array(numBiases);
  }
  for (let i = 0; i < numBiases; i++) {
    _biasPool[i] = neurons[creature.input + i].bias;
  }
  // Use slice (not subarray) when pool is oversized so WASM receives a
  // correctly-sized buffer — subarray views can expose the full underlying
  // ArrayBuffer to wasm-bindgen, causing stale data and incorrect counts.
  if (_biasPool.length === numBiases) return _biasPool;
  return _biasPool.slice(0, numBiases);
}

/**
 * Returns the current capacity of the pooled weight and bias buffers.
 * Issue #2126: Exported for testing pool growth and reuse behaviour.
 */
export function getPoolCapacities(): {
  weightCapacity: number;
  biasCapacity: number;
} {
  return {
    weightCapacity: _weightPool.length,
    biasCapacity: _biasPool.length,
  };
}

/**
 * Resets the pooled buffers to zero capacity.
 * Issue #2126: Exported for testing pool growth behaviour.
 */
export function resetPoolBuffers(): void {
  _weightPool = new Float64Array(0);
  _biasPool = new Float64Array(0);
}

/**
 * Computes and caches structure-dependent score components.
 * Issue #1023: Performance optimisation for large creatures.
 * Issue #1043: Uses Neuron.getComplexityPenalty() to leverage per-neuron caching.
 * Issue #1011: Also caches max/avg weight/bias statistics to avoid redundant
 * iterations over synapses and neurons.
 * Issue #1521: Uses WASM/SIMD for batch weight/bias statistics when available.
 *
 * @param creature - The creature to compute components for
 * @returns Cached score components
 */
function computeAndCacheScoreComponents(
  creature: Creature,
): CachedScoreComponents {
  // Check if cache is valid
  if (creature.cachedScoreComponents) {
    return creature.cachedScoreComponents;
  }

  // Compute structure-dependent values
  // Issue #1043: Use neuron's cached complexity penalty instead of calling
  // Activations.find() directly. The neuron caches the penalty and clears it
  // when setSquash() is called.
  let squashComplexityPenalty = 0;

  // Squash complexity must be computed in TS (depends on neuron type registry)
  const neurons = creature.neurons;
  const endIndex = neurons.length;
  for (let indx = creature.input; indx < endIndex; indx++) {
    squashComplexityPenalty += neurons[indx].getComplexityPenalty();
  }

  // Issue #1521: Try WASM/SIMD for batch weight/bias statistics
  let maxWeightBias: number;
  let secondMaxWeightBias: number;
  let totalWeightBias: number;
  let countWeightBias: number;

  const weights = extractWeights(creature);
  const biases = extractBiases(creature);
  const wasmResult = wasmComputeScoreComponents(weights, biases);

  if (wasmResult) {
    totalWeightBias = wasmResult.totalWeightBias;
    countWeightBias = wasmResult.countWeightBias;
    maxWeightBias = wasmResult.maxWeightBias;
    secondMaxWeightBias = wasmResult.secondMaxWeightBias;
  } else {
    // Fallback: compute in TypeScript
    maxWeightBias = 0;
    secondMaxWeightBias = 0;
    totalWeightBias = 0;
    countWeightBias = 0;

    // Iterate over synapses to gather weight statistics
    const synapses = creature.synapses;
    for (let i = 0, len = synapses.length; i < len; i++) {
      const synapse = synapses[i];
      assertFiniteNumber(synapse.weight, "Weight");
      const w = Math.abs(synapse.weight);
      if (w > maxWeightBias) {
        secondMaxWeightBias = maxWeightBias;
        maxWeightBias = w;
      } else if (w > secondMaxWeightBias) {
        secondMaxWeightBias = w;
      }
      totalWeightBias += w;
      countWeightBias++;
    }

    // Iterate over non-input neurons to gather bias statistics
    for (let indx = creature.input; indx < endIndex; indx++) {
      const neuron = neurons[indx];
      assertFiniteNumber(neuron.bias, "Bias");
      const b = Math.abs(neuron.bias);
      if (b > maxWeightBias) {
        secondMaxWeightBias = maxWeightBias;
        maxWeightBias = b;
      } else if (b > secondMaxWeightBias) {
        secondMaxWeightBias = b;
      }
      totalWeightBias += b;
      countWeightBias++;
    }
  }

  assert(countWeightBias > 0, "Count is 0");

  // Handle overflow protection.
  // Issue #2378: upgrade from info to warn and include the creature UUID
  // so the offending lineage can be traced in production logs. Previously
  // thousands of "Max is too large" info lines were emitted with no way to
  // identify which creature produced them.
  if (
    maxWeightBias > Number.MAX_SAFE_INTEGER ||
    totalWeightBias > Number.MAX_SAFE_INTEGER
  ) {
    getLogger().warn(
      `🚨 [Score] Weight/bias magnitude overflow on creature ` +
        `${creature.uuid ?? "unknown"}: ` +
        `max=${maxWeightBias}, total=${totalWeightBias}. ` +
        `Clamping to ±${Number.MAX_SAFE_INTEGER}.`,
    );
    if (maxWeightBias > Number.MAX_SAFE_INTEGER) {
      maxWeightBias = Number.MAX_SAFE_INTEGER;
    }
    if (totalWeightBias > Number.MAX_SAFE_INTEGER) {
      totalWeightBias = Number.MAX_SAFE_INTEGER;
    }
  }

  assertFiniteNonNegative(maxWeightBias, "Max");
  assertFiniteNonNegative(totalWeightBias, "Total");

  const avgWeightBias = countWeightBias > 0
    ? totalWeightBias / countWeightBias
    : 0;

  const hiddenNeuronCount = neurons.length - creature.input - creature.output;

  // Cache the computed values
  // Issue #1045: Also cache total and count for incremental updates
  // Issue #1442: Also cache secondMaxWeightBias for O(1) max recovery
  const cached: CachedScoreComponents = {
    hiddenNeuronCount,
    squashComplexityPenalty,
    maxWeightBias,
    avgWeightBias,
    totalWeightBias,
    countWeightBias,
    secondMaxWeightBias,
  };
  creature.cachedScoreComponents = cached;

  return cached;
}

function calculateScore(
  error: number,
  creature: Creature,
  penalty: number,
  growthCost: number,
): number {
  // Get or compute cached structure-dependent values
  const cached = computeAndCacheScoreComponents(creature);

  // Add squash complexity penalty to the weight/bias penalty
  const totalPenalty = penalty + cached.squashComplexityPenalty;

  const complexityPenalty = cached.hiddenNeuronCount * growthCost +
    creature.synapses.length * growthCost / 10 +
    totalPenalty * growthCost / 100;
  let versionPenalty = 0;
  if (
    !creature.semanticVersion ||
    !creature.semanticVersion.startsWith(`${SEMANTIC_MAJOR_VERSION}.`)
  ) {
    versionPenalty = 1e-6;
  }
  const score = 1 - error - complexityPenalty - versionPenalty;
  assert(score <= 1, `Score: ${score} is greater than 1`);

  return score;
}

/**
 * Incrementally updates the score after a single weight change.
 * Issue #1045: Avoid full recalculation for weight-only mutations.
 *
 * This function updates the cached weight/bias statistics incrementally
 * instead of iterating over all synapses and neurons.
 *
 * @param creature - The creature to score
 * @param error - The error value from fitness evaluation
 * @param growthCost - The cost factor for network complexity
 * @param oldWeight - The previous weight value
 * @param newWeight - The new weight value
 * @returns The updated score
 */
export function updateScoreForWeightChange(
  creature: Creature,
  error: number,
  growthCost: number,
  oldWeight: number,
  newWeight: number,
): number {
  assertFiniteNonNegative(error, "Error");
  assertFiniteNumber(oldWeight, "Old weight");
  assertFiniteNumber(newWeight, "New weight");

  // Ensure we have cached values; if not, compute them
  if (!creature.cachedScoreComponents) {
    computeAndCacheScoreComponents(creature);
  }

  const cached = creature.cachedScoreComponents!;

  // Calculate the change in total weight/bias
  const oldAbs = Math.abs(oldWeight);
  const newAbs = Math.abs(newWeight);
  const newTotal = cached.totalWeightBias - oldAbs + newAbs;

  // Update the average
  const newAvg = newTotal / cached.countWeightBias;

  // Update the max and secondMax
  // Issue #1442: Use secondMax for O(1) max recovery when possible.
  // secondMax < 0 means it is stale and cannot be trusted.
  let newMax = cached.maxWeightBias;
  let newSecondMax = cached.secondMaxWeightBias;

  if (newAbs > newMax) {
    // New value exceeds current max
    newSecondMax = newMax;
    newMax = newAbs;
  } else if (oldAbs === cached.maxWeightBias && newAbs < oldAbs) {
    // The old value was the max and is now smaller
    if (newSecondMax >= 0) {
      // Use the runner-up to avoid a full scan (O(1) instead of O(n))
      if (newAbs >= newSecondMax) {
        newMax = newAbs;
      } else {
        newMax = newSecondMax;
      }
      // secondMax is consumed; mark as stale
      newSecondMax = -1;
    } else {
      // secondMax is stale, must scan to find new max and secondMax
      const result = scanMaxForWeightChange(creature, oldWeight, newWeight);
      newMax = result.max;
      newSecondMax = result.secondMax;
    }
  } else {
    // Invalidate secondMax if the old value matched it and was reduced
    if (oldAbs === newSecondMax && newAbs < oldAbs) {
      newSecondMax = -1;
    }
    // Track new runner-up values
    if (newSecondMax >= 0 && newAbs > newSecondMax && newAbs < newMax) {
      newSecondMax = newAbs;
    }
  }

  // Update the cache with new values
  creature.cachedScoreComponents = {
    ...cached,
    maxWeightBias: newMax,
    avgWeightBias: newAvg,
    totalWeightBias: newTotal,
    secondMaxWeightBias: newSecondMax,
  };

  // Calculate penalty with new values
  const penalty = calculatePenalty(newMax, newAvg);
  return calculateScore(error, creature, penalty, growthCost);
}

/**
 * Incrementally updates the score after a single bias change.
 * Issue #1045: Avoid full recalculation for bias-only mutations.
 *
 * This function updates the cached weight/bias statistics incrementally
 * instead of iterating over all synapses and neurons.
 *
 * @param creature - The creature to score
 * @param error - The error value from fitness evaluation
 * @param growthCost - The cost factor for network complexity
 * @param oldBias - The previous bias value
 * @param newBias - The new bias value
 * @returns The updated score
 */
export function updateScoreForBiasChange(
  creature: Creature,
  error: number,
  growthCost: number,
  oldBias: number,
  newBias: number,
): number {
  assertFiniteNonNegative(error, "Error");
  assertFiniteNumber(oldBias, "Old bias");
  assertFiniteNumber(newBias, "New bias");

  // Ensure we have cached values; if not, compute them
  if (!creature.cachedScoreComponents) {
    computeAndCacheScoreComponents(creature);
  }

  const cached = creature.cachedScoreComponents!;

  // Calculate the change in total weight/bias
  const oldAbs = Math.abs(oldBias);
  const newAbs = Math.abs(newBias);
  const newTotal = cached.totalWeightBias - oldAbs + newAbs;

  // Update the average
  const newAvg = newTotal / cached.countWeightBias;

  // Update the max and secondMax
  // Issue #1442: Use secondMax for O(1) max recovery when possible.
  // secondMax < 0 means it is stale and cannot be trusted.
  let newMax = cached.maxWeightBias;
  let newSecondMax = cached.secondMaxWeightBias;

  if (newAbs > newMax) {
    // New value exceeds current max
    newSecondMax = newMax;
    newMax = newAbs;
  } else if (oldAbs === cached.maxWeightBias && newAbs < oldAbs) {
    // The old value was the max and is now smaller
    if (newSecondMax >= 0) {
      // Use the runner-up to avoid a full scan (O(1) instead of O(n))
      if (newAbs >= newSecondMax) {
        newMax = newAbs;
      } else {
        newMax = newSecondMax;
      }
      // secondMax is consumed; mark as stale
      newSecondMax = -1;
    } else {
      // secondMax is stale, must scan to find new max and secondMax
      const result = scanMaxForBiasChange(creature, oldBias, newBias);
      newMax = result.max;
      newSecondMax = result.secondMax;
    }
  } else {
    // Invalidate secondMax if the old value matched it and was reduced
    if (oldAbs === newSecondMax && newAbs < oldAbs) {
      newSecondMax = -1;
    }
    // Track new runner-up values
    if (newSecondMax >= 0 && newAbs > newSecondMax && newAbs < newMax) {
      newSecondMax = newAbs;
    }
  }

  // Update the cache with new values
  creature.cachedScoreComponents = {
    ...cached,
    maxWeightBias: newMax,
    avgWeightBias: newAvg,
    totalWeightBias: newTotal,
    secondMaxWeightBias: newSecondMax,
  };

  // Calculate penalty with new values
  const penalty = calculatePenalty(newMax, newAvg);
  return calculateScore(error, creature, penalty, growthCost);
}

/** Result of scanning for new max and second-max values. */
interface MaxScanResult {
  max: number;
  secondMax: number;
}

/**
 * Scans all weights and biases to find the new max and second-max after a
 * weight change when the old value was the previous maximum.
 * Issue #1045: Helper for incremental updates.
 * Issue #1442: Also returns secondMax to avoid future full scans.
 * Issue #1521: Uses WASM/SIMD when available.
 *
 * @param creature - The creature
 * @param oldWeight - The previous weight (being replaced)
 * @param newWeight - The new weight
 * @returns The new max and second-max values
 */
function scanMaxForWeightChange(
  creature: Creature,
  oldWeight: number,
  newWeight: number,
): MaxScanResult {
  // Issue #1521: Try WASM scan
  const synapses = creature.synapses;
  // Issue #2122: Direct for loop instead of .findIndex() to avoid closure overhead
  let excludeIdx = -1;
  for (let i = 0, len = synapses.length; i < len; i++) {
    if (synapses[i].weight === oldWeight) {
      excludeIdx = i;
      break;
    }
  }
  if (excludeIdx >= 0) {
    const weights = extractWeights(creature);
    const biases = extractBiases(creature);
    const wasmResult = wasmScanMaxWeight(
      weights,
      biases,
      excludeIdx,
      newWeight,
    );
    if (wasmResult) {
      return { max: wasmResult.max, secondMax: wasmResult.secondMax };
    }
  }

  // Fallback: TypeScript scan
  let max = Math.abs(newWeight);
  let secondMax = 0;

  // Check all synapses
  for (let i = 0, len = synapses.length; i < len; i++) {
    const w = synapses[i].weight;
    // Skip the synapse with the old weight (it's being replaced)
    if (w === oldWeight) continue;
    const absW = Math.abs(w);
    if (absW > max) {
      secondMax = max;
      max = absW;
    } else if (absW > secondMax) {
      secondMax = absW;
    }
  }

  // Check all non-input neuron biases
  const neurons = creature.neurons;
  for (let i = creature.input, len = neurons.length; i < len; i++) {
    const absB = Math.abs(neurons[i].bias);
    if (absB > max) {
      secondMax = max;
      max = absB;
    } else if (absB > secondMax) {
      secondMax = absB;
    }
  }

  return { max, secondMax };
}

/**
 * Scans all weights and biases to find the new max and second-max after a
 * bias change when the old value was the previous maximum.
 * Issue #1045: Helper for incremental updates.
 * Issue #1442: Also returns secondMax to avoid future full scans.
 * Issue #1521: Uses WASM/SIMD when available.
 *
 * @param creature - The creature
 * @param oldBias - The previous bias (being replaced)
 * @param newBias - The new bias
 * @returns The new max and second-max values
 */
function scanMaxForBiasChange(
  creature: Creature,
  oldBias: number,
  newBias: number,
): MaxScanResult {
  // Issue #1521: Try WASM scan
  const neurons = creature.neurons;
  // Issue #2122: Direct for loop instead of .slice().findIndex() to avoid
  // O(n) array allocation and closure overhead
  let biasOffset = -1;
  for (let i = creature.input, len = neurons.length; i < len; i++) {
    if (neurons[i].bias === oldBias) {
      biasOffset = i - creature.input;
      break;
    }
  }
  if (biasOffset >= 0) {
    const weights = extractWeights(creature);
    const biases = extractBiases(creature);
    const wasmResult = wasmScanMaxBias(weights, biases, biasOffset, newBias);
    if (wasmResult) {
      return { max: wasmResult.max, secondMax: wasmResult.secondMax };
    }
  }

  // Fallback: TypeScript scan
  let max = Math.abs(newBias);
  let secondMax = 0;

  // Check all synapses
  const synapses = creature.synapses;
  for (let i = 0, len = synapses.length; i < len; i++) {
    const absW = Math.abs(synapses[i].weight);
    if (absW > max) {
      secondMax = max;
      max = absW;
    } else if (absW > secondMax) {
      secondMax = absW;
    }
  }

  // Check all non-input neuron biases
  for (let i = creature.input, len = neurons.length; i < len; i++) {
    const b = neurons[i].bias;
    // Skip the neuron with the old bias (it's being replaced)
    if (b === oldBias) continue;
    const absB = Math.abs(b);
    if (absB > max) {
      secondMax = max;
      max = absB;
    } else if (absB > secondMax) {
      secondMax = absB;
    }
  }

  return { max, secondMax };
}
