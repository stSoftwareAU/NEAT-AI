/**
 * Issue #4156 — differential-weight offspring and delayed population
 * contraction.
 *
 * Runs DE offspring (off or on) against three contraction policies (none, the
 * adaptive shrink rule, and the paper's delayed L-SHADE linear reduction),
 * crossed with whether refined descendants re-enter the population (12 arms),
 * over predeclared validation
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
 * Records charged are held equal across arms in the primary phase; the holdout
 * and the diversity probe are uncharged. A second phase holds wall-clock equal
 * instead: every arm gets the same per-run wall-clock cap on fresh seeds, with
 * the record budget raised so the clock is what stops each run.
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
  USED_SEED_RANGES,
  usedSeedOverlap,
  validateSettings,
  VALIDATION_BASE_SEED,
  VALIDATION_SEED_COUNT,
  verdict,
  WALL_CLOCK_BASE_SEED,
  WALL_CLOCK_BUDGET_MS,
  WALL_CLOCK_RECORD_BUDGET,
  type WallClockBudget,
} from "./lib/differentialWeightStudy.ts";

const ISSUE = 4156;
const PAPER = "https://arxiv.org/abs/2610.26202";

/**
 * Preparation that preceded the reported run. Each is a search cost: the
 * pilot set the contraction thresholds, and the full runs found harness
 * defects. The seeds of the first two were not recorded when they were made,
 * so the table says what is known and gives the most each could have charged.
 */
