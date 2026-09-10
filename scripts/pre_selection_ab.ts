/**
 * Issue #3932 — same-seed A/B of offspring pre-selection.
 *
 * Runs control (`ratio: 1`, today's behaviour) against over-generated arms at
 * the same seed and the same seeded starting population, and reports the two
 * things the issue asks for:
 *
 * - **The endpoint**, judged on the exact score of the final creature and read
 *   both at equal generations and at equal record budget. More candidates
 *   considered at a worse endpoint is a regression.
 * - **Diversity**, judged on species count and mean genetic distance, both
 *   measured with the production functions. A screen that improves mean
 *   fitness while collapsing diversity has broken NEAT and looks like a
 *   success on the fitness trace.
 *
 * ```bash
 * deno run --allow-read --allow-write --allow-env --allow-ffi \
 *   scripts/pre_selection_ab.ts --generations=30 --replicates=5 \
 *   --json=docs/evidence/pre-selection-3932.json
 * ```
 *
 * The objective is synthetic and says so on every line of output: the corpus a
 * production run scores is 21 GiB behind the Rust scorer, and the cheap
 * fidelity Issue #3926 published lives in the data pipeline. What this
 * measures is the **stage** — over-generate, screen, discard — not how a
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
  CONTROL_ARM,
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

/**
 * The best score an arm had reached by the time it had scored `budget`
 * records, or `null` when it never got that far.
 */
function scoreAtBudget(result: ABResult, budget: number): number | null {
  let best: number | null = null;
  for (const generation of result.generations) {
    if (generation.recordsScored > budget) break;
    best = generation.bestScore;
  }
  return best;
}

