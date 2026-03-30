/**
 * HyperparameterEvolution.ts - Mutation and crossover for per-creature hyperparameters.
 *
 * Issue #1863: Encodes learning rate, mutation rates, and regularisation
 * strength as evolvable parameters that undergo mutation and crossover.
 */

import type {
  EvolvableHyperparameters,
  RequiredEvolvableHyperparameters,
  RequiredHyperparameterEvolutionConfig,
} from "@config/HyperparameterConfig.ts";
import { DEFAULT_EVOLVABLE_HYPERPARAMETERS } from "@config/HyperparameterConfig.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";

/**
 * Clamp a value within [min, max].
 */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Generate a Gaussian random number using the Box-Muller transform.
 */
function gaussianRandom(mean: number, stdDev: number): number {
  const rng = getRandomNumberGenerator();
  const u1 = rng.random();
  const u2 = rng.random();
  // Box-Muller transform
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) *
    Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

/**
 * Creates default hyperparameters for a new creature.
 * Optionally adds small random variation to encourage diversity.
 */
export function createDefaultHyperparameters(
  config: RequiredHyperparameterEvolutionConfig,
): RequiredEvolvableHyperparameters {
  if (!config.enabled) {
    return { ...DEFAULT_EVOLVABLE_HYPERPARAMETERS };
  }

  const rng = getRandomNumberGenerator();
  const defaults = DEFAULT_EVOLVABLE_HYPERPARAMETERS;

  // Add small random variation to initial values
  const lrRange = config.maxLearningRate - config.minLearningRate;
  const wpRange = config.maxWeightPerturbation - config.minWeightPerturbation;

  return {
    learningRate: clamp(
      defaults.learningRate + (rng.random() - 0.5) * lrRange * 0.2,
      config.minLearningRate,
      config.maxLearningRate,
    ),
    addNeuronRate: clamp(
      defaults.addNeuronRate + (rng.random() - 0.5) * 0.05,
      0,
      1,
    ),
    addConnectionRate: clamp(
      defaults.addConnectionRate + (rng.random() - 0.5) * 0.05,
      0,
      1,
    ),
    weightPerturbationScale: clamp(
      defaults.weightPerturbationScale + (rng.random() - 0.5) * wpRange * 0.2,
      config.minWeightPerturbation,
      config.maxWeightPerturbation,
    ),
    l1RegularisationStrength: clamp(
      defaults.l1RegularisationStrength +
        rng.random() * config.maxRegularisationStrength * 0.1,
      0,
      config.maxRegularisationStrength,
    ),
    l2RegularisationStrength: clamp(
      defaults.l2RegularisationStrength +
        rng.random() * config.maxRegularisationStrength * 0.1,
      0,
      config.maxRegularisationStrength,
    ),
  };
}

/**
 * Mutate a creature's hyperparameters using Gaussian perturbation.
 *
 * Each hyperparameter is independently perturbed by a small Gaussian noise
 * proportional to its valid range and the configured mutation standard deviation.
 */
export function mutateHyperparameters(
  current: RequiredEvolvableHyperparameters,
  config: RequiredHyperparameterEvolutionConfig,
): RequiredEvolvableHyperparameters {
  const stdDev = config.mutationStdDev;
  const lrRange = config.maxLearningRate - config.minLearningRate;
  const wpRange = config.maxWeightPerturbation - config.minWeightPerturbation;
  const regRange = config.maxRegularisationStrength;

  return {
    learningRate: clamp(
      gaussianRandom(current.learningRate, stdDev * lrRange),
      config.minLearningRate,
      config.maxLearningRate,
    ),
    addNeuronRate: clamp(
      gaussianRandom(current.addNeuronRate, stdDev * 0.5),
      0,
      1,
    ),
    addConnectionRate: clamp(
      gaussianRandom(current.addConnectionRate, stdDev * 0.5),
      0,
      1,
    ),
    weightPerturbationScale: clamp(
      gaussianRandom(current.weightPerturbationScale, stdDev * wpRange),
      config.minWeightPerturbation,
      config.maxWeightPerturbation,
    ),
    l1RegularisationStrength: clamp(
      gaussianRandom(
        current.l1RegularisationStrength,
        stdDev * regRange,
      ),
      0,
      config.maxRegularisationStrength,
    ),
    l2RegularisationStrength: clamp(
      gaussianRandom(
        current.l2RegularisationStrength,
        stdDev * regRange,
      ),
      0,
      config.maxRegularisationStrength,
    ),
  };
}

/**
 * Crossover hyperparameters from two parents.
 *
 * Uses weighted average with slight random bias towards the fitter parent.
 * Falls back to cloning the available parent if only one has hyperparameters.
 */
export function crossoverHyperparameters(
  motherParams: EvolvableHyperparameters | undefined,
  fatherParams: EvolvableHyperparameters | undefined,
  config: RequiredHyperparameterEvolutionConfig,
): RequiredEvolvableHyperparameters {
  const defaults = DEFAULT_EVOLVABLE_HYPERPARAMETERS;
  const rng = getRandomNumberGenerator();

  const mum: RequiredEvolvableHyperparameters = {
    ...defaults,
    ...motherParams,
  };
  const dad: RequiredEvolvableHyperparameters = {
    ...defaults,
    ...fatherParams,
  };

  // Random blend factor: slightly biased towards the mother (fitter parent)
  const blend = 0.4 + rng.random() * 0.2; // 0.4..0.6

  const blendValue = (
    a: number,
    b: number,
    min: number,
    max: number,
  ): number => {
    return clamp(a * blend + b * (1 - blend), min, max);
  };

  return {
    learningRate: blendValue(
      mum.learningRate,
      dad.learningRate,
      config.minLearningRate,
      config.maxLearningRate,
    ),
    addNeuronRate: blendValue(
      mum.addNeuronRate,
      dad.addNeuronRate,
      0,
      1,
    ),
    addConnectionRate: blendValue(
      mum.addConnectionRate,
      dad.addConnectionRate,
      0,
      1,
    ),
    weightPerturbationScale: blendValue(
      mum.weightPerturbationScale,
      dad.weightPerturbationScale,
      config.minWeightPerturbation,
      config.maxWeightPerturbation,
    ),
    l1RegularisationStrength: blendValue(
      mum.l1RegularisationStrength,
      dad.l1RegularisationStrength,
      0,
      config.maxRegularisationStrength,
    ),
    l2RegularisationStrength: blendValue(
      mum.l2RegularisationStrength,
      dad.l2RegularisationStrength,
      0,
      config.maxRegularisationStrength,
    ),
  };
}

/**
 * Compute species diversity as the fraction of distinct species in the population.
 *
 * Returns a value in [0, 1] where 0 means all creatures are in one species
 * and 1 means each creature is its own species.
 */
export function computeSpeciesDiversity(
  speciesCount: number,
  populationSize: number,
): number {
  if (populationSize <= 1) return 1;
  return Math.min(1, speciesCount / populationSize);
}
