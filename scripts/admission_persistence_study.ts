/**
 * Issue #4163 — offspring admission versus durable lineage contribution.
 *
 * Runs uniform and calibrated-biased (capped 2:1 odds) parent selection over a
 * range of seeds, one corpus per seed shared by both arms, and reports initial
 * admission, persistence at 10/100/1000 generations and the paired held-out
 * comparison with a verdict against criteria fixed in advance.
 *
 * ```bash
 * deno task admission-persistence-study --seeds=20 --json=/tmp/aps.json \
 *   --species-csv=/tmp/aps-species.csv
 * ```
 *
 * Each seed runs in its own child process (a hidden `--single-seed=<n>
 * --out=<path>` worker mode), so heap growth across seeds cannot end the study;
 * a child that dies is recorded as a failure for both arms of that seed.
 *
 * The objective is synthetic (see `scripts/lib/admissionPersistenceStudy.ts`).
 * A measurement harness, not a production code path.
 */

import {
  ADMISSION_ARMS,
  type AdmissionArm,
  type AdmissionArmResult,
  type AdmissionSettings,
  DEFAULT_ADMISSION_SETTINGS,
  PREDECLARED_FIRST_SEED,
  PREDECLARED_SEEDS,
  runArm,
  type SpeciesPersistence,
} from "./lib/admissionPersistenceStudy.ts";
import {
  buildStratifiedCorpus,
  median,
  pairedComparison,
  SUCCESS_CRITERIA,
  verdict,
} from "./lib/lineageTargetingStudy.ts";
import { intArg, stringArg } from "./lib/cliArgs.ts";
import { dirtyTree, gitCommit } from "./lib/gitProvenance.ts";

const ratio = (n: number, d: number): number | null => d === 0 ? null : n / d;

/** Pool persistence counts across runs of one arm, per horizon. */
function pooled(runs: readonly AdmissionArmResult[]) {
  const horizons = runs[0]?.persistence.horizons.map((h) => h.horizon) ?? [];
  const offspring = runs.reduce((s, r) => s + r.persistence.offspring, 0);
  const admitted = runs.reduce((s, r) => s + r.persistence.admitted, 0);
  return {
    seeds: runs.length,
    offspring,
    admitted,
    admissionRate: ratio(admitted, offspring),
    meanTurnover: runs.length === 0
      ? null
      : runs.reduce((s, r) => s + r.meanTurnover, 0) / runs.length,
    horizons: horizons.map((horizon, i) => {
      const rows = runs.map((r) => r.persistence.horizons[i]);
      const sum = (pick: (h: typeof rows[number]) => number) =>
        rows.reduce((s, h) => s + pick(h), 0);
      const rates = rows.map((h) => h.contributionRateGivenAdmitted).filter((
        v,
      ): v is number => v !== null);
      return {
        horizon,
        eligible: sum((h) => h.eligible),
        censored: sum((h) => h.censored),
        admittedEligible: sum((h) => h.admittedEligible),
        survivalRate: ratio(sum((h) => h.survived), sum((h) => h.eligible)),
        survivalRateGivenAdmitted: ratio(
          sum((h) => h.survivedAdmitted),
          sum((h) => h.admittedEligible),
        ),
        contributionRate: ratio(
          sum((h) => h.contributors),
          sum((h) => h.eligible),
        ),
        contributionRateGivenAdmitted: ratio(
          sum((h) => h.contributorsAdmitted),
          sum((h) => h.admittedEligible),
        ),
        perSeedContributionRateGivenAdmitted: rates.length === 0 ? null : {
          median: median(rates),
          min: Math.min(...rates),
          max: Math.max(...rates),
          seeds: rates.length,
        },
        bySpecies: pooledBySpecies(rows.flatMap((h) => h.bySpecies)),
      };
    }),
  };
}

/**
 * Sum per-species persistence rows from several runs by species key. The key
 * is derived from architecture alone, so the same key names the same species
 * in every seed. `seeds` counts the runs the species appeared in.
 */
