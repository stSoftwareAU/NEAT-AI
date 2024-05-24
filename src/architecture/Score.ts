import type { CreatureInternal } from "./CreatureInterfaces.ts";

export function calculate(
  creature: CreatureInternal,
  error: number,
  growthCost: number,
): number {
  const { max, avg } = calculateMaxOutOfBounds(creature);
  const penalty = calculatePenalty(max, avg);
  const score = calculateScore(error, creature, penalty, growthCost);

  return Number.isFinite(score) ? score : -Infinity;
}

function calculateMaxOutOfBounds(
  creature: CreatureInternal,
): { max: number; avg: number } {
  let max = 0;
  let total = 0;
  let count = 0;

  for (const conn of creature.synapses) {
    const w = Math.abs(conn.weight);
    max = Math.max(max, w);
    total += w;
    count++;
  }

  for (const node of creature.neurons) {
    if (
      node.type !== "input" && node.bias !== undefined && node.bias !== null
    ) {
      const b = Math.abs(node.bias);
      max = Math.max(max, b);
      total += b;
      count++;
    }
  }

  const avg = count > 0 ? total / count : 0;

  return { max, avg };
}

export function valuePenalty(value: number): number {
  if (value <= 1) return 0;

  const primaryPenalty = 1 / (1 + 1 / value); // Simplified from Math.exp(-Math.log(value))

  if (primaryPenalty > 0.999) {
    const compressPenalty = 1 + valuePenalty(Math.log(value));
    return compressPenalty;
  }

  return primaryPenalty;
}

function calculatePenalty(max: number, avg: number): number {
  return valuePenalty(max) + valuePenalty(avg);
}

function calculateScore(
  error: number,
  creature: CreatureInternal,
  penalty: number,
  growthCost: number,
): number {
  const complexityCount = creature.neurons.length - creature.input -
    creature.output + creature.synapses.length + penalty;

  return -error - complexityCount * growthCost;
}
