/**
 * Type definitions for the memetic (local fine-tuning) record carried on a
 * creature.
 *
 * A `MemeticInterface` captures the per-neuron bias and per-synapse weight
 * deltas produced by fine-tuning, the generation and score they were recorded
 * at, and an optional bounded `ancestry` of earlier snapshots used for
 * trajectory analysis. These shapes are shared across the `@blackbox/`
 * fine-tune modules.
 *
 * @module
 */
export interface MemeticWeightInterface {
  toId: number;
  weight: number;
}

export interface MemeticBiasInterface {
  [neuronId: number]: number;
}

export interface MemeticWeightsInterface {
  [fromId: number]: MemeticWeightInterface[];
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
