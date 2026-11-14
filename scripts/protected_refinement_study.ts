/**
 * Issue #4158 — short protected refinement for major topology mutations.
 *
 * ```bash
 * deno task protected-refinement-study --json=/tmp/study.json
 * ```
 *
 * Calibrates the refinement depth on train MSE, then compares the arms at equal
 * records charged over predeclared seeds. See
 * `scripts/lib/protectedRefinementStudy.ts` for what is real and what is a
 * stand-in. Exits 1 if any run failed.
 */

import { intArg, numberArg, stringArg } from "./lib/cliArgs.ts";
import {
  CALIBRATION_SEED_COUNT,
  DEFAULT_REFINEMENT_SETTINGS,
  runStudy,
  VALIDATION_BASE_SEED,
  VALIDATION_SEED_COUNT,
} from "./lib/protectedRefinementStudy.ts";

if (import.meta.main) {
  const args = [...Deno.args];
  const report = await runStudy({
    validationSeeds: intArg(args, "seeds", VALIDATION_SEED_COUNT),
    validationBaseSeed: numberArg(args, "base-seed", VALIDATION_BASE_SEED),
    calibrationSeeds: intArg(
      args,
      "calibration-seeds",
      CALIBRATION_SEED_COUNT,
    ),
    codeVersion: stringArg(args, "code-version") ?? "unknown",
    settings: {
      budgetRecords: intArg(
        args,
        "budget",
        DEFAULT_REFINEMENT_SETTINGS.budgetRecords,
      ),
      populationSize: intArg(
        args,
        "population",
        DEFAULT_REFINEMENT_SETTINGS.populationSize,
      ),
    },
    onProgress: (line) => console.info(`  ${line}`),
  });

  console.info("\nCalibration (median train MSE of protect-refine):");
  for (const row of report.calibrationTable) {
    console.info(
      `  R=${row.refineRounds}  median train MSE ${
        row.medianTrainMse.toExponential(4)
      }  records ${row.recordsSpent}  runs ${row.runs}`,
    );
  }
  console.info(`  chosen refineRounds: ${report.chosenRefineRounds}`);

  console.info(
    "\nComparisons (holdout MSE, arm minus baseline, negative better):",
  );
  for (const c of report.comparisons) {
    console.info(
      `  ${c.label.padEnd(36)} n=${c.n} mean ${c.meanDiff.toExponential(3)} ` +
        `CI95 [${c.ci95.lower.toExponential(3)}, ${
          c.ci95.upper.toExponential(3)
        }] ` +
        `W/L/T ${c.wins}/${c.losses}/${c.ties} species ratio ${
          c.speciesRatio.toFixed(2)
        } -> ${c.verdict}`,
    );
  }

  console.info("\nCoverage:");
  for (const [arm, cov] of Object.entries(report.coverage)) {
    console.info(`  ${arm.padEnd(18)} ${cov.completed}/${cov.planned}`);
  }

  for (const f of report.failures) {
    console.error(`FAILED ${f.arm} seed ${f.seed}: ${f.message}`);
  }

  const jsonPath = stringArg(args, "json");
  if (jsonPath !== undefined) {
    await Deno.writeTextFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    console.info(`\nWrote ${jsonPath}`);
  }
  if (report.failures.length > 0) Deno.exit(1);
}
