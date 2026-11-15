/**
 * Issue #4162 — separate topology gains from new-edge weight-placement luck.
 *
 * ```bash
 * deno task topology-weight-luck-study --json=docs/evidence/topology-weight-luck-4162.json
 * ```
 *
 * Flags: `--parent-runs`, `--parents-per-run`, `--population`,
 * `--generations`, `--json=<path>`, `--code-version`. Exits 1 when any parent
 * or mutation failed, so a partial study is never read as a complete one.
 *
 * A measurement harness: nothing under `src/` imports it.
 */

import { intArg, stringArg } from "./lib/cliArgs.ts";
import {
  DEFAULT_SETTINGS,
  type PrecisionComparison,
  runStudy,
} from "./lib/topologyWeightLuckStudy.ts";

const args = Deno.args;
const study = runStudy({
  codeVersion: stringArg(args, "code-version"),
  settings: {
    parentRuns: intArg(args, "parent-runs", DEFAULT_SETTINGS.parentRuns),
    parentsPerRun: intArg(
      args,
      "parents-per-run",
      DEFAULT_SETTINGS.parentsPerRun,
    ),
    populationSize: intArg(args, "population", DEFAULT_SETTINGS.populationSize),
    generations: intArg(args, "generations", DEFAULT_SETTINGS.generations),
  },
});

const fmt = (v: number | null, digits = 3) =>
  v === null ? "-" : v.toPrecision(digits);
console.info(
  "Issue #4162 topology gains versus weight-placement luck (synthetic 4-input regression)",
);
console.info(
  "\nrule           selected  precTrain  precHoldout  meanHoldoutGain  costRecords",
);
for (const row of study.rules) {
  console.info(
    `${row.rule.padEnd(14)} ${String(row.selected).padStart(8)}  ${
      fmt(row.precisionTrain).padEnd(9)
    }  ${fmt(row.precisionHoldout).padEnd(11)}  ${
      fmt(row.meanHoldoutGainSelected).padEnd(15)
    }  ${row.selectionCostRecords}`,
  );
}
const line = (label: string, c: PrecisionComparison) =>
  console.info(
    `${label} ${c.a} - ${c.b}: ${c.verdict} (observed ${fmt(c.observed)}, CI ${
      c.ci === null ? "-" : `[${fmt(c.ci.low)}, ${fmt(c.ci.high)}]`
    }, undefined resamples ${c.undefinedResamples}/${c.resamples})`,
  );
console.info("");
line("Primary  ", study.primary);
line("Secondary", study.secondary);
const cov = study.coverage;
console.info(
  `\nCoverage: ${cov.actualParents}/${cov.targetParents} parents, ${cov.mutationsEvaluated} mutations, ${cov.failures.length} failures`,
);
for (const failure of cov.failures) {
  console.error(
    `FAILED ${failure.stage} ${failure.parentId}: ${failure.message}`,
  );
}

const jsonPath = stringArg(args, "json");
if (jsonPath !== undefined) {
  await Deno.writeTextFile(jsonPath, `${JSON.stringify(study, null, 2)}\n`);
  console.info(`Wrote ${jsonPath}`);
}
if (cov.failures.length > 0) Deno.exit(1);
