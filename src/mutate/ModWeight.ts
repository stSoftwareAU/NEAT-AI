import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import type { Synapse } from "../architecture/Synapse.ts";
import {
  DEFAULT_WEIGHT_REGULARISATION_CONFIG,
  type RequiredWeightRegularisationConfig,
} from "../config/WeightRegularisationConfig.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
import { AbstractMutationOperator } from "./AbstractMutationOperator.ts";

/**
 * Mutation operator that modifies synapse weights.
 *
 * Issue #1309: Enhanced with weight regularisation to prevent extreme values
 * that cause brittleness. Supports:
 * - Hard limits on maximum absolute weight
 * - Hard limits on maximum weight change per mutation
 * - L2-style regularisation biasing towards smaller weights
 * - Small change preference reducing mutation magnitude
 */
export class ModWeight extends AbstractMutationOperator {
  private config: RequiredWeightRegularisationConfig;

  /**
   * Creates a new ModWeight mutation operator.
   *
   * @param creature - The creature to mutate
   * @param config - Optional weight regularisation configuration.
   *                 If not provided, uses sensible defaults.
   */
  constructor(
    creature: Creature,
    config?: RequiredWeightRegularisationConfig,
  ) {
    super(creature);
    this.config = config ?? DEFAULT_WEIGHT_REGULARISATION_CONFIG;
  }

  /**
   * Mutates a synapse weight with optional regularisation.
   */
  protected performMutation(focusList?: number[]): boolean {
    let relevantConnections: Synapse[];

    if (!focusList || focusList.length === 0) {
      // No focus - use all connections
      relevantConnections = this.creature.synapses;
    } else {
      // Collect synapses connected to focused neurons using indexed lookups
      // This is O(focusList.length * (log n + k)) instead of O(synapses * focusList)
      const seen = new Set<Synapse>();
      for (const focusIndex of focusList) {
        // Get outward connections from focus neuron
        for (const syn of this.creature.outwardConnections(focusIndex)) {
          seen.add(syn);
        }
        // Get inward connections to focus neuron
        for (const syn of this.creature.inwardConnections(focusIndex)) {
          seen.add(syn);
        }
      }
      relevantConnections = Array.from(seen);
    }

    let changed = false;
    if (relevantConnections.length > 0) {
      const indx = Math.floor(
        getRandomNumberGenerator().random() * relevantConnections.length,
      );
      const connection = relevantConnections[indx];

      // Calculate the new weight with regularisation
      const newWeight = this.calculateRegularisedWeight(connection.weight);

      if (newWeight !== connection.weight) {
        connection.weight = newWeight;
        assert(Number.isFinite(connection.weight), "weight must be a number");
        changed = true;
      }
    }

    return changed;
  }

  /**
   * Calculates a new regularised weight value.
   *
   * Issue #1309: Implements weight regularisation with:
   * 1. L2-style bias towards smaller weights
   * 2. Small change preference
   * 3. Hard limits on maximum absolute weight
   * 4. Hard limits on maximum weight change
   *
   * @param currentWeight - The current weight value
   * @returns The new regularised weight value
   */
  private calculateRegularisedWeight(currentWeight: number): number {
    // If regularisation is disabled, use original logic
    if (!this.config.enabled) {
      return this.calculateUnregularisedWeight(currentWeight);
    }

    // Step 1: Calculate base modification using original quantum logic
    const weightMagnitude = Math.abs(currentWeight);
    let quantum = 1;

    if (weightMagnitude >= 1) {
      // Find the largest power of 10 smaller than the weightMagnitude
      quantum = Math.pow(10, Math.floor(Math.log10(weightMagnitude)));
    }

    // Step 2: Apply small change preference if enabled
    if (this.config.preferSmallChanges) {
      // Scale down the quantum based on smallChangeScale
      // This biases mutations towards smaller changes
      quantum *= this.config.smallChangeScale;
    }

    // Step 3: Generate modification with L2 regularisation
    let modification = this.generateL2RegularisedModification(
      currentWeight,
      quantum,
    );

    // Step 4: Enforce maximum weight change limit
    if (Math.abs(modification) > this.config.maxWeightChange) {
      modification = Math.sign(modification) * this.config.maxWeightChange;
    }

    // Step 5: Calculate and clamp the new weight
    let newWeight = currentWeight + modification;

    // Step 6: Enforce maximum absolute weight limit
    if (Math.abs(newWeight) > this.config.maxAbsoluteWeight) {
      newWeight = Math.sign(newWeight) * this.config.maxAbsoluteWeight;
    }

    return newWeight;
  }

  /**
   * Generates a modification biased by L2 regularisation.
   *
   * L2 regularisation penalises large weight magnitudes, encouraging
   * weights to move towards zero. The strength of this effect is
   * controlled by l2Strength (0 = no effect, 1 = strong pull to zero).
   *
   * @param currentWeight - The current weight value
   * @param quantum - The base magnitude for the modification
   * @returns The regularised modification value
   */
  private generateL2RegularisedModification(
    currentWeight: number,
    quantum: number,
  ): number {
    const rng = getRandomNumberGenerator();
    // Base random modification
    const baseModification = (rng.random() * 2 - 1) * quantum;

    if (this.config.l2Strength <= 0) {
      return baseModification;
    }

    // L2 regularisation: create a bias towards zero
    // The pull towards zero is proportional to the current weight magnitude
    // and the l2Strength parameter
    const l2Pull = -currentWeight * this.config.l2Strength * rng.random();

    // Blend the base modification with the L2 pull
    // Higher l2Strength means more influence from the pull towards zero
    const blendFactor = this.config.l2Strength;
    const modification = baseModification * (1 - blendFactor) +
      l2Pull * blendFactor;

    return modification;
  }

  /**
   * Calculates weight modification using the original unregularised logic.
   *
   * This preserves backward compatibility when regularisation is disabled.
   *
   * @param currentWeight - The current weight value
   * @returns The new weight value
   */
  private calculateUnregularisedWeight(currentWeight: number): number {
    const weightMagnitude = Math.abs(currentWeight);
    let quantum = 1;

    if (weightMagnitude >= 1) {
      // Find the largest power of 10 smaller than the weightMagnitude
      quantum = Math.pow(10, Math.floor(Math.log10(weightMagnitude)));
    }

    // Generate a random modification value based on the quantum
    const modification = (getRandomNumberGenerator().random() * 2 - 1) *
      quantum;

    return currentWeight + modification;
  }
}
