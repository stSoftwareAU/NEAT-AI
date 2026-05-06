/**
 * SpecialistConfig.ts - Specialist sub-population pipeline configuration
 * (Issue #2530).
 *
 * Mirrors DeepSeek V4's two-stage post-training pipeline at NEAT scale:
 *
 * - **Stage 1**: When the fitness function is multi-objective (M sub-tasks),
 *   seed M dedicated specialist species, each evolved against its own
 *   sub-task signal.
 * - **Stage 2**: Periodically distil the specialists into a generalist
 *   creature via the On-Policy Distillation (OPD) breed operator
 *   (Issue #2528) and inject the result back into the main population.
 *
 * The pipeline is **disabled by default** (`mode = "off"`) so existing
 * behaviour is preserved exactly.
 */

/**
 * Specialist pipeline mode.
 *
 * - `"off"` — pipeline is disabled (default). No specialist species are
 *   seeded; behaviour is unchanged.
 * - `"auto"` — when the cost function exposes sub-scores, one specialist
 *   species is seeded per declared sub-task at population init.
 * - `"manual"` — caller drives the pipeline explicitly via
 *   `SpecialistPipeline.seedSpecialistSpecies(...)`. The engine performs
 *   no automatic seeding.
 */
export type SpecialistMode = "off" | "auto" | "manual";

/**
 * Specialist sub-population pipeline configuration.
 *
 * All fields optional; defaults from {@link DEFAULT_SPECIALIST_CONFIG}
 * are applied during {@link createNeatConfig}.
 */
export interface SpecialistConfig {
  /**
   * Pipeline mode. Default `"off"` — disabled.
   *
   * @see SpecialistMode
   */
  mode?: SpecialistMode;

  /**
   * Cadence (in generations) at which the periodic generalist-distillation
   * step runs. Each elite specialist becomes a teacher for an OPD breed
   * call that produces a generalist offspring injected into the main
   * population. Default 25, minimum 1.
   */
  distillEveryN?: number;

  /**
   * Declared sub-task identifiers. When `mode = "auto"`, one specialist
   * species is seeded per id. When `mode = "manual"` the list is
   * advisory — callers may pass any task id to
   * `SpecialistPipeline.seedSpecialistSpecies`. Empty list disables the
   * pipeline silently regardless of `mode` (single-objective fitness).
   */
  subTaskIds?: readonly string[];

  /**
   * Minimum number of creatures per specialist species at seeding. If
   * the available population cannot supply this many specialists per
   * declared sub-task, the pipeline silently falls back to standard
   * speciation. Default 2, minimum 1.
   */
  minSpecialistsPerTask?: number;
}

/** Required version of {@link SpecialistConfig} with all fields populated. */
export type RequiredSpecialistConfig = {
  mode: SpecialistMode;
  distillEveryN: number;
  subTaskIds: readonly string[];
  minSpecialistsPerTask: number;
};

/** Default values for {@link SpecialistConfig}. */
export const DEFAULT_SPECIALIST_CONFIG: RequiredSpecialistConfig = {
  mode: "off",
  distillEveryN: 25,
  subTaskIds: [],
  minSpecialistsPerTask: 2,
};
