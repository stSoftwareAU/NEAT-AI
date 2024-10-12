import { assert } from "@std/assert/assert";
import type { CreatureInternal } from "./CreatureInterfaces.ts";

export function calculate(
  creature: CreatureInternal,
  error: number,
  growthCost: number,
): number {
  assert(Number.isFinite(error), `Error: ${error} is not finite`);
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
  creature: CreatureInternal,
): { max: number; avg: number } {
  let max = 0;
  let total = 0;
  let count = 0;

  for (const conn of creature.synapses) {
    assert(
      Number.isFinite(conn.weight),
      `Weight: ${conn.weight} is not finite`,
    );
    const w = Math.abs(conn.weight);
    max = Math.max(max, w);
    total += w;
    count++;
  }

  for (const node of creature.neurons) {
    if (
      node.type !== "input" // && node.bias !== undefined && node.bias !== null
    ) {
      assert(Number.isFinite(node.bias), `Bias: ${node.bias} is not finite`);
      const b = Math.abs(node.bias!);
      max = Math.max(max, b);
      total += b;
      count++;
    }
  }

  assert(count > 0, "Count is 0");

  if (Math.abs(max) > Number.MAX_SAFE_INTEGER) {
    console.log("Max is too large", max);
  }
  if (Math.abs(total) > Number.MAX_SAFE_INTEGER) {
    console.log("Total is too large", total);
  }
  if (max > Number.MAX_SAFE_INTEGER) max = Number.MAX_SAFE_INTEGER;
  if (total > Number.MAX_SAFE_INTEGER) total = Number.MAX_SAFE_INTEGER;
  if (max < Number.MIN_SAFE_INTEGER) max = Number.MIN_SAFE_INTEGER;
  if (total < Number.MIN_SAFE_INTEGER) total = Number.MIN_SAFE_INTEGER;

  const avg = count > 0 ? total / count : 0;

  return { max, avg };
}

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
      `Primary Penalty: ${compressPenalty} is greater than or equal to 1`,
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
    `Raw Penalty: ${penalty} is not finite`,
  );
  assert(penalty >= 0, `Raw Penalty: ${penalty} is negative`);
  assert(
    penalty < 1,
    `Raw Penalty: ${penalty} is greater than or equal to 1`,
  );

  return penalty;
}

function calculateScore(
  error: number,
  creature: CreatureInternal,
  penalty: number,
  growthCost: number,
): number {
  const hiddenNeuronCount = creature.neurons.length - creature.input -
    creature.output;
  const complexityCount = hiddenNeuronCount + creature.synapses.length +
    penalty;

  return -error - complexityCount * growthCost;
}
