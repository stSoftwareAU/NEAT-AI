/**
 * Issue #3934 Stage 1 — does the memetic local-search budget go to the
 * creatures that benefit?
 *
 * Runs the two arms of {@link module:scripts/lib/memeticGainStudy} over one or
 * more seeds — today's top-`trainPerGen` rule and the uniform-random baseline —
 * and reports the three numbers the issue asks for: the rank-versus-gain
 * correlation, the realised gain per second of training under each rule, and the
 * final exact score each rule reached.
 *
 * The gradient steps are real. The corpus and the creatures are small, so the
 * answer this produces is about the **ordering** rank implies, not about the
 * magnitude a GRQ-scale creature would see.
 *
 * Run with:
 *   NEAT_AI_BACKPROP_ENABLED=0 deno task memetic-gain-study \
 *     --seeds=5 --json=docs/evidence/memetic-gain-3934.json
 *
 * @module memetic_gain_study
 */

import { intArg, stringArg } from "./lib/cliArgs.ts";
import {
  type ArmResult,
  DEFAULT_STUDY_SETTINGS,
  runMemeticArm,
  SELECTION_POLICIES,
  type SelectionPolicy,
  type StudyEvent,
  type StudySettings,
} from "./lib/memeticGainStudy.ts";
import {
  correlateRankAgainstGain,
  type GainObservation,
  MIN_STAGE1_EVENTS,
  type PolicySummary,
  type RankGainCorrelation,
  type Stage2Verdict,
  stage2Verdict,
  summarisePolicy,
} from "./lib/memeticGainAnalysis.ts";

/**
 * How much of the offered local-search budget a rule actually spent.
 *
 * Issue #3553 trains a creature at most once per run and loses the slot rather
 * than reallocating it, so "how many gradient steps did this rule buy?" is a
 * different question from "how many was it given?". A rule that keeps choosing
 * the same converged creatures answers the second question with far more than
 * the first.
 */
interface BudgetUse {
  /** Slots the rule was offered: generations × `trainPerGen` × seeds. */
  readonly offered: number;
  /** Slots that became a real gradient step. */
  readonly used: number;
  /** Slots the once-per-run guard refused. */
  readonly refusedAlreadyTrained: number;
  /** `used / offered`. */
  readonly usedFraction: number;
}

/** One repeat's headline numbers, for the stability check. */
interface RepeatSummary {
  readonly repeat: number;
  readonly baseSeed: number;
  readonly seeds: number;
  readonly events: number;
  readonly spearmanRandom: number;
  readonly pValue: number;
  readonly decision: string;
  readonly topMedianGain: number;
  readonly randomMedianGain: number;
  readonly topWins: number;
}

/** The whole Stage 1 reading, as written to the JSON artefact. */
interface StudyReport {
  readonly issue: 3934;
  readonly settings: StudySettings;
  readonly seeds: readonly number[];
  readonly events: number;
  readonly byPolicy: Record<SelectionPolicy, PolicySummary>;
  /** What each rule did with the budget it was offered. */
  readonly budgetUse: Record<SelectionPolicy, BudgetUse>;
  readonly finalScores: Record<SelectionPolicy, readonly number[]>;
  /** Correlation over the randomly-selected events: the unbiased estimator. */
  readonly rankVsGainRandom: RankGainCorrelation;
  /** Correlation over every event, rank-biased by the top rule's own choices. */
  readonly rankVsGainPooled: RankGainCorrelation;
  /** Gain per second under each rule, and the ratio between them. */
  readonly topVersusRandom: {
    readonly topGainPerSecond: number;
    readonly randomGainPerSecond: number;
    readonly ratio: number;
  };
  /**
   * The paired endpoint comparison: the two arms ran the same seed, so the
   * honest reading is per-seed wins and the paired delta, not a mean of means
   * that a single unlucky seed can carry.
   */
  readonly finalScorePaired: {
    readonly seeds: number;
    readonly topWins: number;
    readonly randomWins: number;
    readonly ties: number;
    readonly meanDelta: number;
    readonly medianDelta: number;
  };
  readonly verdict: Stage2Verdict;
  readonly gainByRankBucket: readonly {
    readonly bucket: string;
    readonly scored: number;
    readonly medianGain: number;
    readonly improvedFraction: number;
  }[];
  /**
   * One row per independent repeat of the whole study.
   *
   * A memetic run is chaotic and the mutation operators mint unseeded neuron
   * UUIDs for the neurons they add, so two same-seed runs agree on generation 1
   * and diverge after it — these numbers are reproducible in distribution, not
   * bit for bit. Publishing every repeat is what makes that claim checkable
   * rather than asserted.
   */
  readonly repeats: readonly RepeatSummary[];
}