const PREPARATION_RUNS = [
  {
    what: "3-seed pilot that set contractionHighDiversityThreshold to 0",
    seeds: "not recorded",
    arms: "not recorded",
    recordsCharged:
      "not recorded; at most 3 seeds x 8 arms x 240,000 = 5,760,000, plus up to 1,200,000 for a calibration phase if it ran through this CLI (not known)",
  },
  {
    what:
      "first full run, discarded after it showed ordinary breeding left slots empty (the top-up retry was added)",
    seeds: "not recorded; the CLI default then was 4156-4185",
    arms: "8 arms",
    recordsCharged:
      "not recorded; at most 30 seeds x 8 arms x 240,000 = 57,600,000, plus 1,200,000 for the calibration phase the CLI has run since its first commit = 58,800,000",
  },
  {
    what:
      "second full run on 4156-4185 after the top-up, discarded because time-to-target ignored creatures that can ship but are not the population's best (review of PR 4165)",
    seeds: "4156-4185 (30)",
    arms: "8 arms",
    recordsCharged:
      "recorded in the artefact at commit eccc6792: 57,594,400 validation + 1,200,000 calibration = 58,794,400",
  },
  {
    what:
      "PR 4165's reported validation on 14156-14185, superseded: its results were seen before the delayed L-SHADE LPSR arms were added, so the range is no longer untouched",
    seeds: "14156-14185 (30)",
    arms: "8 arms",
    recordsCharged:
      "recorded in the artefact merged with PR 4165: 57,596,400 validation + 1,200,000 calibration = 58,796,400",
  },
  {
    what:
      "12-arm run on 14156-14185 at commit ccf3d612 after the LPSR arms were added, superseded for the same reason; its 8 original arms reproduced PR 4165's contrasts exactly",
    seeds: "14156-14185 (30)",
    arms: "12 arms",
    recordsCharged:
      "recorded: 86,337,200 validation + 1,200,000 calibration = 87,537,200",
  },
];

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
  wallClock?: WallClockBudget,
): Promise<TimedResult> {
  const started = performance.now();
  const result = await runArm(arm, settings, seed, splits, target, wallClock);
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

  const usedOverlap = usedSeedOverlap(validationSeeds);
  if (usedOverlap.length > 0) {
    throw new Error(
      `validation seeds overlap a range an earlier run used ` +
        `(${USED_SEED_RANGES.map(([a, b]) => `${a}-${b}`).join(", ")}): ${
          usedOverlap.join(", ")
        }`,
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
  const compare = (
    runs: Map<string, Map<number, TimedResult>>,
    validationSeeds: readonly number[],
  ) =>
    PREDECLARED_CONTRASTS.map((contrast) => {
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
  const comparisons = compare(runs, validationSeeds);

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

  // Equal-wall-clock phase: the same per-run wall-clock for every arm, on
  // fresh seeds. Seed-major, with the arm order rotated per seed, so drift in
  // machine load falls on every arm alike rather than on whichever ran last.
  const wallClockMs = numberArg(args, "wall-clock-ms", WALL_CLOCK_BUDGET_MS);
  const wallClockSettings: StudySettings = {
    ...settings,
    recordBudget: WALL_CLOCK_RECORD_BUDGET,
  };
  validateSettings(wallClockSettings);
  const wallClockSeeds = Array.from(
    { length: seedCount },
    (_, i) => WALL_CLOCK_BASE_SEED + i,
  );
  const wallClockUsed = usedSeedOverlap(wallClockSeeds);
  if (
    wallClockUsed.length > 0 ||
    wallClockSeeds.some((seed) =>
      validationSeeds.includes(seed) || calibrationSeeds.includes(seed)
    )
  ) {
    throw new Error(
      `equal-wall-clock seeds must be fresh: ${wallClockSeeds[0]}-${
        wallClockSeeds[wallClockSeeds.length - 1]
      }`,
    );
  }
  const wallRuns = new Map<string, Map<number, TimedResult>>(
    STUDY_ARMS.map((arm) => [arm.name, new Map()]),
  );
  if (wallClockMs > 0) {
    console.info(
      `\nEqual-wall-clock phase: ${wallClockMs} ms per run, record budget ` +
        `${wallClockSettings.recordBudget}, seeds ${wallClockSeeds[0]}-${
          wallClockSeeds[wallClockSeeds.length - 1]
        }`,
    );
    for (const [index, seed] of wallClockSeeds.entries()) {
      const offset = index % STUDY_ARMS.length;
      const order = [
        ...STUDY_ARMS.slice(offset),
        ...STUDY_ARMS.slice(0, offset),
      ];
      for (const arm of order) {
        try {
          // deno-lint-ignore no-await-in-loop
          const timed = await timedRun(
            arm,
            wallClockSettings,
            seed,
            splits,
            target,
            { ms: wallClockMs, now: () => performance.now() },
          );
          wallRuns.get(arm.name)!.set(seed, timed);
        } catch (error) {
          failures.push({
            arm: `${arm.name} (wall-clock)`,
            seed,
            error: String(error),
          });
          console.error(`  ${arm.name} seed ${seed} (wall-clock) FAILED`);
        }
      }
    }
  }
  const wallComparisons = wallClockMs > 0
    ? compare(wallRuns, wallClockSeeds)
    : [];
  const wallCoverage = STUDY_ARMS.map((arm) => {
    const done = [...wallRuns.get(arm.name)!.values()];
    return {
      arm: arm.name,
      completed: done.length,
      attempted: wallClockMs > 0 ? wallClockSeeds.length : 0,
      stoppedByWallClock: done.filter((run) =>
        run.result.stoppedBy === "wall-clock"
      ).length,
      medianWallMs: done.length === 0
        ? null
        : median(done.map((r) => r.wallMs)),
      medianRecordsCharged: done.length === 0
        ? null
        : median(done.map((r) => r.result.recordsCharged)),
      medianHoldoutMse: done.length === 0
        ? null
        : median(done.map((r) => r.result.finalHoldoutMse)),
    };
  });
  if (wallClockMs > 0) {
    console.info("\nEqual-wall-clock contrasts (held-out MSE, arm - control):");
    for (const c of wallComparisons) {
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
        } wall x${fmt(c.wallClockMedianRatio, 3)} -> ${c.verdict}`,
      );
    }
    for (const row of wallCoverage) {
      console.info(
        `  ${row.arm.padEnd(24)} ${row.completed}/${row.attempted} ` +
          `stopped by clock ${row.stoppedByWallClock}  median wall ${
            fmt(row.medianWallMs ?? Number.NaN, 4)
          } ms  median records ${row.medianRecordsCharged}`,
      );
    }
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
        "adaptive (contraction, de+contraction): contraction uses the existing adaptive shrink rule, never growing, only after the delay; the production highDiversityThreshold is 0.8 but a 3-seed pilot showed 1.3-2.3 species per 24 creatures so the shrink branch never fired; the study sets contractionHighDiversityThreshold to 0, so the rule contracts on every post-delay plateau, bounded below by minPopulationFraction 0.5; the rule's low-diversity grow branch is disabled (lowDiversityThreshold 0) because it is checked first and would pre-empt the shrink; linear (lpsr, de+lpsr): the paper's budget-aware delayed L-SHADE linear population-size reduction, held at the base size until contractionDelayFraction of the record budget, then linear to lpsrMinPopulationSize (4, L-SHADE's N_min) at budget exhaustion, never growing; the paper's own delay cap value was not obtained",
      budgetPolicy:
        "two phases. Primary (validationSeeds): records charged held equal, holdout and diversity probe uncharged, wall-clock measured. Equal-wall-clock (wallClockPhase): every arm gets the same per-run wall-clock cap, checked before every evaluation and refinement, on fresh seeds, with the record budget raised tenfold so the clock is what stops each run; contraction schedules read the elapsed share of the wall-clock as budget progress. The wall-clock phase is not bit-reproducible, because the clock is real, so its arm order is rotated per seed to spread machine-load drift across arms",
      preparation: {
        note:
          "records charged by every run that shaped the design or the harness, counted as search cost alongside calibration; bounds are 240,000 records per run, which is the most one run can charge",
        calibrationRecordsCharged,
        runs: PREPARATION_RUNS,
        // Derived from the seeds actually run, not asserted: an overlapping
        // range is refused above, so this is true whenever a manifest exists.
        validationSeedsUntouched: usedSeedOverlap(validationSeeds).length === 0,
        earlierRunSeedRanges: USED_SEED_RANGES.map(([first, last]) => ({
          first,
          last,
        })),
        earlierRunSeedNote:
          "two ranges are used and refused as validation ranges: 4156-4185 was the earlier full runs' CLI default, and 14156-14185 was PR 4165's reported validation and the ccf3d612 re-run; the pilot's seeds were not recorded",
      },
      paper: {
        url: PAPER,
        title:
          "Hybrid metaheuristics for architectural design optimization under small evaluation and wall-clock budgets",
        author: "Luciano Ambrosini",
        version: "v1, submitted 2026-10-19",
        methodRead: "partial",
        sourcesRead:
          "search-engine excerpts of the abstract page and the PDF text, retrieved 2026-11-16; direct fetches of arxiv.org (abs and pdf) were refused by the container proxy, so the full text was not read",
        pinned: [
          "MERLIN: CMA-ES whose sampling is enriched with differential-evolution trial vectors added as extra offspring; removing them leaves CMA-ES with the same initial step size",
          "RAPTOR: particle swarm with success-history parameter adaptation, differential-evolution injection and local refinement",
          "L-SHADE-SW: L-SHADE with an interleaved Solis-Wets local search whose result replaces the worst population member",
          "budget-aware delay of L-SHADE linear population-size reduction (section 3.3, figure 2): improves three adaptive DE variants in 40 of 51 comparisons with no loss",
          "budget: hard cap of 1,200 evaluations, all counted; the finite-element problem runs at equal wall-clock (15 minutes per run)",
          "ablations: the gain is attributed to the DE injection; local search pays off only when its result re-enters the population",
        ],
        notPinned: [
          "the delay formula and delay cap value",
          "the DE variant, F and CR used for injection",
          "the injection fraction (this study uses the issue's 20%)",
          "Solis-Wets step parameters (this study uses Gaussian perturbation of every weight)",
        ],
      },
    };
    await Deno.writeTextFile(
      jsonPath,
      `${
        JSON.stringify(
          {
            manifest,
            coverage,
            failures,
            comparisons,
            results: perRun,
            wallClockPhase: {
              wallClockMs,
              recordBudget: wallClockSettings.recordBudget,
              seeds: wallClockSeeds,
              armOrder:
                "seed-major; at seed index i the arms run in STUDY_ARMS order rotated left by i mod 12",
              coverage: wallCoverage,
              comparisons: wallComparisons,
              results: STUDY_ARMS.flatMap((arm) =>
                wallClockSeeds.flatMap((seed) => {
                  const timed = wallRuns.get(arm.name)!.get(seed);
                  if (timed === undefined) return [];
                  const { trace: _trace, ...rest } = timed.result;
                  return [{ ...rest, wallMs: timed.wallMs }];
                })
              ),
            },
          },
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
