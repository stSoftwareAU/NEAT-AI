/**
 * Represents the best squash function found for a specific neuron.
 *
 * @module
 */

/**
 * Information about the best squash function found for a neuron during
 * an Intelligent Design scan.
 */
export interface BestNeuronSquash {
  /** The squash function name that produced the best score */
  squash: string;
  /** The score achieved with this squash function */
  score: number;
  /** Path to the file where the improved creature was saved */
  path: string;
  /** Human-readable message describing the improvement */
  message: string;
}
