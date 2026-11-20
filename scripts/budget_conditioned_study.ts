/**
 * Issue #4161 — one genome expressed at multiple complexity budgets.
 *
 * ```bash
 * deno task budget-conditioned-study --json=docs/evidence/budget-conditioned-4161.json
 * ```
 *
 * Flags: `--seeds`, `--base-seed`, `--budget` (charged records per arm per
 * seed), `--population`, `--json=<path>`, `--code-version`, `--no-latency`
 * (latency is measured when absent). Exits 1 when any run failed, so a partial
 * study is never read as a complete one.
 *
 * Four arms run: `conditioned` (no budget input), `independent`, `pruned` and
 * `budgetInput` (the budget is a linear input per synapse). The conditioned
 * outcome is printed first, then the `budgetInput` block.
 *
 * A measurement harness: nothing under `src/` imports it.
 */

import { intArg, stringArg } from "./lib/cliArgs.ts";
import {
  DEFAULT_SETTINGS,
  runStudy,
  SEED_COUNT,
  VALIDATION_BASE_SEED,
} from "./lib/budgetConditionedStudy.ts";

const args = Deno.args;
const study = runStudy({
  codeVersion: stringArg(args, "code-version"),
  seedCount: intArg(args, "seeds", SEED_COUNT),
  baseSeed: intArg(args, "base-seed", VALIDATION_BASE_SEED),
  budgetRecords: intArg(args, "budget", DEFAULT_SETTINGS.budgetRecords),
  populationSize: intArg(args, "population", DEFAULT_SETTINGS.mu),
  settings: { measureLatency: !args.includes("--no-latency") },
});

const fmt = (v: number | null) => v === null ? "-" : v.toPrecision(4);
console.info(
  "Issue #4161 budget-conditioned study (synthetic 4-input regression)",
);
console.info(
  "\narm          budget  n  medVal    uqVal     medEff  expr   invalid  latUs",
);
for (const row of study.perArmBudget) {
  console.info(
    `${row.arm.padEnd(12)} ${String(row.budget).padEnd(7)} ${
      String(row.n).padStart(2)
    } ${fmt(row.medianValidation).padEnd(9)} ${
      fmt(row.upperQuartileValidation).padEnd(9)
    } ${fmt(row.medianEffectiveSynapses).padEnd(7)} ${
      fmt(row.meanExpressivity).padEnd(6)
    } ${String(row.invalid).padStart(7)}  ${fmt(row.medianLatencyMicros)}`,
  );
}
const line = (
  name: string,
  c: typeof study.fullSize,
) =>
  console.info(
    `${name.padEnd(28)} ${c.verdict.padEnd(18)} diff ${fmt(c.meanDiff)} CI [${
      fmt(c.ci.low)
    }, ${fmt(c.ci.high)}] wins ${c.wins} losses ${c.losses} n ${c.n}`,
  );
console.info(
  "\nPrimary (unseen budgets, validation MSE, conditioned - control):",
);
line("vs independent", study.primary.vsIndependent);
line("vs pruned", study.primary.vsPruned);
line("full size vs pruned", study.fullSize);
console.info("\nExploratory per budget:");
for (const p of study.perBudget) {
  line(`${p.budget} vs independent`, p.vsIndependent);
  line(`${p.budget} vs pruned`, p.vsPruned);
}
console.info(`\nOutcome: ${study.outcome.outcome}`);
for (const reason of study.outcome.reasons) console.info(`  - ${reason}`);
const bi = study.budgetInput;
console.info(
  "\nbudgetInput arm (unseen budgets, validation MSE, budgetInput - control):",
);
line("budgetInput vs independent", bi.primary.vsIndependent);
line("budgetInput vs pruned", bi.primary.vsPruned);
line("budgetInput full size vs pruned", bi.fullSize);
line("budgetInput vs conditioned (exploratory)", bi.vsConditioned);
console.info(`budgetInput outcome: ${bi.outcome.outcome}`);
for (const reason of bi.outcome.reasons) console.info(`  - ${reason}`);
const cov = study.coverage;
console.info(
  `\nCoverage: ${cov.completedRuns}/${cov.expectedRuns} runs, ${cov.failures.length} failures`,
);
for (const failure of cov.failures) {
  console.error(
    `FAILED ${failure.arm} seed ${failure.seed}: ${failure.message}`,
  );
}

const jsonPath = stringArg(args, "json");
if (jsonPath !== undefined) {
  await Deno.writeTextFile(jsonPath, `${JSON.stringify(study, null, 2)}\n`);
  console.info(`Wrote ${jsonPath}`);
}
if (cov.failures.length > 0) Deno.exit(1);
