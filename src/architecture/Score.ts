import { NetworkInternal } from "./NetworkInterfaces.ts";

export function calculate(
  creature: NetworkInternal,
  error: number,
  growthCost: number,
) {
  const maxOutOfBounds = calculateMaxOutOfBounds(creature);
  const penalty = calculatePenalty(maxOutOfBounds);
  const score = calculateScore(error, creature, penalty, growthCost);

  return Number.isFinite(score) ? score : -Infinity;
}

function calculateMaxOutOfBounds(creature: NetworkInternal): number {
  let maxOutOfBounds = 0;
  for (const conn of creature.connections) {
    const w = Math.abs(conn.weight) - 1;
    if (w > 0) {
      maxOutOfBounds = Math.max(maxOutOfBounds, w);
    }
  }
  for (const node of creature.nodes) {
    if (node.type != "input") {
      const b = node.bias ? Math.abs(node.bias) - 1 : 0;
      if (b > 0) {
        maxOutOfBounds = Math.max(maxOutOfBounds, b);
      }
    }
  }
  return maxOutOfBounds;
}

function calculatePenalty(maxOutOfBounds: number): number {
  // Calculate the primary penalty using the Exponential function.
  // This penalty will be in the range [0, this.growth].
  const primaryPenalty = 1 - Math.exp(-maxOutOfBounds);

  // Initialize the multiplier to 1.
  // This will be used to increase the penalty if primaryPenalty is close to its maximum value.
  let multiplier = 1;

  // If the primaryPenalty is greater than 0.9 (choose an appropriate threshold),
  // apply an additional multiplier to penalize extremely large weights or biases.
  if (primaryPenalty > 0.9) {
    // Calculate the additional multiplier using a sigmoid function applied to the logarithm of maxOutOfBounds.
    // This will ensure that the multiplier is in the range (1, 2].
    multiplier += 1 / (1 + Math.exp(-Math.log(maxOutOfBounds + 1)));
    if (multiplier == 2) {
      multiplier += 1 / (1 + Math.exp(-Math.log(Math.log(maxOutOfBounds + 1))));
    }
  }

  // Calculate the final penalty as the product of the primary penalty and the multiplier.
  // This ensures that networks with extremely large weights or biases are penalized more heavily.
  const combinedPenalty = primaryPenalty * multiplier;

  return combinedPenalty;
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
