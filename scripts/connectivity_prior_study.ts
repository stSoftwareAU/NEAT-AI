/**
 * Issue #4160 — initial connectivity and input fan-out as interacting priors.
 *
 * ```bash
 * deno task connectivity-prior-study --json=docs/evidence/connectivity-prior-4160.json
 * ```
 *
 * Flags: `--seeds`, `--base-seed`, `--calibration-seeds`, `--budget`,
 * `--population`, `--json=<path>`, `--code-version`. Exits 1 when any run
 * failed, so a partial study is never read as a complete one.
 *
 * A measurement harness: nothing under `src/` imports it.
 */

import { intArg, stringArg } from "./lib/cliArgs.ts";
import {
  CALIBRATION_SEED_COUNT,
  DEFAULT_SETTINGS,
  runStudy,
  VALIDATION_BASE_SEED,
  VALIDATION_SEED_COUNT,
} from "./lib/connectivityPriorStudy.ts";

const args = Deno.args;
const study = runStudy({
  codeVersion: stringArg(args, "code-version"),
  validationSeedCount: intArg(args, "seeds", VALIDATION_SEED_COUNT),
  validationBaseSeed: intArg(args, "base-seed", VALIDATION_BASE_SEED),
  calibrationSeedCount: intArg(
    args,
    "calibration-seeds",
    CALIBRATION_SEED_COUNT,
  ),
  budgetRecords: intArg(args, "budget", DEFAULT_SETTINGS.budgetRecords),
  populationSize: intArg(args, "population", DEFAULT_SETTINGS.populationSize),
});

const fmt = (v: number | null) => v === null ? "-" : v.toPrecision(4);
const confirmatory = study.confirmatory;
console.info(
  `Issue #4160 connectivity prior study (synthetic 4-input regression)`,
);
console.info(
  `Chosen cell ${study.calibration.chosenCell}, threshold train MSE ${
    fmt(study.calibration.threshold)
  }, calibration records ${study.calibration.records}`,
);
console.info(
  confirmatory.comparison === null
    ? `Confirmatory ${confirmatory.arm}: no paired runs`
    : `Confirmatory ${confirmatory.arm}: ${confirmatory.comparison.verdict} (mean diff ${
      fmt(confirmatory.comparison.meanDiff)
    }, CI [${fmt(confirmatory.comparison.ci.low)}, ${
      fmt(confirmatory.comparison.ci.high)
    }], wins ${confirmatory.comparison.wins}, losses ${confirmatory.comparison.losses})`,
);
console.info(
  "\narm       n  medHold   uqHold    medTrain  medRecsToThr reached stalled",
);
for (const row of study.perArm) {
  console.info(
    `${row.arm.padEnd(9)} ${String(row.n).padStart(2)}  ${
      fmt(row.medianHoldout).padEnd(9)
    } ${fmt(row.upperQuartileHoldout).padEnd(9)} ${
      fmt(row.medianTrain).padEnd(9)
    } ${fmt(row.medianRecordsToThreshold).padEnd(12)} ${
      String(row.reachedThreshold).padStart(7)
    } ${String(row.stalled).padStart(7)}`,
  );
}
console.info("\nExploratory (not confirmatory):");
for (const e of study.exploratory) {
  if (e.comparison === null) continue;
  console.info(
    `  ${e.arm.padEnd(8)} ${e.comparison.verdict.padEnd(10)} diff ${
      fmt(e.comparison.meanDiff)
    } wins ${e.comparison.wins} losses ${e.comparison.losses}`,
  );
}
const cov = study.coverage;
console.info(
  `\nCoverage: ${cov.completedRuns}/${cov.expectedRuns} runs, ${cov.failures.length} failures`,
);
for (const failure of cov.failures) {
  console.error(
    `FAILED ${failure.phase} ${failure.arm} seed ${failure.seed}: ${failure.message}`,
  );
}

const jsonPath = stringArg(args, "json");
if (jsonPath !== undefined) {
  await Deno.writeTextFile(jsonPath, `${JSON.stringify(study, null, 2)}\n`);
  console.info(`Wrote ${jsonPath}`);
}
if (cov.failures.length > 0) Deno.exit(1);
