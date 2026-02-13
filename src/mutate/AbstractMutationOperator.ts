import type { Creature } from "../Creature.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";

/**
 * Abstract base class for mutation operators.
 *
 * Provides the shared creature reference and common helper methods used across
 * all mutation operators. Subclasses implement `performMutation()` with their
 * mutation-specific logic.
 *
 * Issue #1396: Extracts shared patterns from 12 mutation operator files to
 * reduce duplication and ensure consistent behaviour.
 */
export abstract class AbstractMutationOperator implements RadioactiveInterface {
  protected readonly creature: Creature;

  constructor(creature: Creature) {
    this.creature = creature;
  }

  /**
   * Implements RadioactiveInterface.mutate().
   * Delegates to the subclass-specific `performMutation()`.
   */
  public mutate(focusList?: number[]): boolean {
    return this.performMutation(focusList);
  }

  /**
   * Subclasses implement this with their mutation-specific logic.
   *
   * @param focusList - Optional list of neuron indices to focus on.
   * @returns true if the mutation changed the creature, false otherwise.
   */
  protected abstract performMutation(focusList?: number[]): boolean;

  /**
   * Selects a random hidden neuron index, respecting focus list constraints.
   *
   * This pattern is shared by SwapNeurons and other operators that need to
   * select a random hidden neuron. It uses attempt-based retry with focus
   * relaxation.
   *
   * @param focusList - Optional focus list for neuron selection.
   * @param maxAttempts - Maximum number of selection attempts (default 12).
   * @param relaxAfter - After this many attempts, relax focus constraint (default 6).
   * @returns The selected neuron index, or -1 if no valid neuron found.
   */
  protected selectRandomHiddenNeuronIndex(
    focusList?: number[],
    maxAttempts = 12,
    relaxAfter = 6,
  ): number {
    const creature = this.creature;
    const rng = getRandomNumberGenerator();
    const hiddenCount = creature.neurons.length - creature.input -
      creature.output;
    if (hiddenCount <= 0) return -1;

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      const index = Math.floor(rng.random() * hiddenCount) + creature.input;
      const neuron = creature.neurons[index];
      if (neuron.type !== "hidden") continue;
      if (
        !creature.inFocus(index, focusList) && attempts < relaxAfter
      ) {
        continue;
      }
      return index;
    }
    return -1;
  }

  /**
   * Selects a random non-input neuron index (hidden or output), skipping
   * constants and respecting focus constraints.
   *
   * This pattern is shared by ModBias and ModActivation which select from
   * all non-input neurons.
   *
   * @param focusList - Optional focus list for neuron selection.
   * @param maxAttempts - Maximum number of selection attempts (default 12).
   * @param relaxAfter - After this many attempts, relax focus constraint (default 6).
   * @returns The selected neuron index, or -1 if no valid neuron found.
   */
  protected selectRandomNonInputNeuronIndex(
    focusList?: number[],
    maxAttempts = 12,
    relaxAfter = 6,
  ): number {
    const creature = this.creature;
    const rng = getRandomNumberGenerator();

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      const index = Math.floor(
        rng.random() * (creature.neurons.length - creature.input) +
          creature.input,
      );
      const neuron = creature.neurons[index];
      if (neuron.type === "constant") continue;
      if (
        !creature.inFocus(index, focusList) && attempts < relaxAfter
      ) {
        continue;
      }
      return index;
    }
    return -1;
  }
}
