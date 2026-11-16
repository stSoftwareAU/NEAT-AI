/**
 * Issue #4157 — offspring-census restarts against stagnation restarts.
 *
 * Calibration on a disjoint seed range runs `none` (which sets the holdout
 * target) and a census sweep over weight step and window length (which picks
 * the census setting). Validation then runs `none`, `stagnation` and `census`
 * over the predeclared seeds and reports three paired contrasts.
 *
 * ```bash
 * deno task census-restart-study --json=docs/evidence/census-restart-4157.json \
 *   --code-version=$(git rev-parse HEAD)
 * ```
 *
 * The objective is synthetic; see `scripts/lib/censusRestartStudy.ts` for what
 * is real and what is not. Records charged are held equal across arms; the
 * holdout and the diversity probe are uncharged; wall-clock is reported, not
 * capped.
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
  calibrateHoldoutTarget,
  CALIBRATION_BASE_SEED,
  CALIBRATION_SEED_COUNT,
  CALIBRATION_SWEEP,
  type CalibrationRow,
  chooseCensusSetting,
  CORPUS_SEED,
  DEFAULT_STUDY_SETTINGS,
  pairedComparison,
  PREDECLARED_CONTRASTS,
  runArm,
  sdRatio,
  STUDY_ARMS,
  type StudySettings,
  SUCCESS_CRITERIA,
  summariseCalibration,
  validateSettings,
  VALIDATION_BASE_SEED,
  VALIDATION_SEED_COUNT,
  verdict,
} from "./lib/censusRestartStudy.ts";

const ISSUE = 4157;
const LIMITATION =
  "offspring probabilities are non-stationary and unequal, so the Good–Turing unseen estimate is a trigger heuristic, not an accurate estimate of unseen genomes";

interface Failure {
  readonly arm: string;
  readonly seed: number;
  readonly error: string;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Median of the non-null values, or `null` when there are none. */
function medianOrNull(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : median(present);
}

/** `NaN`/`Infinity` do not survive JSON; write them as `null`. */
function jsonSafe(_key: string, value: unknown): unknown {
  return typeof value === "number" && !Number.isFinite(value) ? null : value;
}

