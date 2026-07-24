/**
 * Run-level tuning statistics recorded on every `evolve*` result (Issue #3422).
 *
 * Production evolution runs on a range of hardware and configurations; Nigel
 * wants each run self-contained enough to compare configurations across
 * machines and judge which gives the best rate of score improvement. The
 * existing result already reports `error`, `score`, `generation`, `time`,
 * `phaseTimingTotals` and `scorerUtilisation`; this group adds the missing
 * tuning inputs — the population size, the caller-requested options, the
 * hardware it ran on, and a milestone summary of the score-improvement curve.
 *
 * Judging "optimal" (most variants checked per hour, best rate of score gain)
 * happens downstream from these fields; this module only records the data.
 */

import type { PhaseTimingTotals } from "@creature/PhaseTimingTotals.ts";
import type { ScorerUtilisationTotals } from "@creature/ScorerUtilisationTotals.ts";
import {
  captureHardwareDescriptors,
  type HardwareDescriptors,
} from "@creature/EvolveHardwareDescriptors.ts";
import {
  type OptionsEcho,
  serialiseOptionsEcho,
} from "@creature/EvolveOptionsEcho.ts";
import {
  finaliseScoreImprovementMilestones,
  type ScoreImprovementMilestones,
  type ScoreTrajectory,
} from "@creature/ScoreImprovementMilestones.ts";

export type { HardwareDescriptors } from "@creature/EvolveHardwareDescriptors.ts";
export type { OptionsEcho } from "@creature/EvolveOptionsEcho.ts";
export type {
  ScoreImprovementMilestone,
  ScoreImprovementMilestones,
} from "@creature/ScoreImprovementMilestones.ts";

/** The tuning-statistics group added to every `evolve*` result (Issue #3422). */
export interface EvolveRunStatistics {
  /**
   * Configured population size — always recorded explicitly even when it came
   * from a default, as it is the primary tuning variable.
   */
  readonly populationSize: number;
  /**
   * Final actual population size, recorded only when adaptive population sizing
   * (`AdaptivePopulationConfig`, opt-in) is enabled and may differ from the
   * configured `populationSize`. Omitted otherwise.
   */
  readonly finalPopulationSize?: number;
  /** Echo of the caller-requested options (changes from defaults). */
  readonly requestedOptions: OptionsEcho;
  /** Machine descriptors for cross-machine comparison. */
  readonly hardware: HardwareDescriptors;
  /** Milestone summary of the score-improvement curve. */
  readonly scoreImprovement: ScoreImprovementMilestones;
}

/**
 * The full run-level result returned by `evolveDir`/`evolveDataSet`/`evolveEnv`
 * — the existing throughput/score fields plus the Issue #3422 tuning-statistics
 * group. `evolveRL` extends this with an optional `milestones` array.
 */
export interface EvolveResult extends EvolveRunStatistics {
  /** Best creature's error at run end. */
  readonly error: number;
  /** Best score reached during the run. */
  readonly score: number;
  /** Total run wall-clock time in ms. */
  readonly time: number;
  /** Generations completed during the run. */
  readonly generation: number;
  /** Whole-run per-phase timing totals (Issue #3210). */
  readonly phaseTimingTotals: PhaseTimingTotals;
  /** Whole-run per-backend scorer-utilisation totals (Issue #3234). */
  readonly scorerUtilisation: ScorerUtilisationTotals;
}

/** Inputs needed to assemble the {@link EvolveRunStatistics} group. */
export interface EvolveRunStatisticsInputs {
  /** Configured population size (`config.populationSize`). */
  readonly populationSize: number;
  /** True when adaptive population sizing is enabled for this run. */
  readonly adaptivePopulationEnabled: boolean;
  /** Effective population size at run end (`neat.effectivePopulationSize`). */
  readonly finalPopulationSize: number;
  /** The raw options object the caller passed to the `evolve*` function. */
  readonly options: object | undefined;
  /** The compact best-score trajectory accumulated during the run. */
  readonly trajectory: ScoreTrajectory;
}

/**
 * Assemble the {@link EvolveRunStatistics} group from the run's inputs. Captures
 * the hardware descriptors, echoes the caller options, and finalises the
 * score-improvement milestones. `finalPopulationSize` is included only when
 * adaptive population sizing was enabled.
 */
export function buildEvolveRunStatistics(
  inputs: EvolveRunStatisticsInputs,
): EvolveRunStatistics {
  const base: EvolveRunStatistics = {
    populationSize: inputs.populationSize,
    requestedOptions: serialiseOptionsEcho(inputs.options),
    hardware: captureHardwareDescriptors(),
    scoreImprovement: finaliseScoreImprovementMilestones(inputs.trajectory),
  };
  if (inputs.adaptivePopulationEnabled) {
    return { ...base, finalPopulationSize: inputs.finalPopulationSize };
  }
  return base;
}
