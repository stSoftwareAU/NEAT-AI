/**
 * Configuration for ensemble diversity scoring.
 *
 * Issue #1310: Reduce brittleness: Ensemble diversity scoring for species.
 *
 * This configuration controls how diversity is measured and encouraged
 * within species to reduce reliance on "brilliant but brittle" solutions.
 */

/**
 * Configuration for ensemble diversity scoring behaviour.
 */
export interface EnsembleDiversityConfig {
  /**
   * Whether ensemble diversity scoring is enabled.
   * When disabled, diversity calculations are skipped.
   * Default: false
   */
  enabled?: boolean;

  /**
   * Weight given to diversity in fitness adjustment (0-1).
   * Higher values make diversity more important relative to fitness.
   * Default: 0.15
   */
  diversityWeight?: number;

  /**
   * Weight given to weight variance in diversity calculation (0-1).
   * Default: 0.4
   */
  weightVarianceWeight?: number;

  /**
   * Weight given to squash function entropy in diversity calculation (0-1).
   * Default: 0.3
   */
  squashEntropyWeight?: number;

  /**
   * Weight given to topology diversity in diversity calculation (0-1).
   * Default: 0.3
   */
  topologyDiversityWeight?: number;

  /**
   * Whether to protect diverse low-performers from culling.
   * Default: false
   */
  protectDiverseLowPerformers?: boolean;

  /**
   * Diversity threshold above which creatures are protected from culling (0-1).
   * Default: 0.7
   */
  diversityProtectionThreshold?: number;

  /**
   * Diversity threshold below which cross-species breeding is triggered (0-1).
   * Default: 0.2
   */
  crossSpeciesBreedingThreshold?: number;

  /**
   * Threshold below which a species is considered to have low diversity (0-1).
   * Default: 0.3
   */
  lowDiversityThreshold?: number;

  /**
   * Weight given to genetic distance when preferring diverse parent combinations (0-1).
   * Default: 0.2
   */
  diverseParentPreferenceWeight?: number;
}

/**
 * Required version of EnsembleDiversityConfig with all fields populated.
 */
export type RequiredEnsembleDiversityConfig = Required<EnsembleDiversityConfig>;

/**
 * Default values for ensemble diversity configuration.
 */
export const DEFAULT_ENSEMBLE_DIVERSITY_CONFIG:
  RequiredEnsembleDiversityConfig = {
    enabled: false,
    diversityWeight: 0.15,
    weightVarianceWeight: 0.4,
    squashEntropyWeight: 0.3,
    topologyDiversityWeight: 0.3,
    protectDiverseLowPerformers: false,
    diversityProtectionThreshold: 0.7,
    crossSpeciesBreedingThreshold: 0.2,
    lowDiversityThreshold: 0.3,
    diverseParentPreferenceWeight: 0.2,
  };