function fmt(value: number | null, digits = 4): string {
  return value !== null && Number.isFinite(value)
    ? value.toPrecision(digits)
    : "n/a";
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
  const baseSettings: StudySettings = {
    ...DEFAULT_STUDY_SETTINGS,
    recordBudget: intArg(args, "budget", DEFAULT_STUDY_SETTINGS.recordBudget),
    populationSize: intArg(
      args,
      "population",
      DEFAULT_STUDY_SETTINGS.populationSize,
    ),
  };
  validateSettings(baseSettings);

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

  const splits = buildSplits(baseSettings);
  const armByName = new Map(STUDY_ARMS.map((arm) => [arm.name, arm]));
  const failures: Failure[] = [];

  console.info(
    `Census-restart study (Issue #${ISSUE}) — synthetic objective, ` +
      `${validationSeeds.length} validation seeds from ${baseSeed}, ` +
      `${calibrationSeeds.length} calibration seeds, budget ` +
      `${baseSettings.recordBudget} records, population ${baseSettings.populationSize}`,
  );

  // Calibration. Every record charged here is counted.
  let calibrationRecordsCharged = 0;
  const calibrationNone: ArmResult[] = [];
  for (const seed of calibrationSeeds) {
    try {
      // Runs are sequential on purpose: each seeds the global generator.
      // deno-lint-ignore no-await-in-loop
      const result = await runArm(
        armByName.get("none")!,
        baseSettings,
        seed,
        splits,
      );
      calibrationNone.push(result);
      calibrationRecordsCharged += result.recordsCharged;
    } catch (error) {
      failures.push({ arm: "none (calibration)", seed, error: String(error) });
      console.error(`  calibration none seed ${seed} FAILED: ${error}`);
    }
  }
  const holdoutTarget = calibrationNone.length > 0
    ? calibrateHoldoutTarget(calibrationNone)
    : undefined;

  const calibrationRows: CalibrationRow[] = [];
  for (const { q, w } of CALIBRATION_SWEEP) {
    const sweepSettings: StudySettings = {
      ...baseSettings,
      censusQuantisation: q,
      censusWindowGenerations: w,
    };
    const results: ArmResult[] = [];
    for (const seed of calibrationSeeds) {
      try {
        // deno-lint-ignore no-await-in-loop
        const result = await runArm(
          armByName.get("census")!,
          sweepSettings,
          seed,
          splits,
        );
        results.push(result);
        calibrationRecordsCharged += result.recordsCharged;
      } catch (error) {
        failures.push({
          arm: `census q=${q} W=${w} (calibration)`,
          seed,
          error: String(error),
        });
        console.error(
          `  calibration census q=${q} W=${w} seed ${seed} FAILED: ${error}`,
        );
      }
    }
    if (results.length > 0) {
      calibrationRows.push(summariseCalibration(q, w, results));
    }
  }

  console.info(
    `\nHoldout target (median calibration none holdout MSE): ${
      fmt(holdoutTarget ?? null)
    }`,
  );
  console.info("Collision-sensitivity table (calibration seeds):");
  console.info(
    "  q      W  medTrainMSE  medRestarts  medFirstRestart  collision  unseen",
  );
  for (const row of calibrationRows) {
    console.info(
      `  ${String(row.q).padEnd(6)} ${row.w}  ${
        fmt(row.medianFinalTrainMse).padEnd(11)
      }  ${String(row.medianRestarts).padEnd(11)}  ${
        fmt(row.medianFirstRestartRecords).padEnd(15)
      }  ${fmt(row.meanCollisionRate, 3).padEnd(9)}  ${
        fmt(row.meanUnseenEstimate, 3)
      }`,
    );
  }
  if (calibrationRows.length === 0) {
    console.error("no calibration rows; cannot choose a census setting");
    Deno.exit(1);
  }
  const chosen = chooseCensusSetting(calibrationRows);
  console.info(
    `Chosen census setting: q=${chosen.q} W=${chosen.w}; calibration records charged ${calibrationRecordsCharged}`,
  );
  const settings: StudySettings = {
    ...baseSettings,
    censusQuantisation: chosen.q,
    censusWindowGenerations: chosen.w,
  };

  // Validation.
  const runs = new Map<string, Map<number, ArmResult>>();
  const attempted = new Map<string, number>();
  for (const arm of STUDY_ARMS) {
    runs.set(arm.name, new Map());
    attempted.set(arm.name, 0);
    for (const seed of validationSeeds) {
      attempted.set(arm.name, attempted.get(arm.name)! + 1);
      try {
        // deno-lint-ignore no-await-in-loop
        const result = await runArm(arm, settings, seed, splits, holdoutTarget);
        runs.get(arm.name)!.set(seed, result);
        console.info(
          `  ${arm.name.padEnd(11)} seed ${seed}  holdout MSE ${
            fmt(result.finalHoldoutMse)
          }  records ${result.recordsCharged}  gens ${result.generations}  restarts ${result.restarts}  ${
            (result.wallMs / 1000).toFixed(1)
          }s`,
        );
      } catch (error) {
        failures.push({ arm: arm.name, seed, error: String(error) });
        console.error(`  ${arm.name} seed ${seed} FAILED: ${error}`);
      }
    }
  }

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
      a.map((r) => r.finalHoldoutMse),
      c.map((r) => r.finalHoldoutMse),
      BOOTSTRAP_RESAMPLES,
      BOOTSTRAP_SEED,
    );
    const spread = seeds.length >= 2
      ? sdRatio(
        a.map((r) => r.finalHoldoutMse),
        c.map((r) => r.finalHoldoutMse),
        BOOTSTRAP_RESAMPLES,
        BOOTSTRAP_SEED,
      )
      : null;
    const diversityRatio = mean(a.map((r) => r.meanBehaviouralDiversity)) /
      mean(c.map((r) => r.meanBehaviouralDiversity));
    return {
      label,
      ...contrast,
      seeds: seeds.length,
      heldOutMse: holdout,
      sdRatio: spread,
      diversityRatio,
      verdict: verdict(holdout, diversityRatio, SUCCESS_CRITERIA),
    };
  });

  console.info(
    "\nContrasts (held-out MSE, arm - baseline; negative is better):",
  );
  for (const c of comparisons) {
    if (c.seeds === 0 || !("heldOutMse" in c)) {
      console.info(`  ${c.label}: no paired seeds`);
      continue;
    }
    const h = c.heldOutMse;
    console.info(
      `  ${c.label.padEnd(22)} n=${h.n} diff ${fmt(h.meanDiff)} ci95 [${
        fmt(h.ci95[0])
      }, ${fmt(h.ci95[1])}] wins ${h.wins}/${h.n} diversity x${
        fmt(c.diversityRatio, 3)
      } sd x${fmt(c.sdRatio?.ratio ?? null, 3)} -> ${c.verdict}`,
    );
  }

  const armSummaries = STUDY_ARMS.map((arm) => {
    const rs = [...runs.get(arm.name)!.values()];
    return {
      arm: arm.name,
      completed: rs.length,
      attempted: attempted.get(arm.name)!,
      medianFinalHoldoutMse: rs.length === 0
        ? null
        : median(rs.map((r) => r.finalHoldoutMse)),
      medianRecordsToHoldoutTarget: medianOrNull(
        rs.map((r) => r.recordsToHoldoutTarget),
      ),
      holdoutTargetHits: rs.filter((r) => r.recordsToHoldoutTarget !== null)
        .length,
      medianRestarts: rs.length === 0
        ? null
        : median(rs.map((r) => r.restarts)),
      medianRestartDelayRecords: medianOrNull(
        rs.map((r) => r.restartDelayRecords),
      ),
      unfilledSlots: rs.reduce((sum, r) => sum + r.unfilledSlots, 0),
      generations: rs.reduce((sum, r) => sum + r.generations, 0),
    };
  });
  console.info("\nCoverage and per-arm summary:");
  for (const s of armSummaries) {
    console.info(
      `  ${s.arm.padEnd(11)} ${s.completed}/${s.attempted}  median holdout ${
        fmt(s.medianFinalHoldoutMse)
      }  to-target median ${
        fmt(s.medianRecordsToHoldoutTarget)
      } (hits ${s.holdoutTargetHits})  restarts median ${
        fmt(s.medianRestarts)
      }  restart delay median ${
        fmt(s.medianRestartDelayRecords)
      }  unfilled ${s.unfilledSlots}`,
    );
  }

  if (jsonPath !== undefined) {
    const firstSeed = validationSeeds[0];
    const perRun = STUDY_ARMS.flatMap((arm) =>
      validationSeeds.flatMap((seed) => {
        const result = runs.get(arm.name)!.get(seed);
        if (result === undefined) return [];
        const { trace, ...rest } = result;
        return [{ ...rest, ...(seed === firstSeed ? { trace } : {}) }];
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
      calibrationTable: calibrationRows,
      chosenCensusSetting: { q: chosen.q, w: chosen.w },
      holdoutTarget: holdoutTarget ?? null,
      settings,
      criteria: SUCCESS_CRITERIA,
      arms: STUDY_ARMS,
      contrasts: PREDECLARED_CONTRASTS,
      budgetPolicy:
        "records charged held equal; holdout and diversity probe uncharged; holdout read each generation for measurement only; wall-clock reported, not capped",
      paper: {
        id: "arXiv 2610.22211",
        note:
          "not fetched; the method is this repository's reading of the issue",
      },
      limitation: LIMITATION,
    };
    await Deno.writeTextFile(
      jsonPath,
      `${
        JSON.stringify(
          {
            manifest,
            coverage: armSummaries,
            failures,
            comparisons,
            results: perRun,
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
