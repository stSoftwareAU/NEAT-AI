export interface MemeticWeightInterface {
  toUUID: string;
  weight: number;
}

export interface MemeticBiasInterface {
  [neuronUUID: string]: number;
}

export interface MemeticWeightsInterface {
  [fromUUID: string]: MemeticWeightInterface[];
}

/**
 * A snapshot of memetic state from a previous generation.
 * Used to track the evolution of weights and biases over multiple generations.
 */
export interface MemeticAncestorSnapshot {
  generation: number;
  weights: MemeticWeightsInterface;
  biases: MemeticBiasInterface;
  score: number;
}

/**
 * Default maximum number of generations to track in ancestry.
 * This limits memory usage while providing enough history for trajectory analysis.
 */
export const DEFAULT_ANCESTRY_DEPTH = 3;

export interface MemeticInterface {
  generation: number;
  weights: MemeticWeightsInterface;
  biases: MemeticBiasInterface;
  score: number;

  /**
   * Optional array of ancestor snapshots, ordered from most recent to oldest.
   * Limited to DEFAULT_ANCESTRY_DEPTH entries to control memory usage.
   * Used for analysing weight/bias trajectories over multiple generations.
   */
  ancestry?: MemeticAncestorSnapshot[];
}
