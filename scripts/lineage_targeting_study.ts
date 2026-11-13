/**
 * Issue #4155 — lineage-informed targeted offspring versus ordinary mutation.
 *
 * Runs the four arms (ordinary, history, targeted, history-targeted) over a
 * range of seeds, one corpus per seed shared by every arm, and reports paired
 * comparisons against the ordinary control with a verdict against criteria
 * fixed in advance.
 *
 * ```bash
 * deno task lineage-targeting-study --seeds=10 --json=/tmp/lts.json
 * ```
 *
 * The objective is synthetic (see `scripts/lib/lineageTargetingStudy.ts`). A
 * measurement harness, not a production code path.
 */

import {
  armFactors,
  type ArmName,
  type ArmResult,
  ARMS,
  buildStratifiedCorpus,
  DEFAULT_STUDY_SETTINGS,
  type LineageEdge,
  pairedComparison,
  runArm,
  type StudySettings,
  SUCCESS_CRITERIA,
  verdict,
} from "./lib/lineageTargetingStudy.ts";
import { intArg, numberArg, stringArg } from "./lib/cliArgs.ts";

function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Count and mean overall delta per operator, instead of every edge. */
function edgeSummary(edges: readonly LineageEdge[]) {
  const byOperator = new Map<string, number[]>();
  for (const edge of edges) {
    const list = byOperator.get(edge.operator) ?? [];
    list.push(edge.overallDelta);
    byOperator.set(edge.operator, list);
  }
  return {
    count: edges.length,
    operators: Object.fromEntries(
      [...byOperator].map(([operator, deltas]) => {
        const finite = deltas.filter((d) => Number.isFinite(d));
        return [operator, {
          count: deltas.length,
          meanOverallDelta: mean(finite),
        }];
      }),
    ),
  };
}

