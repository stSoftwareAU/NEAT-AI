/**
 * NoveltyConfig.ts - Configuration for novelty (behavioural-diversity)
 * selection (Issue #2932).
 *
 * On **deceptive** problems pure fitness selection drives the population
 * into local optima where fitness stops improving and the effective pace
 * of evolution collapses. Novelty search (Lehman & Stanley, 2011) rewards
 * behavioural diversity instead of — or blended with — raw fitness, and is
 * a well-established accelerant for escaping deception.
 *
 * When `enabled`, each creature is given a **behaviour descriptor** (a
 * numeric vector, problem-supplied via a tag), a **novelty score** equal to
 * the mean distance to its *k* nearest neighbours across the current
 * population and a bounded **archive** of past behaviours, and ranking uses
 * the blend `score' = (1 - weight)·fitness + weight·novelty`.
 *
 * OFF by default — when `enabled` is `false`, ranking and selection behave
 * exactly as before this issue.
 */

/**
 * Partial overrides for novelty selection. All fields optional; defaults
 * from {@link DEFAULT_NOVELTY_CONFIG} are applied for any omitted field.
 */
export interface NoveltyConfig {
  /**
   * Whether novelty selection is active. When `false` (the default), no
   * behaviour descriptors are read, the archive stays empty, and ranking
   * uses raw fitness exactly as before. Default: `false`.
   */
  enabled?: boolean;

  /**
   * Blend weight `w` in `score' = (1 - w)·fitness + w·novelty`, in the
   * range `[0, 1]`. `0` is pure fitness, `1` is pure novelty. Default:
   * `0.5`.
   */
  weight?: number;

  /**
   * Number of nearest neighbours `k` used to compute the novelty score
   * (mean distance to the `k` closest behaviours across the population and
   * archive). Default: `15`.
   */
  neighbours?: number;

  /**
   * Maximum number of behaviour descriptors retained in the novelty
   * archive. When the cap is exceeded the oldest entries are evicted
   * (first-in, first-out). Default: `500`.
   */
  archiveLimit?: number;

  /**
   * Minimum novelty score a behaviour must reach before it is admitted to
   * the archive. `0` admits every evaluated behaviour (bounded by
   * `archiveLimit`); a higher value keeps only behaviours that are
   * genuinely novel relative to what has been seen. Default: `0`.
   */
  addThreshold?: number;

  /**
   * Name of the creature tag holding the behaviour descriptor — a
   * comma-separated list of finite numbers (for example the output vector
   * on a probe set), set by the problem's fitness function. Creatures
   * without a parseable descriptor contribute no novelty. Default:
   * `"behaviour"`.
   */
  behaviourTag?: string;
}

/**
 * Required version of {@link NoveltyConfig} with every field populated.
 * Produced by `createNeatConfig()` after defaults are applied.
 */
export type RequiredNoveltyConfig = Required<NoveltyConfig>;

/**
 * Default values for novelty selection.
 *
 * Issue #2932: OFF by default (`enabled: false`) so existing behaviour and
 * tests are unchanged. Set `enabled: true` and supply a behaviour
 * descriptor tag to escape deceptive landscapes.
 */
export const DEFAULT_NOVELTY_CONFIG: RequiredNoveltyConfig = {
  enabled: false,
  weight: 0.5,
  neighbours: 15,
  archiveLimit: 500,
  addThreshold: 0,
  behaviourTag: "behaviour",
};
