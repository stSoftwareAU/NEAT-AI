import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import {
  DEFAULT_BIAS_REGULARISATION_CONFIG,
  type RequiredBiasRegularisationConfig,
} from "../config/BiasRegularisationConfig.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
import { AbstractMutationOperator } from "./AbstractMutationOperator.ts";

/**
 * Mutation operator that modifies neuron biases.
 *
 * Issue #1416: Enhanced with bias regularisation to prevent extreme values
 * that cause exploding activations. Supports:
 * - Hard limits on maximum absolute bias
 * - Hard limits on maximum bias change per mutation
 * - L2-style regularisation biasing towards smaller biases
 * - Small change preference reducing mutation magnitude
 */
export class ModBias extends AbstractMutationOperator {
  private config: RequiredBiasRegularisationConfig;

  /**
   * Creates a new ModBias mutation operator.
   *
   * @param creature - The creature to mutate
   * @param config - Optional bias regularisation configuration.
   *                 If not provided, uses sensible defaults.
   */
  constructor(
    creature: Creature,
    config?: RequiredBiasRegularisationConfig,
  ) {
    super(creature);
    this.config = config ?? DEFAULT_BIAS_REGULARISATION_CONFIG;
  }

  /**
   * Mutates a neuron bias with optional regularisation.
   */
  protected performMutation(focusList?: number[]): boolean {
    const index = this.selectRandomNonInputNeuronIndex(focusList);
    if (index === -1) return false;

    const neuron = this.creature.neurons[index];
    const oldBias = neuron.bias;

    // Calculate the new bias with regularisation
    const newBias = this.calculateRegularisedBias(oldBias);

    if (newBias !== oldBias) {
      neuron.bias = newBias;
      assert(Number.isFinite(neuron.bias), "bias must be a number");

      // Clear cached state, matching the side effects of Neuron.mutate()
      delete this.creature.uuid;
      this.creature.state.preparedNeurons = false;

      return true;
    }

    return false;
  }

  /**
   * Calculates a new regularised bias value.
   *
   * Issue #1416: Implements bias regularisation with:
   * 1. L2-style bias towards smaller biases
   * 2. Small change preference
   * 3. Hard limits on maximum absolute bias
   * 4. Hard limits on maximum bias change
   *
   * @param currentBias - The current bias value
   * @returns The new regularised bias value
   */
  private calculateRegularisedBias(currentBias: number): number {
    // If regularisation is disabled, use original logic
    if (!this.config.enabled) {
      return this.calculateUnregularisedBias(currentBias);
    }

    // Step 1: Calculate base modification using original quantum logic
    const biasMagnitude = Math.abs(currentBias);
    let quantum = 1;

    if (biasMagnitude >= 1) {
      // Find the largest power of 10 smaller than the biasMagnitude
      quantum = Math.pow(10, Math.floor(Math.log10(biasMagnitude)));
    }

    // Step 2: Apply small change preference if enabled
    if (this.config.preferSmallChanges) {
      // Scale down the quantum based on smallChangeScale
      // This biases mutations towards smaller changes
      quantum *= this.config.smallChangeScale;
    }

    // Step 3: Generate modification with L2 regularisation
    let modification = this.generateL2RegularisedModification(
      currentBias,
      quantum,
    );

    // Step 4: Enforce maximum bias change limit
    if (Math.abs(modification) > this.config.maxBiasChange) {
      modification = Math.sign(modification) * this.config.maxBiasChange;
    }

    // Step 5: Calculate and clamp the new bias
    let newBias = currentBias + modification;

    // Step 6: Enforce maximum absolute bias limit
    if (Math.abs(newBias) > this.config.maxAbsoluteBias) {
      newBias = Math.sign(newBias) * this.config.maxAbsoluteBias;
    }

    return newBias;
  }

  /**
   * Generates a modification biased by L2 regularisation.
   *
   * L2 regularisation penalises large bias magnitudes, encouraging
   * biases to move towards zero. The strength of this effect is
   * controlled by l2Strength (0 = no effect, 1 = strong pull to zero).
   *
   * @param currentBias - The current bias value
   * @param quantum - The base magnitude for the modification
   * @returns The regularised modification value
   */
  private generateL2RegularisedModification(
    currentBias: number,
    quantum: number,
  ): number {
    const rng = getRandomNumberGenerator();
    // Base random modification
    const baseModification = (rng.random() * 2 - 1) * quantum;

    if (this.config.l2Strength <= 0) {
      return baseModification;
    }

    // L2 regularisation: create a bias towards zero
    // The pull towards zero is proportional to the current bias magnitude
    // and the l2Strength parameter
    const l2Pull = -currentBias * this.config.l2Strength * rng.random();

    // Blend the base modification with the L2 pull
    // Higher l2Strength means more influence from the pull towards zero
    const blendFactor = this.config.l2Strength;
    const modification = baseModification * (1 - blendFactor) +
      l2Pull * blendFactor;

    return modification;
  }

  /**
   * Calculates bias modification using the original unregularised logic.
   *
   * This preserves backward compatibility when regularisation is disabled.
   *
   * @param currentBias - The current bias value
   * @returns The new bias value
   */
  private calculateUnregularisedBias(currentBias: number): number {
    const biasMagnitude = Math.abs(currentBias);
    let quantum = 1;

    if (biasMagnitude >= 1) {
      // Find the largest power of 10 smaller than the biasMagnitude
      quantum = Math.pow(10, Math.floor(Math.log10(biasMagnitude)));
    }

    // Generate a random modification value based on the quantum
    const modification = (getRandomNumberGenerator().random() * 2 - 1) *
      quantum;

    return currentBias + modification;
  }
}