if (import.meta.main) {
  const args = [...Deno.args];
  const seeds = intArg(args, "seeds", 10);
  const baseSeed = numberArg(args, "base-seed", DEFAULT_STUDY_SETTINGS.seed);
  const settings: StudySettings = {
    ...DEFAULT_STUDY_SETTINGS,
    seed: baseSeed,
    evaluationBudget: intArg(
      args,
      "budget",
      DEFAULT_STUDY_SETTINGS.evaluationBudget,
    ),
    recordsPerSplit: intArg(
      args,
      "records",
      DEFAULT_STUDY_SETTINGS.recordsPerSplit,
    ),
    populationSize: intArg(
      args,
      "population",
      DEFAULT_STUDY_SETTINGS.populationSize,
    ),
  };
  const codeVersion = stringArg(args, "code-version") ?? "unknown";
  const jsonPath = stringArg(args, "json");

  const seedList = Array.from({ length: seeds }, (_, i) => baseSeed + i);
  const runs: ArmResult[] = [];
  const failuresRun: { arm: ArmName; seed: number; error: string }[] = [];

  console.info(
    `Lineage targeting study — synthetic objective, seeds ${seedList[0]}..${
      seedList[seedList.length - 1]
    }, budget ${settings.evaluationBudget}, ${settings.recordsPerSplit} ` +
      `records per split, population ${settings.populationSize}`,
  );

  for (const seed of seedList) {
    const seeded: StudySettings = { ...settings, seed };
    const corpus = buildStratifiedCorpus(seeded);
    for (const arm of ARMS) {
      try {
        const result = runArm(arm, seeded, corpus);
        runs.push(result);
        console.info(
          `  seed ${seed}  ${arm.padEnd(17)} holdout ${
            result.finalHoldoutMse.toFixed(6)
          }  train ${
            result.finalTrainMse.toFixed(6)
          }  failures ${result.failures}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failuresRun.push({ arm, seed, error: message });
        console.info(`  seed ${seed}  ${arm.padEnd(17)} FAILED: ${message}`);
      }
    }
  }

  const byArm = (arm: ArmName) => runs.filter((r) => r.arm === arm);
  /** Runs of two arms restricted to the seeds both completed. */
  const paired = (control: ArmName, arm: ArmName) => {
    const common = new Set(
      byArm(control).map((r) => r.seed).filter((s) =>
        byArm(arm).some((r) => r.seed === s)
      ),
    );
    return [
      byArm(control).filter((r) => common.has(r.seed)),
      byArm(arm).filter((r) => common.has(r.seed)),
    ] as const;
  };

  const summary = ARMS.map((arm) => {
    const rows = byArm(arm);
    const holdouts = rows.map((r) => r.finalHoldoutMse);
    return {
      arm,
      meanFinalHoldoutMse: mean(holdouts),
      medianFinalHoldoutMse: median(holdouts),
      meanBehaviouralDiversity: mean(
        rows.map((r) => r.meanBehaviouralDiversity),
      ),
      failures: rows.reduce((s, r) => s + r.failures, 0),
      repeatedFailures: rows.reduce((s, r) => s + r.repeatedFailures, 0),
      seedsReachingTarget: rows.filter((r) => r.toTarget !== null).length,
      coverage: { seedsRun: seeds, seedsCompleted: rows.length },
    };
  });

  const contrasts: { arm: ArmName; versus: ArmName }[] = [
    { arm: "history", versus: "ordinary" },
    { arm: "targeted", versus: "ordinary" },
    { arm: "history-targeted", versus: "ordinary" },
    { arm: "history-targeted", versus: "targeted" },
  ];
  const comparisons = contrasts.map(({ arm, versus }) => {
    const [control, treated] = paired(versus, arm);
    const comparison = pairedComparison(control, treated);
    return { arm, versus, ...comparison, verdict: verdict(comparison) };
  });

  console.info("\nPaired final held-out MSE (negative = better than versus):");
  for (const c of comparisons) {
    console.info(
      `  ${c.arm.padEnd(17)} vs ${c.versus.padEnd(9)} n ${c.n}  mean ${
        c.meanDiff.toExponential(3)
      }  CI95 [${c.ci95[0].toExponential(3)}, ${
        c.ci95[1].toExponential(3)
      }]  wins ${c.wins}/${c.n}  diversity x${
        c.diversityRatio.toFixed(3)
      }  => ${c.verdict}`,
    );
  }

  if (jsonPath !== undefined) {
    const denoJson = JSON.parse(await Deno.readTextFile("./deno.json"));
    const report = {
      issue: 4155,
      manifest: {
        command: Deno.args.join(" "),
        codeVersion,
        neatAiVersion: denoJson.version,
        neatCoreRev: denoJson.neatCore?.rev,
        denoVersion: Deno.version,
        corpus: "synthetic-quadrant-v1",
        seeds: seedList,
        settings,
        arms: ARMS.map((arm) => ({ arm, factors: armFactors(arm) })),
        criteria: SUCCESS_CRITERIA,
        holdoutPolicy:
          "reporting only; never read by selection, mutation or targeting",
        costPolicy:
          "recordsScored charges train + calibration records for every exact " +
          "evaluation plus every calibration record scored while screening " +
          "targeted candidates; holdout records are reported separately and " +
          "never charged; the behavioural-diversity probe activations are " +
          "counted as diagnosticRecords and also never charged; wallMs is " +
          "indicative only",
        diversityPolicy:
          "behavioural diversity: mean pairwise RMS difference of the first " +
          "output over the first 64 calibration records, averaged over every " +
          "generation; the ratio is the median over seeds of arm / control; " +
          "measurement only, never read by selection, mutation or targeting; " +
          "genetic distance and species count are reported but not used",
      },
      summary,
      comparisons,
      failuresRun,
      runs: runs.map(({ edges, generations, ...rest }) => ({
        ...rest,
        edges: edgeSummary(edges),
        generations: generations.filter((g, i) =>
          i === 0 || i === generations.length - 1 || g.generation % 5 === 0
        ),
      })),
    };
    await Deno.writeTextFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    console.info(`\nWrote ${jsonPath}`);
  }

  if (runs.length === 0) {
    console.error("Every run failed.");
    Deno.exit(1);
  }
}
