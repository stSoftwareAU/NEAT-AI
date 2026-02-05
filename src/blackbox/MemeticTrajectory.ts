import type {
  MemeticAncestorSnapshot,
  MemeticInterface,
} from "./MemeticInterface.ts";

/**
 * Result of analysing the trajectory of a weight or bias over multiple generations.
 */
export interface TrajectoryAnalysis {
  /**
   * The direction of change: positive means increasing, negative means decreasing.
   * Magnitude indicates the average change per generation.
   */
  direction: number;

  /**
   * Consistency of the direction (0-1). Higher values indicate the weight
   * has been consistently moving in the same direction across generations.
   */
  consistency: number;

  /**
   * The values across generations, from oldest to newest.
   */
  values: number[];
}

/**
 * Momentum factor and related metadata for fine-tuning adjustments.
 */
export interface MomentumResult {
  /**
   * The momentum factor to apply. Range: 0.5 to 2.0
   * - > 1.0: Indicates consistent improvement, adjust more aggressively in direction
   * - = 1.0: Neutral, no momentum effect
   * - < 1.0: Inconsistent direction, be more conservative
   */
  factor: number;

  /**
   * The suggested direction based on trajectory.
   * Positive = increase, negative = decrease, 0 = no clear direction.
   */
  suggestedDirection: number;
}

/**
 * Collects weight values across generations from memetic ancestry.
 *
 * @param memetic - The memetic interface containing ancestry data
 * @param fromUUID - The source UUID of the weight
 * @param toUUID - The target UUID of the weight
 * @returns Array of weight values from oldest to newest generation, or undefined if not enough data
 */
function collectWeightValues(
  memetic: MemeticInterface,
  fromUUID: string,
  toUUID: string,
): number[] | undefined {
  const values: number[] = [];

  // Collect from ancestry (oldest first)
  if (memetic.ancestry) {
    for (let i = memetic.ancestry.length - 1; i >= 0; i--) {
      const ancestor = memetic.ancestry[i];
      const weightArray = ancestor.weights[fromUUID];
      if (weightArray) {
        const weightEntry = weightArray.find((w) => w.toUUID === toUUID);
        if (weightEntry) {
          values.push(weightEntry.weight);
        }
      }
    }
  }

  // Add current value
  const currentWeightArray = memetic.weights[fromUUID];
  if (currentWeightArray) {
    const currentWeight = currentWeightArray.find((w) => w.toUUID === toUUID);
    if (currentWeight) {
      values.push(currentWeight.weight);
    }
  }

  return values.length >= 2 ? values : undefined;
}

/**
 * Collects bias values across generations from memetic ancestry.
 *
 * @param memetic - The memetic interface containing ancestry data
 * @param neuronUUID - The UUID of the neuron
 * @returns Array of bias values from oldest to newest generation, or undefined if not enough data
 */
function collectBiasValues(
  memetic: MemeticInterface,
  neuronUUID: string,
): number[] | undefined {
  const values: number[] = [];

  // Collect from ancestry (oldest first)
  if (memetic.ancestry) {
    for (let i = memetic.ancestry.length - 1; i >= 0; i--) {
      const ancestor = memetic.ancestry[i];
      const bias = ancestor.biases[neuronUUID];
      if (bias !== undefined) {
        values.push(bias);
      }
    }
  }

  // Add current value
  const currentBias = memetic.biases[neuronUUID];
  if (currentBias !== undefined) {
    values.push(currentBias);
  }

  return values.length >= 2 ? values : undefined;
}

/**
 * Analyses the trajectory of a weight or bias over multiple generations.
 *
 * @param memetic - The memetic interface containing ancestry data
 * @param fromUUID - For weights: the source UUID. For biases: the neuron UUID.
 * @param toUUID - For weights: the target UUID. For biases: undefined.
 * @param isBias - Set to true when analysing bias trajectory
 * @returns TrajectoryAnalysis or undefined if not enough history
 */
