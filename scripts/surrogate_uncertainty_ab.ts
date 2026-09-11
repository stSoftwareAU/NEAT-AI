/**
 * Issue #3933 — same-seed A/B of the surrogate uncertainty guard.
 *
 * Two arms, same seed, same seeded starting population, same surrogate screen.
 * The only difference is the guard:
 *
 * - **`guarded`** — predictions carry a mandatory uncertainty, candidates the
 *   model refuses to predict are routed to an exact evaluation, a stated
 *   minimum fraction of the exact evaluations goes to the least-certain
 *   candidates, and a one-directional signed bias disables the surrogate path.
 * - **`unguarded`** — the Issue #3932 behaviour: rank by predicted score and
 *   keep the top of the ranking. This is the policy that guarantees the model
 *   is never corrected where it is wrong.
 *
 * The issue asks for the comparison to be judged on **final exact score** over
 * at least 100 generations, and reported **whichever way it goes** — a guarded
 * run that lands on a worse exact score is a finding about this fleet, not a
 * bug to tune away.
 *
 * ```bash
 * deno task surrogate-uncertainty-ab --generations=120 --replicates=3 \
 *   --json=docs/evidence/surrogate-uncertainty-3933.json
 * ```
 *
 * The objective is synthetic and says so on every line of output: what this
 * measures is the **guard** — refuse, explore, detect drift — not how a
 * 5,317-neuron GRQ creature behaves.
 *
 * A measurement harness, not a production code path: nothing under `src/`
 * imports it and it changes no scoring behaviour.
 */

import {
  type ABArm,
  type ABResult,
  type ABSettings,
  buildCorpus,
  DEFAULT_AB_SETTINGS,
  runArm,
} from "./lib/preSelectionAB.ts";

/** Read a `--name=value` flag, failing loud on a value that is not a number. */
function numberFlag(args: string[], name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  if (found === undefined) return fallback;
  const value = Number(found.slice(prefix.length));
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} must be a number, got ${found}`);
  }
  return value;
}

/** Read a `--name=value` string flag. */
function stringFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/** Arithmetic mean; `NaN` for an empty sample rather than a fabricated zero. */
function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** A delta with an explicit sign, so a regression reads as one. */
function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toExponential(3)}`;
}

/** The two arms: the same screen, guarded and unguarded. */
const ARMS: readonly ABArm[] = Object.freeze([
  {
    arm: "unguarded",
    ratio: 3,
    screen: "surrogate",
    randomSurvivorFraction: 0.25,
    uncertainty: { enabled: false },
  },
  {
    arm: "guarded",
    ratio: 3,
    screen: "surrogate",
    randomSurvivorFraction: 0.25,
    uncertainty: { enabled: true },
  },
]);

