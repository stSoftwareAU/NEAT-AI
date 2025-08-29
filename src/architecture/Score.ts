import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import { Activations } from "../methods/activations/Activations.ts";
import { SEMANTIC_MAJOR_VERSION } from "../upgrade/Upgrade.ts";

/**
 * Calculates the fitness score for a creature based on its error and complexity.
 *
 * The score is computed as: 1 - error - complexityPenalty - versionPenalty
 * where complexityPenalty accounts for the number of hidden neurons, synapses,
 * and activation function complexity.
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
  const { max, avg } = calculateMaxOutOfBounds(creature);
  assert(Number.isFinite(max), `Max: ${max} is not finite`);
  assert(Number.isFinite(avg), `Avg: ${avg} is not finite`);
  const penalty = calculatePenalty(max, avg);
  assert(Number.isFinite(penalty), `Penalty: ${penalty} is not finite`);
  const score = calculateScore(error, creature, penalty, growthCost);

  assert(Number.isFinite(score), `Score: ${score} is not finite`);
  return score;
}

function calculateMaxOutOfBounds(
  creature: Creature,
): { max: number; avg: number } {
  let max = 0;
  let total = 0;
  let count = 0;

  for (const synapse of creature.synapses) {
    assert(
      Number.isFinite(synapse.weight),
      `Weight: ${synapse.weight} is not finite`,
    );
    const w = Math.abs(synapse.weight);
    max = Math.max(max, w);
    total += w;
    count++;
  }

  for (const node of creature.neurons) {
    if (
      node.type !== "input"
    ) {
      assert(Number.isFinite(node.bias), `Bias: ${node.bias} is not finite`);
      const b = Math.abs(node.bias!);
      max = Math.max(max, b);
      total += b;
      count++;
    }
  }

  assert(count > 0, "Count is 0");

  if (max > Number.MAX_SAFE_INTEGER) {
    console.log("Max is too large", max);
  }
  if (total > Number.MAX_SAFE_INTEGER) {
    console.log("Total is too large", total);
  }
  if (max > Number.MAX_SAFE_INTEGER) max = Number.MAX_SAFE_INTEGER;
  if (total > Number.MAX_SAFE_INTEGER) total = Number.MAX_SAFE_INTEGER;

  assert(max >= 0, `Max: ${max} is negative`);
  assert(total >= 0, `Total: ${total} is negative`);

  const avg = count > 0 ? total / count : 0;

  return { max, avg };
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

function calculateScore(
  error: number,
  creature: Creature,
  penalty: number,
  growthCost: number,
): number {
  const endIndex = creature.neurons.length;
  for (let indx = creature.input; indx < endIndex; indx++) {
    const neuron = creature.neurons[indx];
    if (neuron.squash) {
      const squashFunction = Activations.find(
        neuron.squash,
      );
      if (squashFunction.complexityPenalty) {
        penalty += squashFunction.complexityPenalty;
      }
    }
  }

  const hiddenNeuronCount = creature.neurons.length - creature.input -
    creature.output;

  const complexityPenalty = hiddenNeuronCount * growthCost +
    creature.synapses.length * growthCost / 10 + penalty * growthCost / 100;
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
