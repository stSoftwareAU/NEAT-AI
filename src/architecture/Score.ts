import { assert } from "@std/assert";
import type { CachedScoreComponents, Creature } from "../Creature.ts";
import { SEMANTIC_MAJOR_VERSION } from "../upgrade/Upgrade.ts";

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
 * console.log(`Creature score: ${score}`);
 * ```
 */
export function calculate(
  creature: Creature,
  error: number,
  growthCost: number,
): number {
  assert(!Number.isNaN(error), `Error is NaN`);
  assert(Number.isFinite(error), `Error is not finite`);
  assert(error >= 0, `Error: ${error} is negative`);

  // Get cached weight/bias statistics (Issue #1011)
  const cached = computeAndCacheScoreComponents(creature);
  const max = cached.maxWeightBias;
  const avg = cached.avgWeightBias;

  assert(Number.isFinite(max), `Max: ${max} is not finite`);
  assert(Number.isFinite(avg), `Avg: ${avg} is not finite`);
  const penalty = calculatePenalty(max, avg);
  assert(Number.isFinite(penalty), `Penalty: ${penalty} is not finite`);
  const score = calculateScore(error, creature, penalty, growthCost);

  assert(Number.isFinite(score), `Score: ${score} is not finite`);
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
 * console.log(`Penalty for value 10.5: ${penalty}`);
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

  assert(
    Number.isFinite(penalty),
    `Penalty: ${penalty} is not finite`,
  );
  assert(penalty >= 0, `Penalty: ${penalty} is negative`);
  assert(
    penalty < 1,
    `Penalty: ${penalty} is greater than or equal to 1`,
  );

  return penalty;
}

/**
 * Computes and caches structure-dependent score components.
 * Issue #1023: Performance optimisation for large creatures.
 * Issue #1043: Uses Neuron.getComplexityPenalty() to leverage per-neuron caching.
 * Issue #1011: Also caches max/avg weight/bias statistics to avoid redundant
 * iterations over synapses and neurons.
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

  // Issue #1011: Calculate max/avg weight/bias in the same pass as complexity penalty
  // This avoids a separate full iteration over synapses and neurons.
  let maxWeightBias = 0;
  let totalWeightBias = 0;
  let countWeightBias = 0;

  // Iterate over synapses to gather weight statistics
  const synapses = creature.synapses;
  for (let i = 0, len = synapses.length; i < len; i++) {
    const synapse = synapses[i];
    assert(
      Number.isFinite(synapse.weight),
      `Weight: ${synapse.weight} is not finite`,
    );
    const w = Math.abs(synapse.weight);
    if (w > maxWeightBias) maxWeightBias = w;
    totalWeightBias += w;
    countWeightBias++;
  }

  // Iterate over non-input neurons to gather bias statistics and complexity penalty
  const neurons = creature.neurons;
  const endIndex = neurons.length;
  for (let indx = creature.input; indx < endIndex; indx++) {
    const neuron = neurons[indx];
    squashComplexityPenalty += neuron.getComplexityPenalty();

    assert(Number.isFinite(neuron.bias), `Bias: ${neuron.bias} is not finite`);
    const b = Math.abs(neuron.bias);
    if (b > maxWeightBias) maxWeightBias = b;
    totalWeightBias += b;
    countWeightBias++;
  }

  assert(countWeightBias > 0, "Count is 0");

  // Handle overflow protection
  if (maxWeightBias > Number.MAX_SAFE_INTEGER) {
    console.log("Max is too large", maxWeightBias);
    maxWeightBias = Number.MAX_SAFE_INTEGER;
  }
  if (totalWeightBias > Number.MAX_SAFE_INTEGER) {
    console.log("Total is too large", totalWeightBias);
    totalWeightBias = Number.MAX_SAFE_INTEGER;
  }

  assert(maxWeightBias >= 0, `Max: ${maxWeightBias} is negative`);
  assert(totalWeightBias >= 0, `Total: ${totalWeightBias} is negative`);

  const avgWeightBias = countWeightBias > 0
    ? totalWeightBias / countWeightBias
    : 0;

  const hiddenNeuronCount = neurons.length - creature.input - creature.output;

  // Cache the computed values
  // Issue #1045: Also cache total and count for incremental updates
  const cached: CachedScoreComponents = {
    hiddenNeuronCount,
    squashComplexityPenalty,
    maxWeightBias,
    avgWeightBias,
    totalWeightBias,
    countWeightBias,
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
  assert(!Number.isNaN(error), `Error is NaN`);
  assert(Number.isFinite(error), `Error is not finite`);
  assert(error >= 0, `Error: ${error} is negative`);
  assert(Number.isFinite(oldWeight), `Old weight is not finite`);
  assert(Number.isFinite(newWeight), `New weight is not finite`);

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

  // Update the max - this requires more care
  // If newAbs is greater than current max, use newAbs
  // If oldAbs was the max and newAbs is smaller, we need to recalculate
  let newMax = cached.maxWeightBias;
  if (newAbs > newMax) {
    newMax = newAbs;
  } else if (oldAbs === cached.maxWeightBias && newAbs < oldAbs) {
    // The old value was the max and is now smaller, need to find new max
    // This is the slow path, but it's rare
    newMax = findNewMaxWeightBias(creature, oldWeight, newWeight);
  }

  // Update the cache with new values
  creature.cachedScoreComponents = {
    ...cached,
    maxWeightBias: newMax,
    avgWeightBias: newAvg,
    totalWeightBias: newTotal,
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
  assert(!Number.isNaN(error), `Error is NaN`);
  assert(Number.isFinite(error), `Error is not finite`);
  assert(error >= 0, `Error: ${error} is negative`);
  assert(Number.isFinite(oldBias), `Old bias is not finite`);
  assert(Number.isFinite(newBias), `New bias is not finite`);

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

  // Update the max - this requires more care
  // If newAbs is greater than current max, use newAbs
  // If oldAbs was the max and newAbs is smaller, we need to recalculate
  let newMax = cached.maxWeightBias;
  if (newAbs > newMax) {
    newMax = newAbs;
  } else if (oldAbs === cached.maxWeightBias && newAbs < oldAbs) {
    // The old value was the max and is now smaller, need to find new max
    // This is the slow path, but it's rare
    newMax = findNewMaxWeightBiasForBias(creature, oldBias, newBias);
  }

  // Update the cache with new values
  creature.cachedScoreComponents = {
    ...cached,
    maxWeightBias: newMax,
    avgWeightBias: newAvg,
    totalWeightBias: newTotal,
  };

  // Calculate penalty with new values
  const penalty = calculatePenalty(newMax, newAvg);
  return calculateScore(error, creature, penalty, growthCost);
}

/**
 * Finds the new maximum weight/bias after a weight change when the old value
 * was the previous maximum.
 * Issue #1045: Helper for incremental updates.
 *
 * @param creature - The creature
 * @param oldWeight - The previous weight (being replaced)
 * @param newWeight - The new weight
 * @returns The new maximum
 */
function findNewMaxWeightBias(
  creature: Creature,
  oldWeight: number,
  newWeight: number,
): number {
  let newMax = Math.abs(newWeight);

  // Check all synapses
  const synapses = creature.synapses;
  for (let i = 0, len = synapses.length; i < len; i++) {
    const w = synapses[i].weight;
    // Skip the synapse with the old weight (it's being replaced)
    if (w === oldWeight) continue;
    const absW = Math.abs(w);
    if (absW > newMax) newMax = absW;
  }

  // Check all non-input neuron biases
  const neurons = creature.neurons;
  for (let i = creature.input, len = neurons.length; i < len; i++) {
    const absB = Math.abs(neurons[i].bias);
    if (absB > newMax) newMax = absB;
  }

  return newMax;
}

/**
 * Finds the new maximum weight/bias after a bias change when the old value
 * was the previous maximum.
 * Issue #1045: Helper for incremental updates.
 *
 * @param creature - The creature
 * @param oldBias - The previous bias (being replaced)
 * @param newBias - The new bias
 * @returns The new maximum
 */
function findNewMaxWeightBiasForBias(
  creature: Creature,
  oldBias: number,
  newBias: number,
): number {
  let newMax = Math.abs(newBias);

  // Check all synapses
  const synapses = creature.synapses;
  for (let i = 0, len = synapses.length; i < len; i++) {
    const absW = Math.abs(synapses[i].weight);
    if (absW > newMax) newMax = absW;
  }

  // Check all non-input neuron biases
  const neurons = creature.neurons;
  for (let i = creature.input, len = neurons.length; i < len; i++) {
    const b = neurons[i].bias;
    // Skip the neuron with the old bias (it's being replaced)
    if (b === oldBias) continue;
    const absB = Math.abs(b);
    if (absB > newMax) newMax = absB;
  }

  return newMax;
}
