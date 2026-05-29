/**
 * Issue #2791: resolve a sensible default for `trainPerGen` (the number of
 * creatures that receive a per-generation backpropagation step).
 *
 * The historical default of `1` starved supervised gradient training: with the
 * default population of 50 only a single creature per generation received any
 * gradient step, leaving the rest to rely on slow random weight mutation.
 *
 * When a labelled-dataset / regression-or-classification cost is in use we
 * therefore scale the default with `populationSize` so gradient descent covers
 * a meaningful fraction of the population. Custom or unrecognised costs (which
 * cannot be assumed to be supervised) keep the conservative default of `1`, so
 * evolution-only tasks see no change in behaviour.
 */

import {
  costNameToTaskDescriptor,
  OTHER_COST_NAME,
} from "@costs/CostTaskDescriptor.ts";

/**
 * Fraction of the population trained per generation for supervised costs.
 *
 * Chosen so the default population of 50 trains 10 creatures per generation —
 * a 10× lift in gradient coverage over the historical default of one creature.
 */
export const SUPERVISED_TRAIN_PER_GEN_FRACTION = 0.2;

/** Conservative default used for evolution-only / custom-cost tasks. */
export const EVOLUTION_ONLY_TRAIN_PER_GEN = 1;

/**
 * Compute the default `trainPerGen` for a configuration.
 *
 * @param populationSize - The configured population size (>= 2).
 * @param costName - The configured cost name (built-in or custom).
 * @returns The number of creatures to train per generation by default.
 *
 * - Recognised built-in supervised costs scale with the population:
 *   `max(1, round(populationSize * SUPERVISED_TRAIN_PER_GEN_FRACTION))`.
 * - Custom / unrecognised costs return {@link EVOLUTION_ONLY_TRAIN_PER_GEN}.
 *
 * The result never exceeds `populationSize` and is always at least 1.
 */
export function resolveDefaultTrainPerGen(
  populationSize: number,
  costName: string,
): number {
  const descriptor = costNameToTaskDescriptor(costName);
  if (descriptor.costName === OTHER_COST_NAME) {
    return EVOLUTION_ONLY_TRAIN_PER_GEN;
  }

  const scaled = Math.round(populationSize * SUPERVISED_TRAIN_PER_GEN_FRACTION);
  return Math.min(populationSize, Math.max(1, scaled));
}