export function pooledBySpecies(rows: readonly SpeciesPersistence[]) {
  const groups = new Map<string, SpeciesPersistence[]>();
  for (const row of rows) {
    const own = groups.get(row.species);
    if (own === undefined) groups.set(row.species, [row]);
    else own.push(row);
  }
  return [...groups.entries()].map(([species, own]) => {
    const sum = (pick: (r: SpeciesPersistence) => number) =>
      own.reduce((s, r) => s + pick(r), 0);
    const admitted = sum((r) => r.admitted);
    return {
      species,
      seeds: own.length,
      offspring: sum((r) => r.offspring),
      admitted,
      survived: sum((r) => r.survived),
      survivedAdmitted: sum((r) => r.survivedAdmitted),
      contributors: sum((r) => r.contributors),
      contributorsAdmitted: sum((r) => r.contributorsAdmitted),
      survivalRateGivenAdmitted: ratio(
        sum((r) => r.survivedAdmitted),
        admitted,
      ),
      contributionRateGivenAdmitted: ratio(
        sum((r) => r.contributorsAdmitted),
        admitted,
      ),
    };
  }).sort((a, b) =>
    b.offspring - a.offspring ||
    (a.species < b.species ? -1 : a.species > b.species ? 1 : 0)
  );
}

type PooledSpecies = ReturnType<typeof pooledBySpecies>[number];

/** Species with fewer admitted offspring than this are left out of the spread. */
export const SPECIES_SPREAD_MIN_ADMITTED = 30;
/** Largest species (by offspring) listed in full in the JSON digest. */
export const SPECIES_DIGEST_TOP = 10;

/**
 * A compact digest of pooled per-species rows for the JSON artefact: species
 * counts, the never-admitted remainder, the spread of the per-species rate of
 * contribution given admission over species with at least
 * {@link SPECIES_SPREAD_MIN_ADMITTED} admitted offspring, and the
 * {@link SPECIES_DIGEST_TOP} largest species in full. The full table goes to
 * the CSV (`--species-csv`).
 */
export function speciesDigest(rows: readonly PooledSpecies[]) {
  const admitted = rows.filter((r) => r.admitted > 0);
  const never = rows.filter((r) => r.admitted === 0);
  const rates = rows.filter((r) => r.admitted >= SPECIES_SPREAD_MIN_ADMITTED)
    .map((r) => r.contributionRateGivenAdmitted!);
  const survivalRates = rows.filter((r) =>
    r.admitted >= SPECIES_SPREAD_MIN_ADMITTED
  ).map((r) => r.survivalRateGivenAdmitted!);
  const spread = (values: number[]) =>
    values.length === 0 ? null : {
      species: values.length,
      min: Math.min(...values),
      median: median(values),
      max: Math.max(...values),
    };
  return {
    species: rows.length,
    speciesWithAdmitted: admitted.length,
    speciesInSeveralSeeds: rows.filter((r) => r.seeds > 1).length,
    neverAdmitted: {
      species: never.length,
      offspring: never.reduce((s, r) => s + r.offspring, 0),
    },
    spreadMinAdmitted: SPECIES_SPREAD_MIN_ADMITTED,
    survivalRateGivenAdmitted: spread(survivalRates),
    contributionRateGivenAdmitted: spread(rates),
    largest: rows.slice(0, SPECIES_DIGEST_TOP),
  };
}

