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
  type CensoredRun,
  collectRun,
  compareContrasts,
  type TimedResult,
} from "./lib/differentialWeightContrasts.ts";
import {
  type ArmResult,
  buildSplits,
  calibrateTarget,
  CALIBRATION_BASE_SEED,
  CALIBRATION_SEED_COUNT,
  CORPUS_SEED,
  DEFAULT_STUDY_SETTINGS,
  PREDECLARED_CONTRASTS,
  runArm,
  STUDY_ARMS,
  type StudyArm,
  type StudySettings,
  SUCCESS_CRITERIA,
  USED_SEED_RANGES,
  usedSeedOverlap,
  validateSettings,
  VALIDATION_BASE_SEED,
  VALIDATION_SEED_COUNT,
  WALL_CLOCK_BASE_SEED,
  WALL_CLOCK_BUDGET_MS,
  WALL_CLOCK_RECORD_BUDGET,
  type WallClockBudget,
} from "./lib/differentialWeightStudy.ts";

const ISSUE = 4156;
const PAPER = "https://arxiv.org/abs/2610.26202";

/**
 * Preparation that preceded the reported run. Each is a search cost: the
 * pilot set the contraction thresholds, the smoke runs and the probe checked
 * the harness, and the full runs found harness defects. The runs before the
 * second full run were not written down when they were made; their seeds,
 * arms and records come from the session transcript, and each was replayed at
 * its code version to measure its cost (Issue #4156). Correctness tests are
 * not listed: they run at small fixed settings in every quality gate.
 */
