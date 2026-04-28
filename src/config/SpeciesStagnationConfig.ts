/**
 * SpeciesStagnationConfig.ts - Configuration for per-species stagnation
 * detection and breeding-budget reclamation (Issue #2454).
 *
 * Builds on per-species rolling statistics (Issue #2452) and per-species
 * breeding quotas (Issue #2453). Each generation, the best raw fitness
 * for every species is recorded. Species that fail to improve their best
 * raw fitness over a sliding window have their breeding share halved
 * (`haltWindow`); species flat for an even longer window are dropped
 * from the breeding pool entirely (`extinctionWindow`). Their members
 * may still survive via elitism but contribute no offspring. Reclaimed
 * slots are redistributed proportionally to the remaining species.
 */

/**
 * Configuration for species stagnation detection and breeding budget
 * reclamation.
 */
export interface SpeciesStagnationConfig {
  /**
   * Whether species stagnation detection is active. When `false`, breeding
   * quotas pass through unchanged (the previous Issue #2453 behaviour).
   * Default: `true`.
   */
  enabled?: boolean;

  /**
   * Number of consecutive generations without an improvement in best raw
   * fitness after which a species is considered stagnant ("halted") and
   * its breeding share is reduced by 50%. Must be >= 1.
   * Default: 15.
   */
  haltWindow?: number;

  /**
   * Number of consecutive generations without an improvement in best raw
   * fitness after which a species is considered "extinct" and dropped
   * from the breeding pool entirely for the next generation. Must be
   * greater than `haltWindow`.
   * Default: 25.
   */
  extinctionWindow?: number;
}

/**
 * Required version of {@link SpeciesStagnationConfig} with all fields
 * populated. Used internally by `createNeatConfig()` after defaults are
 * applied.
 */
export type RequiredSpeciesStagnationConfig = Required<SpeciesStagnationConfig>;

/**
 * Default values for species stagnation detection.
 *
 * Issue #2454: enabled by default so a stagnant species' breeding budget
 * is naturally reclaimed by species that are still progressing.
 */
export const DEFAULT_SPECIES_STAGNATION_CONFIG:
  RequiredSpeciesStagnationConfig = {
    enabled: true,
    haltWindow: 15,
    extinctionWindow: 25,
  };