/**
 * Median gain and improved share per rank quartile of the ranked population.
 *
 * The correlation is one number; this is the shape behind it, and it is where a
 * non-monotone relationship — a middle of the population that gains most —
 * would show up as something ρ alone reports as "no signal". The median and the
 * improved share, not the mean: one explosive recovery in a bucket of 250
 * events would otherwise be the whole row.
 *
 * **Randomly-selected events only.** Pooling both arms puts every one of the top
 * rule's events in the first quartile and none in the others, so the first row
 * would be ~80 % one arm and the rest purely the other: any difference between
 * the rows would then be partly a difference between the arms. The uniform draw
 * is the only sample whose quartiles are comparable with each other.
 *
 * @param events - The randomly-selected events.
 * @returns One row per quartile that saw at least one event.
 */
function bucketGainByRank(
  events: readonly StudyEvent[],
): StudyReport["gainByRankBucket"] {
  const buckets = new Map<string, GainObservation[]>();
  for (const event of events) {
    if (event.rankedPopulation <= 0) continue;
    const quartile = Math.min(
      3,
      Math.floor((event.rank / event.rankedPopulation) * 4),
    );
    const label = `${quartile * 25}–${(quartile + 1) * 25}%`;
    const bucket = buckets.get(label) ?? [];
    bucket.push(event);
    buckets.set(label, bucket);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, observations]) => {
      const summary = summarisePolicy(observations);
      return {
        bucket,
        scored: summary.scored,
        medianGain: summary.medianGain,
        improvedFraction: summary.improvedFraction,
      };
    });
}

/**
 * Compare the arms seed by seed.
 *
 * `delta` is `top - random` on the final exact score, so a positive delta is a
 * win for today's rule. Paired, because the two arms ran the same seed: a mean
 * of means lets one unlucky seed carry the verdict.
 *
 * @param top - Final scores of the `top` arm, in seed order.
 * @param random - Final scores of the `random` arm, in the same order.
 * @returns The paired reading.
 * @throws {Error} When the two arms did not run the same seeds.
 */
function pairEndpoints(
  top: readonly number[],
  random: readonly number[],
): StudyReport["finalScorePaired"] {
  if (top.length !== random.length) {
    throw new Error(
      `paired comparison needs one final score per arm per seed, got ` +
        `${top.length} and ${random.length}`,
    );
  }
  const deltas = top.map((score, i) => score - random[i]);
  const sorted = [...deltas].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    seeds: deltas.length,
    topWins: deltas.filter((delta) => delta > 0).length,
    randomWins: deltas.filter((delta) => delta < 0).length,
    ties: deltas.filter((delta) => delta === 0).length,
    meanDelta: mean(deltas),
    medianDelta: sorted.length === 0
      ? Number.NaN
      : sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2,
  };
}

/** Mean of a sample, or `NaN` when it is empty. */
function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Reduce a set of completed arms to one reading.
 *
 * @param arms - The arms, two per seed.
 * @param settings - The settings they ran under.
 * @param seeds - The seeds they ran.
 * @returns The reading, with no repeat rows attached.
 */