const PREPARATION_RUNS = [
  {
    what:
      "smoke run before the pilot (--seeds=2 --calibration-seeds=1 --budget=40000), at commit 34045199 without its two contraction-threshold lines (highDiversityThreshold and lowDiversityThreshold at the production defaults 0.8 and 0.3)",
    seeds: "4156-4157 (2); calibration 94156",
    arms: "8 arms",
    recordsCharged:
      "replayed on 2026-11-20 at that code version from the command in the session transcript; the harness is deterministic per seed and the replay matched every value the transcript printed apart from wall-clock times: 640,000 validation + 40,000 calibration = 680,000",
  },
  {
    what:
      "3-seed pilot that set contractionHighDiversityThreshold to 0 (--seeds=3 --calibration-seeds=1), run twice with the same arguments, the second time to write JSON, at commit 34045199 without its two contraction-threshold lines (highDiversityThreshold and lowDiversityThreshold at the production defaults 0.8 and 0.3)",
    seeds: "4156-4158 (3); calibration 94156",
    arms: "8 arms",
    recordsCharged:
      "replayed on 2026-11-20 at that code version from the command in the session transcript; the harness is deterministic per seed and the replay matched every value the transcript printed apart from wall-clock times: 2 x (5,756,800 validation + 240,000 calibration) = 11,993,600",
  },
  {
    what:
      "smoke run after the threshold change (--seeds=3 --calibration-seeds=1), at commit 34045199",
    seeds: "4156-4158 (3); calibration 94156",
    arms: "8 arms",
    recordsCharged:
      "replayed on 2026-11-20 at that code version from the command in the session transcript; the harness is deterministic per seed and the replay matched every value the transcript printed apart from wall-clock times: 5,754,000 validation + 240,000 calibration = 5,994,000",
  },
  {
    what:
      "first full run at commit 34045199 (CLI defaults), discarded after it showed ordinary breeding left slots empty (the top-up retry was added)",
    seeds: "4156-4185 (30); calibration 94156-94160",
    arms: "8 arms",
    recordsCharged:
      "replayed on 2026-11-20 at that code version from the command in the session transcript; the harness is deterministic per seed and the replay matched every value the transcript printed apart from wall-clock times: 57,540,400 validation + 1,198,800 calibration = 58,739,200",
  },
  {
    what:
      "probe of the top-up retry at commit 52a59186's harness: control@reenter and de@reenter on seed 5 at reduced settings (60 train records, population 8, budget 14,400)",
    seeds: "5 (1)",
    arms: "2 arms",
    recordsCharged:
      "replayed on 2026-11-20 at that code version from the command in the session transcript; the harness is deterministic per seed and the replay matched every value the transcript printed apart from wall-clock times: 14,340 + 14,400 = 28,740",
  },
  {
    what:
      "smoke run of the top-up retry (--seeds=3 --calibration-seeds=1), at commit 52a59186",
    seeds: "4156-4158 (3); calibration 94156",
    arms: "8 arms",
    recordsCharged:
      "replayed on 2026-11-20 at that code version from the command in the session transcript; the harness is deterministic per seed and the replay matched every value the transcript printed apart from wall-clock times: 5,760,000 validation + 240,000 calibration = 6,000,000",
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
  {
    what:
      "12-arm run on 24156-24185 at commit 23bd8e8f, superseded by the run that added the equal-wall-clock phase; its record-budget results were reproduced field for field",
    seeds: "24156-24185 (30)",
    arms: "12 arms",
    recordsCharged:
      "recorded in the artefact at commit 32f346c5: 86,345,600 validation + 1,200,000 calibration = 87,545,600",
  },
  {
    what:
      "12-arm run at commit b224f0df with the first equal-wall-clock phase, superseded after review found a refinement batch ran past the deadline and that a run with no scored candidate was counted as completed; its record-budget results were reproduced field for field",
    seeds: "24156-24185 (30) and 34156-34185 (30, wall-clock phase)",
    arms: "12 arms",
    recordsCharged:
      "recorded in the artefact at commit 1439479d: 86,345,600 validation + 1,200,000 calibration + 81,493,600 in the wall-clock phase = 169,039,200",
  },
];

interface Failure {
  readonly arm: string;
  readonly seed: number;
  readonly error: string;
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
  const censored: CensoredRun[] = [];
  const wallCensored: CensoredRun[] = [];
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
        collectRun(runs.get(arm.name)!, censored, timed);
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
  const comparisons = compareContrasts(runs, validationSeeds);

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
      } -> ${c.verdict}${"reason" in c ? ` (${c.reason})` : ""}`,
    );
  }

  const coverage = STUDY_ARMS.map((arm) => ({
    arm: arm.name,
    completed: runs.get(arm.name)!.size,
    attempted: attempted.get(arm.name)!,
    censored: censored.filter((run) => run.arm === arm.name).length,
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
      } ${row.completed}/${row.attempted} (censored ${row.censored})  gens ${row.generations}  evals/gen ${
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
          collectRun(wallRuns.get(arm.name)!, wallCensored, timed);
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
    ? compareContrasts(wallRuns, wallClockSeeds)
    : [];
  const wallCoverage = STUDY_ARMS.map((arm) => {
    const done = [...wallRuns.get(arm.name)!.values()];
    return {
      arm: arm.name,
      completed: done.length,
      attempted: wallClockMs > 0 ? wallClockSeeds.length : 0,
      censored: wallCensored.filter((run) => run.arm === arm.name).length,
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
        } wall x${fmt(c.wallClockMedianRatio, 3)} -> ${c.verdict}${
          "reason" in c ? ` (${c.reason})` : ""
        }`,
      );
    }
    for (const row of wallCoverage) {
      console.info(
        `  ${row.arm.padEnd(24)} ${row.completed}/${row.attempted} ` +
          `censored ${row.censored} ` +
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
        "two phases. Primary (validationSeeds): records charged held equal, holdout and diversity probe uncharged, wall-clock measured. Equal-wall-clock (wallClockPhase): every arm gets the same per-run wall-clock cap, checked before every evaluation and before every refinement candidate, so no evaluation starts after the deadline, on fresh seeds, with the record budget raised tenfold so the clock is what stops each run; a run that ends with no scored candidate is recorded as censored and left out of every paired statistic; contraction schedules read the elapsed share of the wall-clock as budget progress. The wall-clock phase is not bit-reproducible, because the clock is real, so its arm order is rotated per seed to spread machine-load drift across arms",
      preparation: {
        note:
          "records charged by every run that shaped the design or the harness, counted as search cost alongside calibration",
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
          "three ranges are used and refused as validation ranges: 4156-4185 was the earlier full runs' CLI default, 14156-14185 was PR 4165's reported validation and the ccf3d612 re-run, and 34156-34185 was the first equal-wall-clock phase, seen before review found that a refinement batch ran past the deadline; the pilot and the smoke runs used 4156-4158, inside the first range, and the probe used seed 5, outside every validation range",
      },
      paper: {
        url: PAPER,
        title:
          "Hybrid metaheuristics for architectural design optimization under small evaluation and wall-clock budgets",
        author: "Luciano Ambrosini",
        version: "v1, submitted 2026-10-19",
        methodRead: "full",
        sourcesRead:
          "the full PDF text (https://arxiv.org/pdf/2610.26202v1), read 2026-11-22, after search-engine excerpts retrieved 2026-11-16 to 2026-11-20 while direct fetches were refused by the container proxy; the paper gives several settings only in words or not at all, and those are listed in notPinned",
        pinned: [
          "MERLIN: CMA-ES whose sampling is enriched with differential-evolution trial vectors added as extra offspring; removing them leaves CMA-ES with the same initial step size",
          "MERLIN settings: lambda = N = 20 (4 + floor(3 ln D) < N at these dimensions), CMA-ES defaults otherwise, initial mean at the box centre, initial step size 0.1 in normalised coordinates (0.3 for the CMA-ES baseline); K = rho * lambda DE trial vectors per generation with rho = 0.2 (K = 4), built by standard DE mutation and crossover with self-adapted control parameters (Brest et al. 2006) from an archive of good solutions; a Solis-Wets step around the incumbent from a fixed generation, costing one or two evaluations per generation, whose accepted point replaces the incumbent but not the archive or the CMA-ES update",
          "RAPTOR: particle swarm with success-history parameter adaptation, differential-evolution injection and local refinement",
          "RAPTOR settings: N = 20, global-best topology, inertia and acceleration adapted per particle from a SHADE-style success history, Levy relocation (Mantegna 1994) of particles whose personal best stagnates, the worst particles replaced by DE trial vectors from an archive after each move, a Solis-Wets step around the global best written back into the swarm, velocity clamp 0.5 of the variable range (0.2 and 1.0 also tested)",
          "L-SHADE-SW: L-SHADE with an interleaved Solis-Wets local search whose result replaces the worst population member",
          "L-SHADE-SW settings: L-SHADE (Tanabe and Fukunaga 2014) with N_init = 20 and all other components unchanged; from a fixed generation one Solis-Wets step around the elite per generation; the section 3.3 delay at delta = 0.76",
          "budget-aware delay of L-SHADE linear population-size reduction (section 3.3, figure 2): improves three adaptive DE variants in 40 of 51 comparisons with no loss",
          "section 3.3 schedule: the onset of linear population-size reduction is delayed by a fraction delta of the evaluation budget; delta is zero for budgets above a reference budget and grows as the budget shrinks, is capped so that some reduction still happens at the end of a short run, and the reduction is then compressed linearly into the rest of the budget; delta = 0.76 at FE_max = 1,200 with N_init = 20 (the text also says the population keeps its 20 members for three quarters of the run); it adds no evaluations and no adaptive parameters, reduces to standard LPSR for large budgets, is applied identically to L-SHADE, L-SHADE-SW and L-SHADE-RSP, and needs FE_max before the run starts, so it cannot be used in wall-clock-stopped runs",
          "40 of 51 (section 6.3): 3 L-SHADE variants x 17 problems (7 shifted-rotated functions at D = 10, 7 at D = 30, 3 building objectives), delay on versus off, two-sided Mann-Whitney at alpha = 0.05: 40 wins, 11 ties, 0 losses, with no multiple-comparison correction (section 4.7)",
          "budget: hard cap of 1,200 evaluations, all counted, injected and Solis-Wets evaluations included; a generation that would exceed the cap stops mid-generation; nominal horizon floor(1,200 / N) = 60 generations at N = 20; 30 seeds (5000 + 137r); the finite-element problem runs at equal wall-clock (15 minutes per run)",
          "ablations: the gain is attributed to the DE injection; local search pays off only when its result re-enters the population",
        ],
        notPinned: [
          "not stated in the paper: the delay formula, the reference budget and the delay cap value (section 3.3 describes the schedule in words only)",
          "not stated in the paper: N_min for the delayed reduction, and L-SHADE's memory size H, archive rate, p-best fraction and initial F/CR memories (this study uses L-SHADE's N_min = 4)",
          "not stated in the paper: MERLIN's DE strategy and F/CR beyond self-adaptation per Brest et al. 2006, its archive size and update rule, and the generation at which Solis-Wets starts (this study uses DE/rand/1/bin with fixed F = 0.5 and CR = 0.9)",
          "not stated in the paper: RAPTOR's initial inertia and acceleration, history memory size, stagnation threshold, Levy exponent, number of particles replaced and its DE settings",
          "not stated in the paper: Solis-Wets step parameters (this study uses Gaussian perturbation of every weight); the author offers further implementation details on request, and none were obtained",
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
            censored,
            comparisons,
            results: perRun,
            wallClockPhase: {
              wallClockMs,
              recordBudget: wallClockSettings.recordBudget,
              seeds: wallClockSeeds,
              armOrder:
                "seed-major; at seed index i the arms run in STUDY_ARMS order rotated left by i mod 12",
              coverage: wallCoverage,
              censored: wallCensored,
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
