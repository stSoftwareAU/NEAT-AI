/**
 * CompatibilityGatingConfig.ts - Configuration for the soft
 * compatibility-gated cross-species breeding probability (Issue #2455).
 *
 * Replaces the previous hard "lowest-compatibility father" pick used on
 * the diversity-driven breeding path with a soft probabilistic gate.
 * Each candidate father is accepted with probability
 * `compatibility ^ power`, so similar architectures (high compatibility)
 * dominate while rare exploratory hybrids still appear. After
 * `maxDraws` rejections the gate falls back to the lowest-compatibility
 * candidate (the prior selection behaviour) so the call always returns
 * a father.
 */

/**
 * Configuration for the soft compatibility gate applied to
 * diversity-driven father selection.
 */
export interface CompatibilityGatingConfig {
  /**
   * Whether the soft gate is active. When `false`, diversity-driven
   * father selection falls through to the legacy lowest-compatibility
   * pick exactly as before this issue. Default: `true`.
   */
  enabled?: boolean;

  /**
   * Power applied to the compatibility score when computing the
   * acceptance probability `compatibility ^ power`. Higher values bias
   * selection more strongly toward similar architectures. `power: 0`
   * disables the bias and recovers the prior selection distribution
   * (the gate reverts to the legacy lowest-compatibility pick).
   * Default: `1.5`.
   */
  power?: number;

  /**
   * Maximum number of probabilistic draws before the gate falls back
   * to the lowest-compatibility candidate. Bounds the loop so
   * selection always terminates. Default: `3`.
   */
  maxDraws?: number;
}

/**
 * Required version of {@link CompatibilityGatingConfig} with all fields
 * populated. Used internally by `createNeatConfig()` after defaults are
 * applied.
 */
export type RequiredCompatibilityGatingConfig = Required<
  CompatibilityGatingConfig
>;

/**
 * Default values for compatibility gating.
 *
 * Issue #2455: enabled by default with `power: 1.5` and `maxDraws: 3`,
 * tuned to favour compatible pairings while still allowing rare
 * exploratory hybrids. Set `enabled: false` or `power: 0` to restore
 * the prior lowest-compatibility selection behaviour.
 */
export const DEFAULT_COMPATIBILITY_GATING_CONFIG:
  RequiredCompatibilityGatingConfig = {
    enabled: true,
    power: 1.5,
    maxDraws: 3,
  };