export function analyseWeightTrajectory(
  memetic: MemeticInterface,
  fromUUID: string,
  toUUID?: string,
  isBias?: boolean,
): TrajectoryAnalysis | undefined {
  const values = isBias
    ? collectBiasValues(memetic, fromUUID)
    : toUUID
    ? collectWeightValues(memetic, fromUUID, toUUID)
    : undefined;

  if (!values || values.length < 2) {
    return undefined;
  }

  // Calculate differences between consecutive generations
  const differences: number[] = [];
  for (let i = 1; i < values.length; i++) {
    differences.push(values[i] - values[i - 1]);
  }

  // Calculate average direction
  const avgDiff = differences.reduce((sum, diff) => sum + diff, 0) /
    differences.length;

  // Calculate consistency: how often changes are in the same direction as average
  let sameDirectionCount = 0;
  for (const diff of differences) {
    if ((diff > 0 && avgDiff > 0) || (diff < 0 && avgDiff < 0)) {
      sameDirectionCount++;
    } else if (diff === 0 || avgDiff === 0) {
      // Neutral changes count as half consistent
      sameDirectionCount += 0.5;
    }
  }

  const consistency = sameDirectionCount / differences.length;

  return {
    direction: avgDiff,
    consistency,
    values,
  };
}

/**
 * Calculates a momentum factor for fine-tuning adjustments based on trajectory analysis.
 *
 * The momentum factor biases the quantum adjustment towards the direction of
 * consistent historical improvement. This helps the algorithm converge faster
 * when weights are consistently moving in the same direction.
 *
 * @param memetic - The memetic interface containing ancestry data
 * @param fromUUID - For weights: the source UUID. For biases: the neuron UUID.
 * @param toUUID - For weights: the target UUID. For biases: undefined.
 * @param isBias - Set to true when calculating momentum for bias
 * @returns MomentumResult or undefined if not enough history
 */
export function calculateTrajectoryMomentum(
  memetic: MemeticInterface,
  fromUUID: string,
  toUUID?: string,
  isBias?: boolean,
): MomentumResult | undefined {
  const trajectory = analyseWeightTrajectory(memetic, fromUUID, toUUID, isBias);

  if (!trajectory) {
    return undefined;
  }

  // Calculate momentum factor based on consistency
  // High consistency (0.8-1.0) => factor up to 2.0 (aggressive adjustment)
  // Medium consistency (0.5-0.8) => factor 1.0-1.5 (moderate adjustment)
  // Low consistency (0-0.5) => factor 0.5-1.0 (conservative adjustment)
  let factor: number;
  if (trajectory.consistency >= 0.8) {
    // Strong momentum: scale from 1.5 to 2.0
    factor = 1.5 + (trajectory.consistency - 0.8) * 2.5;
  } else if (trajectory.consistency >= 0.5) {
    // Moderate momentum: scale from 1.0 to 1.5
    factor = 1.0 + (trajectory.consistency - 0.5) * (1.5 / 0.3);
  } else {
    // Weak or opposing signals: scale from 0.5 to 1.0
    factor = 0.5 + trajectory.consistency;
  }

  // Clamp factor to valid range
  factor = Math.max(0.5, Math.min(2.0, factor));

  return {
    factor,
    suggestedDirection: trajectory.direction > 0
      ? 1
      : trajectory.direction < 0
      ? -1
      : 0,
  };
}

/**
 * Creates an ancestor snapshot from the current memetic state.
 *
 * @param memetic - The current memetic state to snapshot
 * @returns A snapshot suitable for storing in ancestry
 */
export function createAncestorSnapshot(
  memetic: MemeticInterface,
): MemeticAncestorSnapshot {
  return {
    generation: memetic.generation,
    weights: JSON.parse(JSON.stringify(memetic.weights)),
    biases: JSON.parse(JSON.stringify(memetic.biases)),
    score: memetic.score,
  };
}

/**
 * Adds a new ancestor to the ancestry array, maintaining the circular buffer behaviour.
 * Removes the oldest ancestor if the array exceeds maxDepth.
 *
 * @param ancestry - The current ancestry array (or undefined)
 * @param newAncestor - The new ancestor to add
 * @param maxDepth - Maximum number of ancestors to keep (default: 3)
 * @returns Updated ancestry array
 */
export function addToAncestry(
  ancestry: MemeticAncestorSnapshot[] | undefined,
  newAncestor: MemeticAncestorSnapshot,
  maxDepth: number = 3,
): MemeticAncestorSnapshot[] {
  const newAncestry = ancestry ? [...ancestry] : [];

  // Add new ancestor at the front (most recent first)
  newAncestry.unshift(newAncestor);

  // Trim to max depth (circular buffer behaviour)
  if (newAncestry.length > maxDepth) {
    newAncestry.length = maxDepth;
  }

  return newAncestry;
}
