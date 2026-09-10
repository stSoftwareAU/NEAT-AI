/**
 * Issue #3931 — same-seed A/B of the evolution-control strategies.
 *
 * Runs control (`"none"`) against `"generation"` and `"individual"` over the
 * same seeded objective and the same seeded starting population, and judges
 * them on the **exact score of the final creature**, not on generations
 * completed. More generations at a worse endpoint is a regression, and it is
 * the specific regression the whole #3919 sweep risks.
 *
 * Two comparisons are reported because they answer different questions:
 *
 * - **Equal generations** — did the cheap path reach a worse endpoint in the
 *   same number of generations?
 * - **Equal record budget** — the question the GRQ regime actually asks. A run
 *   has a wall-clock budget, an exact evaluation costs the whole corpus, and a
 *   cheap one costs its sampled fraction, so the arms are read at the point
 *   where they had each scored the same number of records.
 *
 * ```bash
 * deno run --allow-read --allow-write --allow-env --allow-ffi \
 *   scripts/evolution_control_ab.ts \
 *   --generations=60 --cheap-rate=0.05 --seed=3931 \
 *   --json=docs/evidence/evolution-control-3931.json
 * ```
 *
 * The objective is synthetic and says so on every line of output: after Issue
 * #3927 (no sampling rate is safe on the real lineage) and Issue #3930 (the
 * surrogate kill gate could not be decided), there is no cheap evaluator
 * production may switch to, so an A/B on the real corpus would be measuring a
 * path nothing is allowed to take. What this measures is the **policy**.
 *
 * A measurement harness, not a production code path: nothing under `src/`
 * imports it and it changes no scoring behaviour.
 */

import {
  type ABResult,
  type ABSettings,
  buildCorpus,
  DEFAULT_AB_SETTINGS,
  runArm,
  scoreAtBudget,
} from "./lib/evolutionControlAB.ts";
import type { EvolutionControlConfig } from "@config/EvolutionControlConfig.ts";

/** One arm of the A/B: a label and the policy configuration behind it. */
interface Arm {
  readonly label: string;
  readonly config: EvolutionControlConfig;
}

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
function stringFlag(
  args: string[],
  name: string,
): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
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

/** Format a score with enough digits to see a 1e-5 difference. */
function fmt(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(6);
}

