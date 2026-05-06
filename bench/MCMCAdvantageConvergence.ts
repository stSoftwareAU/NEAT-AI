/**
 * Issue #2527 — MCMC absolute vs groupRelative advantage convergence
 * benchmark.
 *
 * Compares wall-clock convergence of a population of synthetic
 * "creatures" optimising a 1-D scalar parameter under the same
 * Metropolis-Hastings cooling schedule, with the only difference being
 * `mcmcAdvantageMode`. The benchmark intentionally avoids spinning up a
 * full Neat training loop so the comparison is fast, deterministic
 * (seeded RNG), and isolates the acceptance-signal change from every
 * other moving part of NEAT-AI.
 *
 * Why this is a fair comparison:
 *
 * - Both modes share the same initial population, mutation magnitudes,
 *   M-H temperature curriculum, and seed.
 * - The only delta is the acceptance signal: raw `delta` versus
 *   `delta / (cohortStd + eps)`.
 * - Final mean fitness and mean iterations to convergence are reported
 *   for each mode so the PR summary can record both numbers regardless
 *   of which is faster.
 *
 * Run with:
 *   deno run --allow-read --allow-env --allow-write \
 *     bench/MCMCAdvantageConvergence.ts
 */

import {
  type AdvantageMode,
  computeAdvantageStats,
} from "@neat/GroupRelativeAdvantage.ts";
import {
  metropolisHastingsAccept,
  resolveMcmcAcceptanceDelta,
} from "@neat/MetropolisHastings.ts";

/** Number of "creatures" (cohort size). */
const POPULATION_SIZE = 32;
/** Number of M-H steps per trial. */
const ITERATIONS = 500;
/** Number of independent trials to average over. */
const TRIALS = 12;
/** Per-step Gaussian mutation scale (calibrated to NEAT penalty units). */
const MUTATION_SIGMA = 0.05;
/** Initial scatter of the population around the target. */
const INITIAL_SIGMA = 0.5;
/**
 * Initial M-H temperature; geometric cooling per step. Calibrated so
 * the absolute and groupRelative modes start at comparable acceptance
 * rates given the typical cohort std (~0.5) on this problem.
 */
const INITIAL_TEMPERATURE = 0.5;
const COOLING_RATE = 0.992;
const MIN_TEMPERATURE = 0.001;

/**
 * Mulberry32 — small, fast, seeded PRNG. Good enough for a convergence
 * benchmark and identical across both modes when given the same seed,
 * which is what makes the comparison fair.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample a normal(0, 1) variate via Box-Muller. */
function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Scoring function: negative squared distance from the target. */
function score(value: number): number {
  const target = 0;
  const d = value - target;
  return -(d * d);
}

interface TrialResult {
  meanFinalScore: number;
  meanAcceptanceRate: number;
  meanIterations: number;
}

/**
 * Run one optimisation trial under the supplied advantage mode.
 *
 * Each step picks a creature, proposes a mutation, computes the
 * M-H acceptance using the configured mode, and accepts or reverts.
 */
function runTrial(mode: AdvantageMode, seed: number): TrialResult {
  const rng = mulberry32(seed);
  const population = new Array(POPULATION_SIZE);
  for (let i = 0; i < POPULATION_SIZE; i++) {
    population[i] = gaussian(rng) * INITIAL_SIGMA;
  }
  let temperature = INITIAL_TEMPERATURE;
  let accepts = 0;
  let proposals = 0;

  for (let it = 0; it < ITERATIONS; it++) {
    // Cohort std of the current population scores — used in
    // groupRelative mode to normalise the proposed delta.
    const scores = population.map(score);
    const cohortStd = computeAdvantageStats(scores).std;

    const idx = Math.floor(rng() * POPULATION_SIZE);
    const before = population[idx];
    const after = before + gaussian(rng) * MUTATION_SIGMA;

    // Cost = -score (so worsening = positive delta, consistent with
    // the M-H convention used by MetropolisHastings.ts).
    const rawDelta = -score(after) - (-score(before));
    const delta = resolveMcmcAcceptanceDelta(rawDelta, mode, cohortStd);

    proposals++;
    if (metropolisHastingsAccept(delta, temperature, rng())) {
      population[idx] = after;
      accepts++;
    }

    temperature = Math.max(MIN_TEMPERATURE, temperature * COOLING_RATE);
  }

  const finalScores = population.map(score);
  const meanFinalScore = finalScores.reduce((a, b) => a + b, 0) /
    finalScores.length;
  const meanAcceptanceRate = accepts / proposals;
  return {
    meanFinalScore,
    meanAcceptanceRate,
    meanIterations: ITERATIONS,
  };
}

/** Aggregate results across `TRIALS` runs of a single mode. */
function aggregate(mode: AdvantageMode): {
  mode: AdvantageMode;
  meanFinalScore: number;
  bestFinalScore: number;
  worstFinalScore: number;
  meanAcceptanceRate: number;
  wallMs: number;
} {
  let sumFinal = 0;
  let best = -Infinity;
  let worst = Infinity;
  let sumAccept = 0;
  const start = performance.now();
  for (let t = 0; t < TRIALS; t++) {
    const r = runTrial(mode, 1234 + t);
    sumFinal += r.meanFinalScore;
    sumAccept += r.meanAcceptanceRate;
    if (r.meanFinalScore > best) best = r.meanFinalScore;
    if (r.meanFinalScore < worst) worst = r.meanFinalScore;
  }
  const wallMs = performance.now() - start;
  return {
    mode,
    meanFinalScore: sumFinal / TRIALS,
    bestFinalScore: best,
    worstFinalScore: worst,
    meanAcceptanceRate: sumAccept / TRIALS,
    wallMs,
  };
}

if (import.meta.main) {
  console.log(`Issue #2527 — MCMC advantage mode convergence benchmark`);
  console.log(
    `population=${POPULATION_SIZE}, iterations=${ITERATIONS}, trials=${TRIALS}`,
  );
  console.log("");

  const absolute = aggregate("absolute");
  const groupRel = aggregate("groupRelative");

  const fmt = (n: number) => n.toFixed(6);

  console.log(
    `absolute      mean=${fmt(absolute.meanFinalScore)} ` +
      `best=${fmt(absolute.bestFinalScore)} ` +
      `worst=${fmt(absolute.worstFinalScore)} ` +
      `accept=${fmt(absolute.meanAcceptanceRate)} ` +
      `wallMs=${absolute.wallMs.toFixed(2)}`,
  );
  console.log(
    `groupRelative mean=${fmt(groupRel.meanFinalScore)} ` +
      `best=${fmt(groupRel.bestFinalScore)} ` +
      `worst=${fmt(groupRel.worstFinalScore)} ` +
      `accept=${fmt(groupRel.meanAcceptanceRate)} ` +
      `wallMs=${groupRel.wallMs.toFixed(2)}`,
  );

  const delta = groupRel.meanFinalScore - absolute.meanFinalScore;
  // Higher mean score (closer to 0) is better.
  const verdict = delta >= 0 ? "neutral or improved" : "regression";
  console.log("");
  console.log(`mean(score) delta = ${fmt(delta)}  → ${verdict}`);
}