function reduceArms(
  arms: readonly ArmResult[],
  settings: StudySettings,
  seeds: readonly number[],
): Omit<StudyReport, "repeats"> {
  const eventsByPolicy = new Map<SelectionPolicy, StudyEvent[]>();
  const finalScores: Record<string, number[]> = {};
  const refusedByPolicy = new Map<SelectionPolicy, number>();
  const armsByPolicy = new Map<SelectionPolicy, number>();
  for (const arm of arms) {
    const bucket = eventsByPolicy.get(arm.policy) ?? [];
    bucket.push(...arm.events);
    eventsByPolicy.set(arm.policy, bucket);
    (finalScores[arm.policy] ??= []).push(arm.finalScore);
    refusedByPolicy.set(
      arm.policy,
      (refusedByPolicy.get(arm.policy) ?? 0) + arm.skippedAlreadyTrained,
    );
    armsByPolicy.set(arm.policy, (armsByPolicy.get(arm.policy) ?? 0) + 1);
  }

  const budgetUse = (policy: SelectionPolicy, used: number): BudgetUse => {
    const offered = (armsByPolicy.get(policy) ?? 0) * settings.generations *
      settings.trainPerGen;
    return {
      offered,
      used,
      refusedAlreadyTrained: refusedByPolicy.get(policy) ?? 0,
      usedFraction: offered === 0 ? 0 : used / offered,
    };
  };

  const topEvents = eventsByPolicy.get("top") ?? [];
  const randomEvents = eventsByPolicy.get("random") ?? [];
  const allEvents = [...topEvents, ...randomEvents];
  const topSummary = summarisePolicy(topEvents);
  const randomSummary = summarisePolicy(randomEvents);
  const rankVsGainRandom = correlateRankAgainstGain(
    randomEvents,
    settings.seed,
  );

  return {
    issue: 3934,
    settings,
    seeds,
    events: allEvents.length,
    byPolicy: { top: topSummary, random: randomSummary },
    budgetUse: {
      top: budgetUse("top", topEvents.length),
      random: budgetUse("random", randomEvents.length),
    },
    finalScores: {
      top: finalScores.top ?? [],
      random: finalScores.random ?? [],
    },
    rankVsGainRandom,
    rankVsGainPooled: correlateRankAgainstGain(allEvents, settings.seed),
    topVersusRandom: {
      topGainPerSecond: topSummary.gainPerSecond,
      randomGainPerSecond: randomSummary.gainPerSecond,
      ratio: randomSummary.gainPerSecond === 0
        ? Number.NaN
        : topSummary.gainPerSecond / randomSummary.gainPerSecond,
    },
    verdict: stage2Verdict(rankVsGainRandom, randomEvents.length),
    finalScorePaired: pairEndpoints(
      finalScores.top ?? [],
      finalScores.random ?? [],
    ),
    gainByRankBucket: bucketGainByRank(randomEvents),
  };
}

/**
 * Run both arms over every seed of every repeat, then reduce to one report.
 *
 * @param settings - Base settings; the seed is replaced per run.
 * @param repeats - Seeds to run, grouped by repeat.
 * @returns The pooled report, with each repeat's headline numbers attached.
 */
function runStudy(
  settings: StudySettings,
  repeats: readonly (readonly number[])[],
): StudyReport {
  const allArms: ArmResult[] = [];
  const repeatRows: RepeatSummary[] = [];

  repeats.forEach((seeds, index) => {
    const baseSeed = seeds[0];
    console.log(
      `repeat ${index + 1} of ${repeats.length}, base seed ${baseSeed}:`,
    );
    const arms: ArmResult[] = [];
    for (const seed of seeds) {
      for (const policy of SELECTION_POLICIES) {
        const started = performance.now();
        const arm = runMemeticArm(policy, { ...settings, seed });
        arms.push(arm);
        console.log(
          `  seed ${seed} / ${policy}: ${arm.events.length} events, ` +
            `final score ${arm.finalScore.toExponential(4)} ` +
            `(${((performance.now() - started) / 1000).toFixed(1)} s)`,
        );
      }
    }
    allArms.push(...arms);
    const reading = reduceArms(arms, { ...settings, seed: baseSeed }, seeds);
    repeatRows.push({
      repeat: index + 1,
      baseSeed,
      seeds: reading.finalScorePaired.seeds,
      events: reading.events,
      spearmanRandom: reading.rankVsGainRandom.spearman,
      pValue: reading.rankVsGainRandom.pValue,
      decision: reading.verdict.decision,
      topMedianGain: reading.byPolicy.top.medianGain,
      randomMedianGain: reading.byPolicy.random.medianGain,
      topWins: reading.finalScorePaired.topWins,
    });
  });

  return {
    ...reduceArms(allArms, settings, repeats.flat()),
    repeats: repeatRows,
  };
}