if (import.meta.main) {
  const args = [...Deno.args];
  const settings: ABSettings = {
    ...DEFAULT_AB_SETTINGS,
    seed: numberFlag(args, "seed", DEFAULT_AB_SETTINGS.seed),
    generations: numberFlag(
      args,
      "generations",
      DEFAULT_AB_SETTINGS.generations,
    ),
    corpusRecords: numberFlag(
      args,
      "corpus-records",
      DEFAULT_AB_SETTINGS.corpusRecords,
    ),
    populationSize: numberFlag(
      args,
      "population",
      DEFAULT_AB_SETTINGS.populationSize,
    ),
    cheapRate: numberFlag(args, "cheap-rate", DEFAULT_AB_SETTINGS.cheapRate),
  };
  if (settings.generations < 50) {
    throw new Error(
      `Issue #3931 requires at least 50 generations, got ` +
        `${settings.generations}`,
    );
  }

  const arms: Arm[] = [
    { label: "none", config: { strategy: "none" } },
    { label: "generation", config: { strategy: "generation", exactEvery: 5 } },
    {
      label: "individual",
      config: {
        strategy: "individual",
        exactTopK: 2,
        diverseSampleSize: 2,
      },
    },
  ];

  const replicates = numberFlag(args, "replicates", 5);
  if (!Number.isSafeInteger(replicates) || replicates < 1) {
    throw new Error(`--replicates must be an integer >= 1, got ${replicates}`);
  }

  console.info(
    `Evolution-control A/B — synthetic objective, seeds ${settings.seed}..${
      settings.seed + replicates - 1
    }, ${settings.generations} generations, population ` +
      `${settings.populationSize}, corpus ${settings.corpusRecords} records, ` +
      `cheap rate ${settings.cheapRate}`,
  );

  /** Every arm's result for one seed, control first. */
  const perSeed: ABResult[][] = [];
  for (let replicate = 0; replicate < replicates; replicate++) {
    const seeded: ABSettings = { ...settings, seed: settings.seed + replicate };
    const { records } = buildCorpus(seeded);
    const row: ABResult[] = [];
    for (const arm of arms) {
      const startedMs = performance.now();
      const result = runArm(arm.label, arm.config, records, seeded);
      row.push(result);
      console.info(
        `  seed ${seeded.seed}  ${arm.label.padEnd(11)} final exact ${
          fmt(result.finalExactScore)
        }  exact ${String(result.exactEvaluations).padStart(5)}  ` +
          `cheap ${String(result.approximateEvaluations).padStart(5)}  ` +
          `records ${result.recordsScored.toExponential(3)}  ` +
          `${((performance.now() - startedMs) / 1000).toFixed(1)}s`,
      );
    }
    perSeed.push(row);
  }

  console.info(
    "\nEqual generations — mean final exact score across seeds, higher is better:",
  );
  arms.forEach((arm, armIndex) => {
    const finals = perSeed.map((row) => row[armIndex].finalExactScore);
    const deltas = perSeed.map((row) =>
      row[armIndex].finalExactScore - row[0].finalExactScore
    );
    const wins = deltas.filter((d) => d > 0).length;
    console.info(
      `  ${arm.label.padEnd(11)} ${fmt(mean(finals))}  vs control mean ` +
        `${signed(mean(deltas))}  better on ${wins}/${perSeed.length} seeds`,
    );
  });

  console.info(
    "\nEqual record budget — each seed read at the cheapest arm's total cost:",
  );
  arms.forEach((arm, armIndex) => {
    const atBudget: number[] = [];
    const deltas: number[] = [];
    perSeed.forEach((row) => {
      const budget = Math.min(...row.map((r) => r.recordsScored));
      const armScore = scoreAtBudget(row[armIndex], budget);
      const controlScore = scoreAtBudget(row[0], budget);
      if (armScore === null || controlScore === null) return;
      atBudget.push(armScore);
      deltas.push(armScore - controlScore);
    });
    const wins = deltas.filter((d) => d > 0).length;
    console.info(
      `  ${arm.label.padEnd(11)} ${fmt(mean(atBudget))}  vs control mean ` +
        `${signed(mean(deltas))}  better on ${wins}/${deltas.length} seeds`,
    );
  });

  console.info("\nFalse-optimum canary:");
  arms.forEach((arm, armIndex) => {
    const rows = perSeed.map((row) => row[armIndex]);
    const divergences = rows.flatMap((r) => r.canaryDivergences);
    const escalated = rows.filter((r) => r.escalatedGeneration !== null);
    const summary = divergences.length === 0
      ? "no readings (nothing approximate to compare)"
      : `${divergences.length} readings, min ${
        Math.min(...divergences).toFixed(3)
      }, mean ${mean(divergences).toFixed(3)}, max ${
        Math.max(...divergences).toFixed(3)
      }`;
    console.info(
      `  ${
        arm.label.padEnd(11)
      } ${summary}; escalated on ${escalated.length}/${rows.length} seeds` +
        (escalated.length > 0
          ? ` (generations ${
            escalated.map((r) => r.escalatedGeneration).join(", ")
          })`
          : ""),
    );
  });

  const results = perSeed;
  const jsonPath = stringFlag(args, "json");
  if (jsonPath !== undefined) {
    // The per-generation traces are dropped from the artefact: they are what
    // the equal-budget read above is computed from, and keeping 10 seeds of
    // them turns a readable report into 100 KB of numbers nobody reads.
    const trimmed = results.map((row) =>
      row.map(({ incumbentTrace: _t, recordsTrace: _r, ...rest }) => rest)
    );
    await Deno.writeTextFile(
      jsonPath,
      JSON.stringify({ settings, replicates, results: trimmed }, null, 2),
    );
    console.info(`\nWrote ${jsonPath}`);
  }
}