/** Run both arms across the replicate seeds and report. */
async function main(): Promise<void> {
  const args = [...Deno.args];
  const generations = numberFlag(args, "generations", 120);
  if (generations < 100) {
    throw new Error(
      `--generations must be at least 100: the issue judges this comparison ` +
        `on the final exact score over a long horizon, and a short run ` +
        `measures the guard's cost without reaching what it buys, got ` +
        `${generations}`,
    );
  }
  const replicates = numberFlag(args, "replicates", 3);
  const settings: ABSettings = {
    ...DEFAULT_AB_SETTINGS,
    generations,
    seed: numberFlag(args, "seed", DEFAULT_AB_SETTINGS.seed),
    populationSize: numberFlag(
      args,
      "population",
      DEFAULT_AB_SETTINGS.populationSize,
    ),
  };

  console.info(
    `Surrogate uncertainty A/B (Issue #3933): ${replicates} seed(s) x ` +
      `${settings.generations} generations, population ` +
      `${settings.populationSize}. Synthetic objective — this measures the ` +
      `guard, not a GRQ creature.`,
  );

  const perSeed: ABResult[][] = [];
  for (let replicate = 0; replicate < replicates; replicate++) {
    const seedSettings: ABSettings = {
      ...settings,
      seed: settings.seed + replicate,
    };
    const corpus = buildCorpus(seedSettings);
    const row: ABResult[] = [];
    for (const arm of ARMS) {
      // Arms are sequential by design: both must see the same global random
      // generator state, which `runArm` seeds and restores around each run.
      // deno-lint-ignore no-await-in-loop
      row.push(await runArm(arm, seedSettings, corpus));
    }
    perSeed.push(row);
    console.info(
      `  seed ${seedSettings.seed}: ` +
        row.map((result) => `${result.arm} ${result.finalScore.toFixed(6)}`)
          .join("  "),
    );
  }

  const summary = ARMS.map((arm, armIndex) => {
    const rows = perSeed.map((row) => row[armIndex]);
    const guards = rows.map((row) => row.surrogate).filter((d) =>
      d !== undefined
    );
    return {
      arm: arm.arm,
      guard: arm.uncertainty?.enabled !== false,
      meanFinalScore: mean(rows.map((row) => row.finalScore)),
      meanExactEvaluations: mean(rows.map((row) => row.exactEvaluations)),
      meanRecordsScored: mean(rows.map((row) => row.recordsScored)),
      meanCandidatesConsidered: mean(
        rows.map((row) => row.candidatesConsidered),
      ),
      diagnostics: guards.length === 0 ? null : {
        meanUncertaintyFraction: mean(
          guards.map((d) => d.uncertaintyFraction),
        ),
        meanOutOfDistributionRate: mean(
          guards.map((d) => d.outOfDistributionRate),
        ),
        meanSignedBias: mean(guards.map((d) => d.signedBias)),
        runsDisabled: guards.filter((d) => d.disabled).length,
      },
    };
  });

  const control = summary[0];
  console.info("\nFinal exact score — the number the issue judges this on:");
  for (const arm of summary) {
    console.info(
      `  ${arm.arm.padEnd(11)} ${arm.meanFinalScore.toFixed(6)}  vs ` +
        `unguarded ${signed(arm.meanFinalScore - control.meanFinalScore)}`,
    );
  }

  console.info("\nGuard diagnostics (per run):");
  for (const arm of summary) {
    if (arm.diagnostics === null) {
      console.info(`  ${arm.arm.padEnd(11)} no guard — nothing to report`);
      continue;
    }
    console.info(
      `  ${arm.arm.padEnd(11)} uncertainty allocation ` +
        `${(arm.diagnostics.meanUncertaintyFraction * 100).toFixed(1)}%, ` +
        `OOD rate ` +
        `${(arm.diagnostics.meanOutOfDistributionRate * 100).toFixed(1)}%, ` +
        `signed bias ${arm.diagnostics.meanSignedBias.toExponential(3)}, ` +
        `disabled on ${arm.diagnostics.runsDisabled}/${perSeed.length} run(s)`,
    );
  }

  const delta = summary[1].meanFinalScore - control.meanFinalScore;
  console.info(
    `\nVerdict: the guarded arm ended ${
      delta >= 0 ? "ahead of" : "behind"
    } the unguarded one by ${Math.abs(delta).toExponential(3)} on mean final ` +
      `exact score. Reported whichever way it goes — a guarded run that ` +
      `lands lower is a finding about this fleet, not a bug to tune away.`,
  );

  const jsonPath = stringFlag(args, "json");
  if (jsonPath !== undefined) {
    await Deno.writeTextFile(
      jsonPath,
      JSON.stringify(
        {
          issue: 3933,
          settings: { ...settings, replicates },
          arms: ARMS,
          summary,
          perSeed: perSeed.map((row) =>
            row.map(({ generations: _trace, eliteScreenRanks: _ranks, ...r }) =>
              r
            )
          ),
        },
        null,
        2,
      ),
    );
    console.info(`\nWrote ${jsonPath}`);
  }
}

if (import.meta.main) {
  await main();
}