/** Print the report in the shape the evidence document quotes. */
function printReport(report: StudyReport): void {
  console.log(`\n=== Issue #3934 Stage 1 ===\n`);
  console.log(
    `Events: ${report.events} (top ${report.byPolicy.top.events}, random ` +
      `${report.byPolicy.random.events}); minimum required ` +
      `${MIN_STAGE1_EVENTS} per arm\n`,
  );
  console.log(
    "| policy | events | median gain | trimmed mean | mean gain | max gain | improved | training s | gain/s | trimmed gain/s |",
  );
  console.log(
    "| ------ | -----: | ----------: | -----------: | --------: | -------: | -------: | ---------: | -----: | -------------: |",
  );
  for (const policy of SELECTION_POLICIES) {
    const summary = report.byPolicy[policy];
    console.log(
      `| ${policy} | ${summary.events} | ` +
        `${summary.medianGain.toExponential(3)} | ` +
        `${summary.trimmedMeanGain.toExponential(3)} | ` +
        `${summary.meanGain.toExponential(3)} | ` +
        `${summary.maxGain.toExponential(3)} | ` +
        `${(summary.improvedFraction * 100).toFixed(1)}% | ` +
        `${summary.trainingSeconds.toFixed(1)} | ` +
        `${summary.gainPerSecond.toExponential(3)} | ` +
        `${summary.trimmedGainPerSecond.toExponential(3)} |`,
    );
  }
  console.log(
    "\nBudget actually spent (Issue #3553 trains a creature at most once per run):",
  );
  console.log("| policy | slots offered | steps taken | refused | spent |");
  console.log("| ------ | ------------: | ----------: | ------: | ----: |");
  for (const policy of SELECTION_POLICIES) {
    const use = report.budgetUse[policy];
    console.log(
      `| ${policy} | ${use.offered} | ${use.used} | ` +
        `${use.refusedAlreadyTrained} | ` +
        `${(use.usedFraction * 100).toFixed(1)}% |`,
    );
  }
  console.log(
    `\nFinal exact score — top: ${
      mean(report.finalScores.top).toExponential(4)
    }, random: ${mean(report.finalScores.random).toExponential(4)} ` +
      `(mean over ${report.seeds.length} seed(s); higher is better)`,
  );
  const paired = report.finalScorePaired;
  console.log(
    `Paired endpoint (top − random at the same seed): top wins ` +
      `${paired.topWins}/${paired.seeds}, random wins ${paired.randomWins}, ` +
      `mean delta ${paired.meanDelta.toExponential(3)}, median delta ` +
      `${paired.medianDelta.toExponential(3)}\n`,
  );
  const unbiased = report.rankVsGainRandom;
  console.log(
    `Rank vs gain, randomly-selected events (unbiased): ρ = ` +
      `${unbiased.spearman.toFixed(3)}, τ-b = ` +
      `${unbiased.kendallTauB.toFixed(3)}, p = ` +
      `${unbiased.pValue.toFixed(4)}, n = ${unbiased.scored}, distinct ranks ` +
      `${unbiased.distinctRanks}`,
  );
  const pooled = report.rankVsGainPooled;
  console.log(
    `Rank vs gain, all events (rank-biased by the top rule): ρ = ` +
      `${pooled.spearman.toFixed(3)}, τ-b = ` +
      `${pooled.kendallTauB.toFixed(3)}, p = ${pooled.pValue.toFixed(4)}, ` +
      `n = ${pooled.scored}\n`,
  );
  console.log(
    "\nRank buckets over the randomly-selected events only (comparable rows):",
  );
  console.log("| rank bucket | events | median gain | improved |");
  console.log("| ----------- | -----: | ----------: | -------: |");
  for (const row of report.gainByRankBucket) {
    console.log(
      `| ${row.bucket} | ${row.scored} | ${
        row.medianGain.toExponential(3)
      } | ` +
        `${(row.improvedFraction * 100).toFixed(1)}% |`,
    );
  }
  if (report.repeats.length > 1) {
    console.log(
      "\n| repeat | base seed | events | ρ (random arm) | p | top wins | decision |",
    );
    console.log(
      "| -----: | --------: | -----: | -------------: | -: | -------: | -------- |",
    );
    for (const row of report.repeats) {
      console.log(
        `| ${row.repeat} | ${row.baseSeed} | ${row.events} | ` +
          `${row.spearmanRandom.toFixed(3)} | ${row.pValue.toFixed(4)} | ` +
          `${row.topWins}/${row.seeds} | ${row.decision} |`,
      );
    }
  }
  console.log(
    `\nStage 2: ${report.verdict.decision.toUpperCase()} — ` +
      `${report.verdict.reason}\n`,
  );
}

