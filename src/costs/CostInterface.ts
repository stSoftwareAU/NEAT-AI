/**
 * Interface for cost functions used in neural network training.
 * Defines the contract for calculating error between target and output values.
 */
export interface CostInterface {
  /**
   * Gets the name of the cost function.
   *
   * @returns The name of the cost function
   */
  getName(): string;

  /**
   * Calculates the cost/error between target and output values.
   *
   * @param target - The expected output values
   * @param output - The actual output values from the neural network
   * @returns The calculated cost/error value
   */
  calculate(target: Float32Array, output: Float32Array): number;
}
