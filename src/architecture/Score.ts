import { NetworkInternal } from "./NetworkInterfaces.ts";

export function calculate(
  creature: NetworkInternal,
  error: number,
  growthCost: number,
) {
  const { max, avg } = calculateMaxOutOfBounds(creature);
  const penalty = calculatePenalty(max, avg);
  const score = calculateScore(error, creature, penalty, growthCost);

  return Number.isFinite(score) ? score : -Infinity;
}

function calculateMaxOutOfBounds(
  creature: NetworkInternal,
): { max: number; avg: number } {
  let max = 0;
  let total = 0;
  let count = 0;

  for (const conn of creature.connections) {
    const w = Math.abs(conn.weight);
    if (w > max) {
      max = w;
    }
    total += w;
    count++;
  }

  for (const node of creature.nodes) {
    if (node.type != "input") {
      const b = node.bias ? Math.abs(node.bias) : 0;
      if (b > max) {
        max = b;
      }
      total += b;
      count++;
    }
  }

  const avgOutOfBounds = count > 0 ? total / count : 0;

  return { max: max, avg: avgOutOfBounds };
}

export function valuePenalty(value: number): number {
  if (value <= 1) return 0;

  const primaryPenalty = 1 / (1 + Math.exp(-Math.log(value)));

  if (primaryPenalty > 0.999) {
    const compressPenalty = 1 + valuePenalty(Math.log(value));

    return compressPenalty;
  } else {
    return primaryPenalty;
  }
}

function calculatePenalty(max: number, avg: number): number {
  const maxPenalty = valuePenalty(max);
  const avgPenalty = valuePenalty(avg);

  return maxPenalty + avgPenalty;
}

function calculateScore(
  error: number,
  creature: NetworkInternal,
  penalty: number,
  growthCost: number,
): number {
  const complexityCount = creature.nodes.length - creature.input -
    creature.output + creature.connections.length + penalty;

  const score = -error - complexityCount * growthCost;

  return score;
}