/**
 * Parse the flags, run the study, print the report and write the artefact.
 *
 * Behind `import.meta.main`, as every sibling study entry point is: importing
 * this module must not launch a 150-arm run.
 */
async function main(): Promise<void> {
  const args = Deno.args;
  const settings: StudySettings = {
    seed: intArg(args, "seed", DEFAULT_STUDY_SETTINGS.seed),
    corpusRecords: intArg(
      args,
      "corpus-records",
      DEFAULT_STUDY_SETTINGS.corpusRecords,
    ),
    populationSize: intArg(
      args,
      "population",
      DEFAULT_STUDY_SETTINGS.populationSize,
    ),
    generations: intArg(
      args,
      "generations",
      DEFAULT_STUDY_SETTINGS.generations,
    ),
    elitism: intArg(args, "elitism", DEFAULT_STUDY_SETTINGS.elitism),
    trainPerGen: intArg(
      args,
      "train-per-gen",
      DEFAULT_STUDY_SETTINGS.trainPerGen,
    ),
    trainingIterations: intArg(
      args,
      "iterations",
      DEFAULT_STUDY_SETTINGS.trainingIterations,
    ),
  };
  const seedCount = intArg(args, "seeds", 1);
  const repeatCount = intArg(args, "repeats", 1);

  /** Seed stride between repeats, so no two repeats share a seed. */
  const REPEAT_SEED_STRIDE = 1_000;

  const repeats = Array.from(
    { length: repeatCount },
    (_, repeat) =>
      Array.from(
        { length: seedCount },
        (_, i) => settings.seed + repeat * REPEAT_SEED_STRIDE + i,
      ),
  );

  console.log(
    `Issue #3934 Stage 1: ${repeatCount} repeat(s) × ${seedCount} seed(s) × ` +
      `${SELECTION_POLICIES.length} arm(s), ${settings.generations} generations ` +
      `× ${settings.trainPerGen} training events, population ` +
      `${settings.populationSize}, corpus ${settings.corpusRecords} records\n`,
  );

  const report = runStudy(settings, repeats);
  printReport(report);

  const jsonPath = stringArg(args, "json");
  if (jsonPath !== undefined) {
    await Deno.writeTextFile(jsonPath, JSON.stringify(report, null, 2) + "\n");
    console.log(`Wrote ${jsonPath}`);
  }
}

if (import.meta.main) {
  await main();
}