/** CSV of every pooled species with at least one admitted offspring. */
export function speciesCsv(
  summary: Record<string, ReturnType<typeof pooled>>,
): string {
  const columns = [
    "species",
    "seeds",
    "offspring",
    "admitted",
    "survived",
    "survivedAdmitted",
    "contributors",
    "contributorsAdmitted",
  ] as const;
  const lines = [["arm", "horizon", ...columns].join(",")];
  for (const [arm, p] of Object.entries(summary)) {
    for (const h of p.horizons) {
      for (const row of h.bySpecies) {
        if (row.admitted === 0) continue;
        lines.push([arm, h.horizon, ...columns.map((c) => row[c])].join(","));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

type RunFailure = { seed: number; arm: AdmissionArm; message: string };
type SeedOutcome = {
  seed: number;
  runs: AdmissionArmResult[];
  failures: RunFailure[];
};

function printRun(seed: number, result: AdmissionArmResult): void {
  const last = result.persistence.horizons.at(-1);
  console.log(
    `  seed ${seed}  ${result.arm.padEnd(8)} holdout ${
      result.finalHoldoutMse.toFixed(6)
    }  admission ${
      ((result.persistence.admissionRate ?? 0) * 100).toFixed(1)
    }%  contribution@${last?.horizon} ${
      last?.contributionRateGivenAdmitted === null || last === undefined
        ? "n/a"
        : last.contributionRateGivenAdmitted.toFixed(3)
    }  failures ${result.failures}`,
  );
}

/** Worker mode: run both arms for one seed and write the outcome to `outPath`. */
async function runSingleSeed(
  seed: number,
  settings: AdmissionSettings,
  outPath: string,
): Promise<void> {
  const seeded = { ...settings, seed };
  const corpus = buildStratifiedCorpus(seeded);
  const outcome: SeedOutcome = { seed, runs: [], failures: [] };
  for (const arm of ADMISSION_ARMS) {
    try {
      outcome.runs.push(runArm(arm, seeded, corpus));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome.failures.push({ seed, arm, message });
    }
  }
  await Deno.writeTextFile(outPath, JSON.stringify(outcome));
}

/** Run one seed in its own process so its heap is released afterwards. */
async function runSeedInChild(
  seed: number,
  settings: AdmissionSettings,
  tempDir: string,
): Promise<SeedOutcome> {
  const outPath = `${tempDir}/seed-${seed}.json`;
  const scriptPath = import.meta.filename ??
    new URL(import.meta.url).pathname;
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      scriptPath,
      `--single-seed=${seed}`,
      `--out=${outPath}`,
      `--generations=${settings.generations}`,
      `--population=${settings.populationSize}`,
      `--offspring=${settings.offspringPerGeneration}`,
      `--records=${settings.recordsPerSplit}`,
    ],
    stdout: "inherit",
    stderr: "piped",
  });
  const output = await command.output();
  const stderr = new TextDecoder().decode(output.stderr);
  let problem: string | undefined;
  if (output.code !== 0) {
    problem = `exit code ${output.code}`;
  } else {
    try {
      const parsed = JSON.parse(await Deno.readTextFile(outPath));
      if (Array.isArray(parsed?.runs) && Array.isArray(parsed?.failures)) {
        return parsed as SeedOutcome;
      }
      problem = "output file had an unexpected shape";
    } catch (error) {
      problem = `output file missing or unparseable (${
        error instanceof Error ? error.message : String(error)
      })`;
    }
  }
  const lines = stderr.split("\n").map((l) => l.trim()).filter((l) =>
    l.length > 0
  );
  const cause = lines.findLast((l) => /out of memory|Fatal|error/i.test(l)) ??
    lines.at(-1) ?? "no stderr output";
  const message = `seed child failed: ${problem}; stderr: ${cause}`;
  return {
    seed,
    runs: [],
    failures: ADMISSION_ARMS.map((arm) => ({ seed, arm, message })),
  };
}

/** Run the study; `args` are the CLI arguments. */
export async function main(args: string[]): Promise<number> {
  const seeds = intArg(args, "seeds", PREDECLARED_SEEDS);
  const firstSeed = intArg(args, "first-seed", PREDECLARED_FIRST_SEED);
  const settings: AdmissionSettings = {
    ...DEFAULT_ADMISSION_SETTINGS,
    seed: firstSeed,
    generations: intArg(
      args,
      "generations",
      DEFAULT_ADMISSION_SETTINGS.generations,
    ),
    populationSize: intArg(
      args,
      "population",
      DEFAULT_ADMISSION_SETTINGS.populationSize,
    ),
    offspringPerGeneration: intArg(
      args,
      "offspring",
      DEFAULT_ADMISSION_SETTINGS.offspringPerGeneration,
    ),
    recordsPerSplit: intArg(
      args,
      "records",
      DEFAULT_ADMISSION_SETTINGS.recordsPerSplit,
    ),
  };
  const singleSeed = stringArg(args, "single-seed");
  const outPath = stringArg(args, "out");
  if (singleSeed !== undefined) {
    if (outPath === undefined) throw new Error("--single-seed needs --out");
    await runSingleSeed(
      intArg([`--single-seed=${singleSeed}`], "single-seed", 1),
      settings,
      outPath,
    );
    return 0;
  }
  const jsonPath = stringArg(args, "json");
  const speciesCsvPath = stringArg(args, "species-csv");
  // Read provenance before any seed runs, so the manifest names the code that
  // actually ran.
  const codeVersion = stringArg(args, "code-version") ?? await gitCommit();
  const dirty = await dirtyTree();
  const seedList = Array.from({ length: seeds }, (_, i) => firstSeed + i);
  const runs: AdmissionArmResult[] = [];
  const failuresRun: { seed: number; arm: AdmissionArm; message: string }[] =
    [];

  console.log(
    `Admission persistence study — synthetic objective, seeds ${seedList[0]}..${
      seedList[seedList.length - 1]
    }, ${settings.generations} generations, population ${settings.populationSize}, ` +
      `${settings.offspringPerGeneration} offspring, ${settings.recordsPerSplit} records per split`,
  );

  const tempDir = await Deno.makeTempDir({ prefix: "admission-study-" });
  try {
    for (const seed of seedList) {
      // deno-lint-ignore no-await-in-loop -- sequential on purpose: one child at a time
      const outcome = await runSeedInChild(seed, settings, tempDir);
      runs.push(...outcome.runs);
      failuresRun.push(...outcome.failures);
      for (const result of outcome.runs) printRun(seed, result);
      for (const f of outcome.failures) {
        console.log(
          `  seed ${seed}  ${f.arm.padEnd(8)} FAILED: ${f.message}`,
        );
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }

  const byArm = (arm: AdmissionArm) => runs.filter((r) => r.arm === arm);
  const common = new Set(
    byArm("uniform").map((r) => r.seed).filter((s) =>
      byArm("biased").some((r) => r.seed === s)
    ),
  );
  const uniform = byArm("uniform").filter((r) => common.has(r.seed));
  const biased = byArm("biased").filter((r) => common.has(r.seed));

  const compare = (
    pick: (r: AdmissionArmResult) => number,
  ) => {
    const view = (r: AdmissionArmResult) => ({
      seed: r.seed,
      finalHoldoutMse: pick(r),
      toTarget: r.toTarget,
      meanBehaviouralDiversity: r.meanBehaviouralDiversity,
    });
    const comparison = pairedComparison(
      uniform.map(view),
      biased.map(view),
      2000,
      4163,
    );
    // This harness declares no target threshold, so `toTarget` is a
    // placeholder and the shared comparison's reached counts would read as
    // zero. Say it was not measured rather than report those zeros.
    const { recordsToTarget: _placeholder, ...measured } = comparison;
    return {
      ...measured,
      recordsToTarget: "not-measured" as const,
      verdict: verdict(comparison),
    };
  };
  const comparisons = {
    bestHoldout: compare((r) => r.finalHoldoutMse),
    populationHoldout: compare((r) => r.populationHoldoutMse),
  };

  console.log("\nPaired held-out MSE, biased vs uniform (negative = better):");
  for (const [name, c] of Object.entries(comparisons)) {
    console.log(
      `  ${name.padEnd(17)} n ${c.n}  mean ${
        c.meanDiff.toExponential(3)
      }  CI95 [${c.ci95[0].toExponential(3)}, ${
        c.ci95[1].toExponential(3)
      }]  wins ${c.wins}/${c.n}  => ${c.verdict}`,
    );
  }
  const summary = Object.fromEntries(
    ADMISSION_ARMS.map((arm) => [arm, pooled(byArm(arm))]),
  );
  for (const arm of ADMISSION_ARMS) {
    const p = summary[arm];
    console.log(
      `  ${arm.padEnd(8)} admission ${p.admissionRate?.toFixed(3) ?? "n/a"}  ` +
        p.horizons.map((h) =>
          `@${h.horizon}: survival|admitted ${
            h.survivalRateGivenAdmitted?.toFixed(3) ?? "n/a"
          } contribution|admitted ${
            h.contributionRateGivenAdmitted?.toFixed(3) ?? "n/a"
          }`
        ).join("  "),
    );
  }
  console.log("\nPersistence per Genus species at birth (largest 5 per arm):");
  for (const arm of ADMISSION_ARMS) {
    for (const h of summary[arm].horizons) {
      if (h.horizon < 100) continue;
      for (const sp of h.bySpecies.slice(0, 5)) {
        console.log(
          `  ${arm.padEnd(8)} @${h.horizon} species ${
            sp.species.slice(0, 8)
          }  offspring ${sp.offspring}  admitted ${sp.admitted}  ` +
            `survival|admitted ${
              sp.survivalRateGivenAdmitted?.toFixed(3) ?? "n/a"
            }  contribution|admitted ${
              sp.contributionRateGivenAdmitted?.toFixed(3) ?? "n/a"
            }  (${sp.seeds} seeds)`,
        );
      }
      console.log(
        `  ${arm.padEnd(8)} @${h.horizon} ${h.bySpecies.length} species in all`,
      );
    }
  }
  if (failuresRun.length > 0) {
    console.log(`\n${failuresRun.length} run(s) failed and were not paired.`);
  }

  if (jsonPath !== undefined) {
    const denoJson = JSON.parse(await Deno.readTextFile("./deno.json"));
    const neatCoreRev = denoJson.neatCore?.rev;
    if (
      typeof denoJson.version !== "string" || typeof neatCoreRev !== "string"
    ) {
      throw new Error("deno.json is missing version or neatCore.rev");
    }
    const report = {
      issue: 4163,
      manifest: {
        command: Deno.args.join(" "),
        codeVersion,
        dirty,
        neatAiVersion: denoJson.version,
        neatCoreRev,
        denoVersion: Deno.version,
        corpus: "synthetic-quadrant-v1",
        seeds: seedList,
        settings,
        arms: ADMISSION_ARMS,
        criteria: SUCCESS_CRITERIA,
        definitions: {
          initialAcceptance:
            "an offspring is admitted when it is among the N survivors of the " +
            "birth selection (train MSE, ties to the older individual)",
          individualSurvival:
            "the individual itself is in the population exactly h generations " +
            "after its birth",
          descendantContribution:
            "at least one member of the population h generations after its " +
            "birth is the individual or descends from it",
          censoring:
            "an individual born after G - h has no h-generation reading; it is " +
            "excluded from that horizon's rates and counted as censored",
          turnover: "admitted offspring in a generation / N",
          lineageDepth: "0 for a seed, parent depth + 1 for an offspring",
          team: "both groupings are reported: the Genus species key " +
            "(Species.calculateKey) of the offspring at birth, and its " +
            "founder clade (the generation-0 seed it descends from)",
        },
        holdoutPolicy:
          "reporting only, read once at the final generation; never read by " +
          "selection, mutation or parent weighting",
        costPolicy:
          "recordsScored charges train + calibration records for every " +
          "evaluation, seeds included; holdout records are reported separately " +
          "and never charged; the behavioural-diversity probe activations are " +
          "counted as diagnosticRecords and also never charged",
        calibrationPolicy:
          "the biased arm weights parents by rank of calibration MSE only, " +
          "with best-to-worst odds capped at oddsCap",
        causalityCaveat:
          "lineage/admission associations are predictive correlations, not " +
          "causal value",
      },
      summary: Object.fromEntries(
        Object.entries(summary).map(([arm, p]) => [arm, {
          ...p,
          horizons: p.horizons.map(({ bySpecies, ...h }) => ({
            ...h,
            bySpecies: speciesDigest(bySpecies),
          })),
        }]),
      ),
      speciesCsv: speciesCsvPath ?? null,
      comparisons,
      coverage: {
        seedsRequested: seeds,
        completed: {
          uniform: byArm("uniform").length,
          biased: byArm("biased").length,
        },
        paired: common.size,
      },
      failuresRun,
      // Per-run species rows are pooled into `summary` and the CSV; repeating
      // them per run would multiply the artefact's size by the run count.
      runs: runs.map((r) => ({
        ...r,
        persistence: {
          ...r.persistence,
          horizons: r.persistence.horizons.map(({ bySpecies, ...h }) => ({
            ...h,
            species: bySpecies.length,
          })),
        },
      })),
    };
    await Deno.writeTextFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nWrote ${jsonPath}`);
  }
  if (speciesCsvPath !== undefined) {
    await Deno.writeTextFile(speciesCsvPath, speciesCsv(summary));
    console.log(`Wrote ${speciesCsvPath}`);
  }

  if (runs.length === 0) {
    console.error("Every run failed.");
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main([...Deno.args]));
}
