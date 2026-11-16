/**
 * Issue #4163 — offspring admission versus durable lineage contribution.
 *
 * Runs uniform and calibrated-biased (capped 2:1 odds) parent selection over a
 * range of seeds, one corpus per seed shared by both arms, and reports initial
 * admission, persistence at 10/100/1000 generations and the paired held-out
 * comparison with a verdict against criteria fixed in advance.
 *
 * ```bash
 * deno task admission-persistence-study --seeds=20 --json=/tmp/aps.json
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
      };
    }),
  };
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
    await runSingleSeed(Number(singleSeed), settings, outPath);
    return 0;
  }
  const jsonPath = stringArg(args, "json");
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
    return { ...comparison, verdict: verdict(comparison) };
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
          `@${h.horizon}: surv|adm ${
            h.survivalRateGivenAdmitted?.toFixed(3) ?? "n/a"
          } contrib|adm ${h.contributionRateGivenAdmitted?.toFixed(3) ?? "n/a"}`
        ).join("  "),
    );
  }
  if (failuresRun.length > 0) {
    console.log(`\n${failuresRun.length} run(s) failed and were not paired.`);
  }

  if (jsonPath !== undefined) {
    const denoJson = JSON.parse(await Deno.readTextFile("./deno.json"));
    const codeVersion = stringArg(args, "code-version") ?? await gitCommit();
    const dirty = await dirtyTree();
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
          team: "founder clade (Genus species reported as a count only)",
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
      summary,
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
      runs,
    };
    await Deno.writeTextFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nWrote ${jsonPath}`);
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
