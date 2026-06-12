/**
 * RandomImmigrantsConfig.ts - Configuration for random-immigrant injection
 * on a detected fitness plateau (Issue #2933).
 *
 * When a population stalls, perturbing the *existing* genomes (the job of
 * the adaptive mutation multiplier in {@link PlateauDetector}) adds no new
 * genetic material. Random immigrants are a classic, low-risk escape
 * mechanism: replace the weakest non-elite creatures with freshly seeded
 * genomes while always preserving the elites. This complements — rather
 * than replaces — mutation boosting.
 *
 * The controller is driven by the **existing** plateau signal: it injects
 * only when the population has been on a plateau for `triggerWindow`
 * generations, replaces a configurable `injectionFraction` of the
 * non-elite population, and waits `cooldown` generations between
 * injections to avoid thrashing.
 *
 * OFF by default — when `enabled` is `false`, no immigrants are injected
 * and evolution behaves exactly as before this issue.
 */

/**
 * Partial overrides for random-immigrant injection. All fields optional;
 * defaults from {@link DEFAULT_RANDOM_IMMIGRANTS_CONFIG} are applied for any
 * omitted field.
 */
export interface RandomImmigrantsConfig {
  /**
   * Whether random-immigrant injection is active. When `false` (the
   * default), no immigrants are injected and the population is unchanged.
   * Default: `false`.
   */
  enabled?: boolean;

  /**
   * Fraction of the **non-elite** population to replace with fresh genomes
   * on each injection, in the range `(0, 1]`. For example `0.1` replaces
   * the weakest 10% of the non-elite creatures. Elites are never replaced.
   * Default: `0.1`.
   */
  injectionFraction?: number;

  /**
   * Number of consecutive generations the population must be on a plateau
   * before the first injection fires. A larger window waits for a more
   * firmly established plateau before disrupting the population. Must be a
   * positive integer. Default: `5`.
   */
  triggerWindow?: number;

  /**
   * Minimum number of generations to wait after an injection before another
   * injection may fire, even while the plateau persists. Prevents repeated
   * injections from thrashing the population. Must be a non-negative
   * integer. Default: `10`.
   */
  cooldown?: number;
}

/**
 * Required version of {@link RandomImmigrantsConfig} with every field
 * populated. Produced by `createNeatConfig()` after defaults are applied.
 */
export type RequiredRandomImmigrantsConfig = Required<RandomImmigrantsConfig>;

/**
 * Default values for random-immigrant injection.
 *
 * Issue #2933: OFF by default (`enabled: false`) so existing behaviour and
 * tests are unchanged. Set `enabled: true` to escape a stagnation trap by
 * injecting fresh genetic material on a detected plateau.
 */
export const DEFAULT_RANDOM_IMMIGRANTS_CONFIG: RequiredRandomImmigrantsConfig =
  {
    enabled: false,
    injectionFraction: 0.1,
    triggerWindow: 5,
    cooldown: 10,
  };
