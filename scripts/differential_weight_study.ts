/**
 * Issue #4156 — differential-weight offspring and delayed population
 * contraction.
 *
 * Runs the 2x2 of DE offspring and delayed contraction, crossed with whether
 * refined descendants re-enter the population, over predeclared validation
 * seeds. A calibration phase on a disjoint seed range sets the time-to-target
 * threshold from the current-behaviour arm (`control@reenter`), so the
 * validation seeds never tune the bar they are measured against.
 *
 * ```bash
 * deno task differential-weight-study --json=docs/evidence/differential-weight-4156.json \
 *   --code-version=$(git rev-parse HEAD)
 * ```
 *
 * The objective is synthetic and local refinement stands in for backprop; see
 * `scripts/lib/differentialWeightStudy.ts` for what is real and what is not.
 * Records charged are held equal across arms; the holdout and the diversity
 * probe are uncharged; wall-clock is measured and reported, not capped.
 *
 * A measurement harness, not a production code path: nothing under `src/`
 * imports it.
 */

import denoJson from "../deno.json" with { type: "json" };
import { intArg, numberArg, stringArg } from "./lib/cliArgs.ts";
import { median } from "./lib/rankFidelity.ts";
import {
  type ArmResult,
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  buildSplits,
  calibrateTarget,
  CALIBRATION_BASE_SEED,
  CALIBRATION_SEED_COUNT,
  CORPUS_SEED,
  DEFAULT_STUDY_SETTINGS,
  pairedComparison,
  PREDECLARED_CONTRASTS,
  runArm,
  sdRatio,
  STUDY_ARMS,
  type StudyArm,
  type StudySettings,
  SUCCESS_CRITERIA,
  validateSettings,
  VALIDATION_BASE_SEED,
  VALIDATION_SEED_COUNT,
  verdict,
} from "./lib/differentialWeightStudy.ts";

const ISSUE = 4156;
const PAPER = "https://arxiv.org/abs/2610.26202";

/** A run plus the wall-clock it took (measured here only). */
interface TimedResult {
  readonly result: ArmResult;
  readonly wallMs: number;
}

