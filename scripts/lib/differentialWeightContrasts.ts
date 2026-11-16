/**
 * Issue #4156 — collecting runs and comparing arms for the differential-weight
 * study.
 *
 * A run that stopped before any creature was scored (an equal wall-clock budget
 * spent during set-up) has `Infinity` MSE. It is not a completed sample: it is
 * a censored run, recorded with its reason and costs and left out of every
 * paired statistic, so no non-finite value reaches a confidence interval.
 *
 * A measurement harness, not a production code path: nothing under `src/`
 * imports it.
 */

import { median } from "./rankFidelity.ts";
import {
  type ArmResult,
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  pairedComparison,
  PREDECLARED_CONTRASTS,
  sdRatio,
  SUCCESS_CRITERIA,
  verdict,
} from "./differentialWeightStudy.ts";

/** A run plus the wall-clock it took (measured here only). */
export interface TimedResult {
  readonly result: ArmResult;
  readonly wallMs: number;
}

/** A run that ended with no scored candidate to compare. */
export interface CensoredRun {
  readonly arm: string;
  readonly seed: number;
  readonly reason: string;
  readonly stoppedBy: ArmResult["stoppedBy"];
  readonly recordsCharged: number;
  readonly evaluations: number;
  readonly generations: number;
  readonly wallMs: number;
}

/** Whether the run shipped a creature with a finite training and holdout MSE. */
export function isScoredRun(result: ArmResult): boolean {
  return Number.isFinite(result.finalTrainMse) &&
    Number.isFinite(result.finalHoldoutMse);
}

/**
 * Sorts a finished run into the completed samples or the censored list. A
 * censored run keeps its reason and costs; it never enters a comparison.
 */
export function collectRun(
  completed: Map<number, TimedResult>,
  censored: CensoredRun[],
  timed: TimedResult,
): void {
  const { result } = timed;
  if (isScoredRun(result)) {
    completed.set(result.seed, timed);
    return;
  }
  censored.push({
    arm: result.arm,
    seed: result.seed,
    reason: result.evaluations === 0
      ? `no creature was scored before the ${result.stoppedBy} budget ended`
      : `the shipped creature has a non-finite MSE (train ${result.finalTrainMse}, holdout ${result.finalHoldoutMse})`,
    stoppedBy: result.stoppedBy,
    recordsCharged: result.recordsCharged,
    evaluations: result.evaluations,
    generations: result.generations,
    wallMs: timed.wallMs,
  });
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Mean arm / mean control over the seeds where both are finite, with how many
 * seeds that was. `NaN` when no seed has both.
 */
function pairedRatio(
  arm: readonly number[],
  control: readonly number[],
): { readonly ratio: number; readonly seeds: number } {
  const keep = arm.flatMap((value, i) =>
    Number.isFinite(value) && Number.isFinite(control[i]) ? [i] : []
  );
  return {
    ratio: mean(keep.map((i) => arm[i])) / mean(keep.map((i) => control[i])),
    seeds: keep.length,
  };
}

/**
 * The predeclared contrasts over the seeds on which both arms of each contrast
 * completed. A contrast with no paired seed has the verdict `insufficient-data`
 * — there is nothing to conclude, so `no-benefit` would claim too much. So does
 * a contrast where a paired seed lacks the diversity or species measurement (a
 * run stopped inside its first generation): its held-out MSE is kept, but the
 * verdict needs the diversity ratio, and its `reason` says what is missing.
 *
 * @param runs - Completed runs by arm name, then seed.
 * @param seeds - The seeds that were attempted.
 */
export function compareContrasts(
  runs: ReadonlyMap<string, ReadonlyMap<number, TimedResult>>,
  seeds: readonly number[],
) {
  return PREDECLARED_CONTRASTS.map((contrast) => {
    const armRuns = runs.get(contrast.arm)!;
    const controlRuns = runs.get(contrast.control)!;
    const paired = seeds.filter((seed) =>
      armRuns.has(seed) && controlRuns.has(seed)
    );
    const a = paired.map((seed) => armRuns.get(seed)!);
    const c = paired.map((seed) => controlRuns.get(seed)!);
    const label = `${contrast.arm} vs ${contrast.control}`;
    if (paired.length === 0) {
      return {
        label,
        ...contrast,
        seeds: 0,
        attempted: seeds.length,
        verdict: "insufficient-data" as const,
      };
    }
    const holdout = pairedComparison(
      a.map((r) => r.result.finalHoldoutMse),
      c.map((r) => r.result.finalHoldoutMse),
      BOOTSTRAP_RESAMPLES,
      BOOTSTRAP_SEED,
    );
    const spread = paired.length >= 2
      ? sdRatio(
        a.map((r) => r.result.finalHoldoutMse),
        c.map((r) => r.result.finalHoldoutMse),
        BOOTSTRAP_RESAMPLES,
        BOOTSTRAP_SEED,
      )
      : null;
    const pairedTimes = paired.flatMap((_, i) => {
      const x = a[i].result.timeToTargetRecords;
      const y = c[i].result.timeToTargetRecords;
      return x !== null && y !== null ? [x - y] : [];
    });
    // A run stopped inside its first generation has scored creatures but no
    // generation-2 trace, so its diversity and species means are unavailable
    // (`NaN`). Each ratio is taken over the seeds where both arms measured it,
    // and the coverage is reported alongside.
    const diversity = pairedRatio(
      a.map((r) => r.result.meanBehaviouralDiversity),
      c.map((r) => r.result.meanBehaviouralDiversity),
    );
    const species = pairedRatio(
      a.map((r) => r.result.meanSpeciesCount),
      c.map((r) => r.result.meanSpeciesCount),
    );
    const diversityRatio = diversity.ratio;
    const speciesRatio = species.ratio;
    const missing: string[] = [];
    if (diversity.seeds < paired.length) {
      missing.push(
        `behavioural diversity measured on ${diversity.seeds} of ${paired.length} paired seeds`,
      );
    }
    if (species.seeds < paired.length) {
      missing.push(
        `species count measured on ${species.seeds} of ${paired.length} paired seeds`,
      );
    }
    const wallClockMedianRatio = median(a.map((r) => r.wallMs)) /
      median(c.map((r) => r.wallMs));
    return {
      label,
      ...contrast,
      seeds: paired.length,
      attempted: seeds.length,
      heldOutMse: holdout,
      sdRatio: spread,
      timeToTarget: {
        reachedArm: a.filter((r) => r.result.timeToTargetRecords !== null)
          .length,
        reachedControl: c.filter((r) => r.result.timeToTargetRecords !== null)
          .length,
        pairedSeeds: pairedTimes.length,
        medianPairedDifferenceRecords: pairedTimes.length === 0
          ? null
          : median(pairedTimes),
      },
      diversityRatio,
      speciesCountRatio: speciesRatio,
      diversitySeeds: diversity.seeds,
      speciesSeeds: species.seeds,
      wallClockMedianRatio,
      ...(missing.length === 0
        ? { verdict: verdict(holdout, diversityRatio, SUCCESS_CRITERIA) }
        : {
          verdict: "insufficient-data" as const,
          reason: `a required measurement is unavailable: ${
            missing.join("; ")
          }`,
        }),
    };
  });
}
