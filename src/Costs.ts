/*******************************************************************************
 **                                  COST FUNCTIONS
 ** https://en.wikipedia.org/wiki/Loss_function
 *******************************************************************************/

import { CrossEntropy } from "./costs/CrossEntropy.ts";
import { HINGE } from "./costs/HINGE.ts";
import { MAE } from "./costs/MAE.ts";
import { MAPE } from "./costs/MAPE.ts";
import { MSE } from "./costs/MSE.ts";
import { MSLE } from "./costs/MSLE.ts";

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

  /**
   * Serializes the cost function for worker communication.
   * Optional method - if not implemented, the cost function will be serialized using JSON.stringify.
   * For most custom cost functions, you can simply implement this as: return JSON.stringify(this);
   *
   * @returns Serialized representation of the cost function
   */
  serialize?(): string;
}

/**
 * Factory class for creating cost function instances.
 * Provides access to various loss functions used in neural network training.
 */
export class Costs {
  /** Registry of all cost functions (predefined + custom) */
  private static costRegistry = new Map<string, () => CostInterface>();

  /** Registry of custom cost functions */
  private static customCosts = new Map<string, CostInterface>();

  /**
   * Initialize the static cost registry with predefined cost functions
   */
  private static initializeRegistry(): void {
    if (this.costRegistry.size > 0) {
      return; // Already initialized
    }

    // Register predefined cost functions using their getName() method
    this.registerFromInstance(new CrossEntropy());
    this.registerFromInstance(new MSE());
    this.registerFromInstance(new MAE());
    this.registerFromInstance(new MAPE());
    this.registerFromInstance(new MSLE());
    this.registerFromInstance(new HINGE());
  }

  /**
   * Helper method to register a cost function from an instance.
   * Creates a factory function that returns a new instance each time.
   *
   * @param cost - The cost function instance to register
   */
  private static registerFromInstance(cost: CostInterface): void {
    const costClass = cost.constructor as new () => CostInterface;
    this.costRegistry.set(cost.getName(), () => new costClass());
  }

  /**
   * Registers a cost function using its getName() method as the key.
   * Creates a factory function that returns a new instance each time.
   *
   * @param cost - The cost function instance to register
   */
  static register(cost: CostInterface): void {
    this.initializeRegistry();
    this.registerFromInstance(cost);
  }

  /**
   * Registers a custom cost function that can be used by name.
   *
   * @param costFunction - The cost function instance to register
   */
  static registerCustomCost(costFunction: CostInterface): void {
    this.customCosts.set(costFunction.getName(), costFunction);
  }

  /**
   * Registers a cost function factory that creates instances on demand.
   * This is useful for cost functions that need to be instantiated fresh each time.
   *
   * @param name - The name to register the cost function under
   * @param factory - A function that creates a new cost function instance
   */
  static registerCostFactory(name: string, factory: () => CostInterface): void {
    this.initializeRegistry();
    this.costRegistry.set(name, factory);
  }

  /**
   * Finds and returns a cost function instance by name.
   *
   * @param name - The name of the cost function to retrieve
   * @returns A cost function instance implementing CostInterface
   * @throws {Error} When an unknown cost function name is provided
   */
  static find(name: string): CostInterface {
    this.initializeRegistry();

    // Check custom cost functions first (these are pre-instantiated)
    const customCost = this.customCosts.get(name);
    if (customCost) {
      return customCost;
    }

    // Check predefined cost functions
    const factory = this.costRegistry.get(name);
    if (typeof factory === "function") {
      return factory();
    }

    throw new Error(`Unknown cost function: ${name}`);
  }

  /**
   * Gets a list of all available cost function names.
   *
   * @returns Array of cost function names
   */
  static getAvailableCosts(): string[] {
    this.initializeRegistry();
    const predefined = Array.from(this.costRegistry.keys());
    const custom = Array.from(this.customCosts.keys());
    return [...predefined, ...custom];
  }
}