interface Failure {
  readonly arm: string;
  readonly seed: number;
  readonly error: string;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** `NaN`/`Infinity` do not survive JSON; write them as `null`. */
function jsonSafe(_key: string, value: unknown): unknown {
  return typeof value === "number" && !Number.isFinite(value) ? null : value;
}

function fmt(value: number, digits = 4): string {
  return Number.isFinite(value) ? value.toPrecision(digits) : "n/a";
}

async function timedRun(
  arm: StudyArm,
  settings: StudySettings,
  seed: number,
  splits: ReturnType<typeof buildSplits>,
  target: number | undefined,
): Promise<TimedResult> {
  const started = performance.now();
  const result = await runArm(arm, settings, seed, splits, target);
  return { result, wallMs: performance.now() - started };
}

if (import.meta.main) {
  const args = [...Deno.args];
  const seedCount = intArg(args, "seeds", VALIDATION_SEED_COUNT);
  const baseSeed = numberArg(args, "base-seed", VALIDATION_BASE_SEED);
  const calibrationCount = intArg(
    args,
    "calibration-seeds",
    CALIBRATION_SEED_COUNT,
  );
  const codeVersion = stringArg(args, "code-version") ?? "unrecorded";
  const jsonPath = stringArg(args, "json");
  const settings: StudySettings = {
    ...DEFAULT_STUDY_SETTINGS,
    recordBudget: intArg(
      args,
      "budget",
      DEFAULT_STUDY_SETTINGS.recordBudget,
    ),
    populationSize: intArg(
      args,
      "population",
      DEFAULT_STUDY_SETTINGS.populationSize,
    ),
  };
  validateSettings(settings);

  const validationSeeds = Array.from(
    { length: seedCount },
    (_, i) => baseSeed + i,
  );
  const calibrationSeeds = Array.from(
    { length: calibrationCount },
    (_, i) => CALIBRATION_BASE_SEED + i,
  );
  const overlap = validationSeeds.filter((seed) =>
    calibrationSeeds.includes(seed)
  );
  if (overlap.length > 0) {
    throw new Error(
      `validation seeds overlap the calibration range: ${overlap.join(", ")}`,
    );
  }

  const splits = buildSplits(settings);
  const controlArm = STUDY_ARMS.find((arm) => arm.name === "control@reenter")!;

  console.info(
    `Differential-weight study (Issue #${ISSUE}) — synthetic objective, ` +
      `${validationSeeds.length} validation seeds from ${baseSeed}, ` +
      `${calibrationSeeds.length} calibration seeds, budget ` +
      `${settings.recordBudget} records, population ${settings.populationSize}`,
  );

  // Calibration: the threshold is set on seeds the validation never sees.
  const calibrationRuns: ArmResult[] = [];
  const failures: Failure[] = [];
  let calibrationRecordsCharged = 0;
  for (const seed of calibrationSeeds) {
    try {
      // Runs are sequential on purpose: each seeds the global generator.
      // deno-lint-ignore no-await-in-loop
      const timed = await timedRun(
        controlArm,
        settings,
        seed,
        splits,
        undefined,
      );
      calibrationRuns.push(timed.result);
      calibrationRecordsCharged += timed.result.recordsCharged;
      console.info(
        `  calibration seed ${seed} train MSE ${
          fmt(timed.result.finalTrainMse)
        }  ${(timed.wallMs / 1000).toFixed(1)}s`,
      );
    } catch (error) {
      failures.push({
        arm: `${controlArm.name} (calibration)`,
        seed,
        error: String(error),
      });
    }
  }
  const target = calibrationRuns.length > 0
    ? calibrateTarget(calibrationRuns)
    : undefined;
  console.info(
    `Time-to-target threshold (median calibration train MSE): ${
      target === undefined ? "unavailable" : fmt(target)
    }`,
  );

  // Validation.
  const runs = new Map<string, Map<number, TimedResult>>();
  const attempted = new Map<string, number>();
  for (const arm of STUDY_ARMS) {
    runs.set(arm.name, new Map());
    attempted.set(arm.name, 0);
    for (const seed of validationSeeds) {
      attempted.set(arm.name, attempted.get(arm.name)! + 1);
      try {
        // deno-lint-ignore no-await-in-loop
        const timed = await timedRun(arm, settings, seed, splits, target);
        runs.get(arm.name)!.set(seed, timed);
        console.info(
          `  ${arm.name.padEnd(24)} seed ${seed}  holdout MSE ${
            fmt(timed.result.finalHoldoutMse)
          }  records ${timed.result.recordsCharged}  gens ${timed.result.generations}  ${
            (timed.wallMs / 1000).toFixed(1)
          }s`,
        );
      } catch (error) {
        failures.push({ arm: arm.name, seed, error: String(error) });
        console.error(`  ${arm.name} seed ${seed} FAILED: ${error}`);
      }
    }
  }

  // Comparisons over seeds where both arms completed.
  const comparisons = PREDECLARED_CONTRASTS.map((contrast) => {
    const armRuns = runs.get(contrast.arm)!;
    const controlRuns = runs.get(contrast.control)!;
    const seeds = validationSeeds.filter((seed) =>
      armRuns.has(seed) && controlRuns.has(seed)
    );
    const a = seeds.map((seed) => armRuns.get(seed)!);
    const c = seeds.map((seed) => controlRuns.get(seed)!);
    const label = `${contrast.arm} vs ${contrast.control}`;
    if (seeds.length === 0) {
      return { label, ...contrast, seeds: 0, verdict: "no-benefit" as const };
    }
    const holdout = pairedComparison(
      a.map((r) => r.result.finalHoldoutMse),
      c.map((r) => r.result.finalHoldoutMse),
      BOOTSTRAP_RESAMPLES,
      BOOTSTRAP_SEED,
    );
    const spread = seeds.length >= 2
      ? sdRatio(
        a.map((r) => r.result.finalHoldoutMse),
        c.map((r) => r.result.finalHoldoutMse),
        BOOTSTRAP_RESAMPLES,
        BOOTSTRAP_SEED,
      )
      : null;
    const pairedTimes = seeds.flatMap((_, i) => {
      const x = a[i].result.timeToTargetRecords;
      const y = c[i].result.timeToTargetRecords;
      return x !== null && y !== null ? [x - y] : [];
    });
    const diversityRatio = mean(a.map((r) =>
      r.result.meanBehaviouralDiversity
    )) /
      mean(c.map((r) => r.result.meanBehaviouralDiversity));
    const speciesRatio = mean(a.map((r) => r.result.meanSpeciesCount)) /
      mean(c.map((r) => r.result.meanSpeciesCount));
    const wallClockMedianRatio = median(a.map((r) => r.wallMs)) /
      median(c.map((r) => r.wallMs));
    return {
      label,
      ...contrast,
      seeds: seeds.length,
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
      wallClockMedianRatio,
      verdict: verdict(holdout, diversityRatio, SUCCESS_CRITERIA),
    };
  });

  // Human summary.
  console.info(
    "\nContrasts (held-out MSE, arm - control; negative is better):",
  );
  for (const c of comparisons) {
    if (c.seeds === 0 || !("heldOutMse" in c)) {
      console.info(`  ${c.label}: no paired seeds`);
      continue;
    }
    const h = c.heldOutMse;
    console.info(
      `  ${c.label.padEnd(48)} n=${h.n} diff ${fmt(h.meanDiff)} ci95 [${
        fmt(h.ci95[0])
      }, ${fmt(h.ci95[1])}] wins ${h.wins}/${h.n} diversity x${
        fmt(c.diversityRatio, 3)
      } species x${fmt(c.speciesCountRatio, 3)} wall x${
        fmt(c.wallClockMedianRatio, 3)
      } -> ${c.verdict}`,
    );
  }

  const coverage = STUDY_ARMS.map((arm) => ({
    arm: arm.name,
    completed: runs.get(arm.name)!.size,
    attempted: attempted.get(arm.name)!,
    unfilledSlots: [...runs.get(arm.name)!.values()].reduce(
      (sum, run) => sum + run.result.unfilledSlots,
      0,
    ),
    generations: [...runs.get(arm.name)!.values()].reduce(
      (sum, run) => sum + run.result.generations,
      0,
    ),
    evaluations: [...runs.get(arm.name)!.values()].reduce(
      (sum, run) => sum + run.result.evaluations,
      0,
    ),
  }));
  console.info("\nCoverage (completed/attempted):");
  for (const row of coverage) {
    console.info(
      `  ${
        row.arm.padEnd(24)
      } ${row.completed}/${row.attempted}  gens ${row.generations}  evals/gen ${
        fmt(row.evaluations / Math.max(1, row.generations), 3)
      }  unfilled slots ${row.unfilledSlots}`,
    );
  }

  if (jsonPath !== undefined) {
    const firstSeed = validationSeeds[0];
    const perRun = STUDY_ARMS.flatMap((arm) =>
      validationSeeds.flatMap((seed) => {
        const timed = runs.get(arm.name)!.get(seed);
        if (timed === undefined) return [];
        const { trace, ...rest } = timed.result;
        return [{
          ...rest,
          wallMs: timed.wallMs,
          ...(seed === firstSeed ? { trace } : {}),
        }];
      })
    );
    const manifest = {
      issue: ISSUE,
      codeVersion,
      neatAiVersion: denoJson.version,
      neatCoreRev: denoJson.neatCore.rev,
      deno: Deno.version.deno,
      corpus: {
        id: "synthetic-tanh-quadratic-v1",
        seed: CORPUS_SEED,
        trainRecords: settings.trainRecords,
        holdoutRecords: settings.holdoutRecords,
        diversityProbeRecords: settings.diversityProbeRecords,
      },
      validationSeeds,
      calibrationSeeds,
      calibrationRecordsCharged,
      timeToTargetThreshold: target ?? null,
      settings,
      criteria: SUCCESS_CRITERIA,
      arms: STUDY_ARMS,
      contrasts: PREDECLARED_CONTRASTS,
      contractionPolicy:
        "contraction uses the existing adaptive shrink rule, never growing, only after the delay; the production highDiversityThreshold is 0.8 but a 3-seed pilot showed 1.3-2.3 species per 24 creatures so the shrink branch never fired; the study sets contractionHighDiversityThreshold to 0, so the rule contracts on every post-delay plateau, bounded below by minPopulationFraction 0.5; the rule's low-diversity grow branch is disabled (lowDiversityThreshold 0) because it is checked first and would pre-empt the shrink",
      budgetPolicy:
        "records charged held equal; holdout and diversity probe uncharged; wall-clock measured and reported, not capped",
      paper: {
        url: PAPER,
        note:
          "not fetched: proxy refused; the method follows this repository's reading of the issue",
      },
    };
    await Deno.writeTextFile(
      jsonPath,
      `${
        JSON.stringify(
          { manifest, coverage, failures, comparisons, results: perRun },
          jsonSafe,
          2,
        )
      }\n`,
    );
    console.info(`\nWrote ${jsonPath}`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} run(s) failed`);
    Deno.exit(1);
  }
}
