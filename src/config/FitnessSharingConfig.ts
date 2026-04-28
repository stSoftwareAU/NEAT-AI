/**
 * FitnessSharingConfig.ts - Configuration for NEAT fitness sharing
 * (Issue #2453).
 *
 * Standard NEAT (Stanley & Miikkulainen, 2002) divides fitness within a
 * species so that a single dominant species cannot starve smaller niches
 * of breeding slots. When `enabled`, parent selection ranks creatures by
 * adjusted fitness (raw / speciesSize), and breeding slots are allocated
 * to species in proportion to their summed adjusted fitness, with a
 * `minSpeciesSlots` floor so every non-empty species gets a chance.
 */

/**
 * Configuration for the fitness sharing behaviour.
 */
export interface FitnessSharingConfig {
  /**
   * Whether fitness sharing is active. When `false`, parent selection and
   * breeding-slot allocation behave exactly as before this issue
   * (raw-fitness only, no per-species quotas). Default: `true`.
   */
  enabled?: boolean;

  /**
   * Minimum breeding slots guaranteed to every non-empty species when
   * fitness sharing is enabled. Ensures small but novel niches always get
   * at least one chance to breed even if their share rounds to zero.
   * Default: `1`.
   */
  minSpeciesSlots?: number;
}

/**
 * Required version of {@link FitnessSharingConfig} with all fields
 * populated. Used internally by `createNeatConfig()` after defaults are
 * applied.
 */
export type RequiredFitnessSharingConfig = Required<FitnessSharingConfig>;

/**
 * Default values for fitness sharing.
 *
 * Issue #2453: enabled by default — the standard NEAT behaviour
 * documented in Stanley & Miikkulainen (2002). Set `enabled: false`
 * to restore the previous raw-fitness-only behaviour.
 */
export const DEFAULT_FITNESS_SHARING_CONFIG: RequiredFitnessSharingConfig = {
  enabled: true,
  minSpeciesSlots: 1,
};