/** Mean of a per-generation field across the whole trace. */
function traceMean(
  result: ABResult,
  field: "speciesCount" | "meanGeneticDistance",
): number {
  return mean(result.generations.map((generation) => generation[field]));
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
  const ratio = numberFlag(args, "ratio", 3);
  const replicates = numberFlag(args, "replicates", 5);
  if (!Number.isSafeInteger(replicates) || replicates < 1) {
    throw new Error(`--replicates must be an integer >= 1, got ${replicates}`);
  }

  const arms: ABArm[] = [
    CONTROL_ARM,
    { arm: "sampled", ratio, screen: "sampled" },
    { arm: "surrogate", ratio, screen: "surrogate" },
    // The diversity control: the same surplus, kept entirely at random. If a
    // screened arm cannot beat this, the screen is not what is doing the work.
    {
      arm: "random-only",
      ratio,
      screen: "surrogate",
      randomSurvivorFraction: 1,
    },
  ];

  console.info(
    `Pre-selection A/B — synthetic objective, seeds ${settings.seed}..${
      settings.seed + replicates - 1
    }, ${settings.generations} generations, population ` +
      `${settings.populationSize}, corpus ${settings.corpusRecords} records, ` +
      `ratio ${ratio}, cheap rate ${settings.cheapRate}`,
  );

  /** Every arm's result for one seed, control first. */
  const perSeed: ABResult[][] = [];
  for (let replicate = 0; replicate < replicates; replicate++) {
    const seeded: ABSettings = { ...settings, seed: settings.seed + replicate };
    const corpus = buildCorpus(seeded);
    const row: ABResult[] = [];
    for (const arm of arms) {
      const startedMs = performance.now();
      const result = await runArm(arm, seeded, corpus);
      row.push(result);
      console.info(
        `  seed ${seeded.seed}  ${arm.arm.padEnd(12)} final ${
          result.finalScore.toFixed(6)
        }  candidates ${String(result.candidatesConsidered).padStart(5)}  ` +
          `exact ${String(result.exactEvaluations).padStart(5)}  ` +
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
    const finals = perSeed.map((row) => row[armIndex].finalScore);
    const deltas = perSeed.map((row) =>
      row[armIndex].finalScore - row[0].finalScore
    );
    const wins = deltas.filter((delta) => delta > 0).length;
    console.info(
      `  ${arm.arm.padEnd(12)} ${mean(finals).toFixed(6)}  vs control mean ` +
        `${signed(mean(deltas))}  better on ${wins}/${perSeed.length} seeds`,
    );
  });

  console.info(
    "\nEqual record budget — each seed read at the cheapest arm's total cost:",
  );
  arms.forEach((arm, armIndex) => {
    const deltas: number[] = [];
    const atBudget: number[] = [];
    perSeed.forEach((row) => {
      const budget = Math.min(...row.map((result) => result.recordsScored));
      const armScore = scoreAtBudget(row[armIndex], budget);
      const controlScore = scoreAtBudget(row[0], budget);
      if (armScore === null || controlScore === null) return;
      atBudget.push(armScore);
      deltas.push(armScore - controlScore);
    });
    const wins = deltas.filter((delta) => delta > 0).length;
    console.info(
      `  ${arm.arm.padEnd(12)} ${mean(atBudget).toFixed(6)}  vs control mean ` +
        `${signed(mean(deltas))}  better on ${wins}/${deltas.length} seeds`,
    );
  });

  console.info(
    "\nDiversity — the regression that would not show in the fitness trace:",
  );
  arms.forEach((arm, armIndex) => {
    const rows = perSeed.map((row) => row[armIndex]);
    const species = mean(rows.map((row) => traceMean(row, "speciesCount")));
    const distance = mean(
      rows.map((row) => traceMean(row, "meanGeneticDistance")),
    );
    const controlSpecies = mean(
      perSeed.map((row) => traceMean(row[0], "speciesCount")),
    );
    const controlDistance = mean(
      perSeed.map((row) => traceMean(row[0], "meanGeneticDistance")),
    );
    console.info(
      `  ${arm.arm.padEnd(12)} species ${species.toFixed(2)} (${
        signed(species - controlSpecies)
      })  mean genetic distance ${distance.toFixed(4)} (${
        signed(distance - controlDistance)
      })`,
    );
  });

  console.info("\nScreen rank of the creatures that became elites:");
  arms.forEach((arm, armIndex) => {
    const ranks = perSeed.flatMap((row) => row[armIndex].eliteScreenRanks);
    if (ranks.length === 0) {
      console.info(`  ${arm.arm.padEnd(12)} no screened elites`);
      return;
    }
    const percentiles = ranks.map((rank) =>
      rank.rank / Math.max(1, rank.of - 1)
    );
    const random = ranks.filter((rank) => rank.reason === "random").length;
    console.info(
      `  ${
        arm.arm.padEnd(12)
      } ${ranks.length} elites, mean screen percentile ` +
        `${mean(percentiles).toFixed(3)} (0 = the screen's top pick, 1 = its ` +
        `worst), ${random} kept by the uniform draw`,
    );
  });

  const jsonPath = stringFlag(args, "json");
  if (jsonPath !== undefined) {
    // The per-elite ranks are aggregated in the artefact: every screened elite
    // of every seed is thousands of rows nobody reads, and the number the issue
    // asks for is the distribution, not the roll.
    const trimmed = perSeed.map((row) =>
      row.map(({ eliteScreenRanks, generations, ...rest }) => ({
        ...rest,
        // Every fifth generation, plus the ends: the trend is what a reader
        // needs, and ten seeds of every row is 400 KB nobody opens.
        generations: generations.filter((generation, index) =>
          index === 0 || index === generations.length - 1 ||
          generation.generation % 5 === 0
        ),
        eliteScreenRanks: {
          elites: eliteScreenRanks.length,
          meanPercentile: mean(
            eliteScreenRanks.map((rank) =>
              rank.rank / Math.max(1, rank.of - 1)
            ),
          ),
          keptAtRandom: eliteScreenRanks.filter((rank) =>
            rank.reason === "random"
          ).length,
        },
      }))
    );
    await Deno.writeTextFile(
      jsonPath,
      JSON.stringify(
        { settings, ratio, replicates, results: trimmed },
        null,
        2,
      ),
    );
    console.info(`\nWrote ${jsonPath}`);
  }
}
