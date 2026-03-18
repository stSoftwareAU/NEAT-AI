/**
 * Configuration for per-creature evolvable hyperparameters.
 *
 * Issue #1863: Extend hyperparameter self-adaptation by encoding
 * learning rate, mutation rates, and regularisation strength as
 * per-creature evolvable parameters that are subject to mutation
 * and crossover like other genes.
 */

/**
 * Per-creature evolvable hyperparameters.
 *
 * These values are stored on each creature and evolve alongside
 * topology and weights. Creatures with better-suited hyperparameters
 * achieve higher fitness and propagate their settings.
 */
export interface EvolvableHyperparameters {
  /** Per-creature learning rate for backpropagation. Range: [minLearningRate, maxLearningRate]. */
  learningRate?: number;

  /** Per-creature probability of adding a neuron during mutation. Range: [0, 1]. */
  addNeuronRate?: number;

  /** Per-creature probability of adding a connection during mutation. Range: [0, 1]. */
  addConnectionRate?: number;

  /** Per-creature weight perturbation magnitude scaling factor. Range: [minWeightPerturbation, maxWeightPerturbation]. */
  weightPerturbationScale?: number;

  /** Per-creature L1 regularisation strength for backpropagation. Range: [0, maxRegularisationStrength]. */
  l1RegularisationStrength?: number;

  /** Per-creature L2 regularisation strength for backpropagation. Range: [0, maxRegularisationStrength]. */
  l2RegularisationStrength?: number;
}

/**
 * Required version with all fields populated.
 */
export type RequiredEvolvableHyperparameters = Required<
  EvolvableHyperparameters
>;

/**
 * Configuration bounds for hyperparameter evolution.
 */
export interface HyperparameterEvolutionConfig {
  /** Whether per-creature hyperparameter evolution is enabled. Default: false. */
  enabled?: boolean;

  /** Minimum learning rate. Default: 0.0001. */
  minLearningRate?: number;

  /** Maximum learning rate. Default: 0.1. */
  maxLearningRate?: number;

  /** Minimum weight perturbation scale. Default: 0.1. */
  minWeightPerturbation?: number;

  /** Maximum weight perturbation scale. Default: 2.0. */
  maxWeightPerturbation?: number;

  /** Maximum regularisation strength. Default: 0.1. */
  maxRegularisationStrength?: number;

  /**
   * Standard deviation for Gaussian mutation of hyperparameters.
   * Controls how much hyperparameters change per mutation event.
   * Default: 0.1 (10% of range).
   */
  mutationStdDev?: number;
}

/**
 * Required version with all fields populated.
 */
export type RequiredHyperparameterEvolutionConfig = Required<
  HyperparameterEvolutionConfig
>;

/**
 * Default evolvable hyperparameters for a new creature.
 */
export const DEFAULT_EVOLVABLE_HYPERPARAMETERS:
  RequiredEvolvableHyperparameters = {
    learningRate: 0.01,
    addNeuronRate: 0.1,
    addConnectionRate: 0.2,
    weightPerturbationScale: 1.0,
    l1RegularisationStrength: 0,
    l2RegularisationStrength: 0,
  };

/**
 * Default bounds for hyperparameter evolution.
 */
export const DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG:
  RequiredHyperparameterEvolutionConfig = {
    enabled: false,
    minLearningRate: 0.0001,
    maxLearningRate: 0.1,
    minWeightPerturbation: 0.1,
    maxWeightPerturbation: 2.0,
    maxRegularisationStrength: 0.1,
    mutationStdDev: 0.1,
  };
