/**
 * Issue #3259 — Production-calibrated bake-off of generation-efficiency levers.
 *
 * Parent: #3256 (production evolution wall-clock on the GRQ corpus).
 *
 * ## Why a new harness
 *
 * The prior pace work (#2928–#2934, `bench/EvolutionPaceLeverComparison.ts`,
 * Fast Convergence preset) ranks levers by **raw wall-clock** on tiny fixtures
 * where a fitness evaluation is nearly free. In production the opposite holds:
 * fitness scoring is ≈95 % of wall-clock and each full-corpus evaluation costs
 * *minutes* of CPU on a 21 GiB corpus. Under that regime the raw-wall-clock
 * ranking is dominated by breeding/overhead and does **not** transfer.
 *
 * ## The corpus-independent metric
 *
 * When fitness dominates and every full-corpus evaluation costs the same `C`
 * seconds, total wall-clock ≈ `N_scored × C`, where `N_scored` is the number
 * of full-corpus fitness evaluations performed. Ranking levers by wall-clock is
 * therefore equivalent to ranking them by **`N_scored`** — a quantity that is
 * independent of `C` and hence of corpus size. So we can rank the levers
 * faithfully on a laptop by *counting scored evaluations*, then multiply by the
 * production per-evaluation cost (measured on GRQ via #3256 `phaseTimingTotals`)
 * to obtain a modelled production wall-clock. That is the transfer bridge this
 * issue asks for.
 *
 * The harness mirrors production's score-carry contract exactly
 * (`Fitness.calculate` scores only `score === undefined` creatures — Issue
 * #1016): elites carry their score forward and cost **zero** re-scores, while
 * memetically-trained creatures must be re-scored because training changes
 * their output. Each lever therefore moves `N_scored` in a way this harness
 * measures directly:
 *
 *   - `populationSize`  — new (unscored) creatures bred per generation.
 *   - `elitismFraction` — elites carried without re-scoring (redundant scores
 *     avoided); the question "how many full-corpus scores are redundant?".
 *   - `trainPerGen`     — memetic backprop adds one re-score per trained
 *     creature per generation.
 *
 * ## What this harness is and is NOT
 *
 * This is a **methodology** harness. Its convergence dynamics run on a small
 * seeded synthetic supervised problem, so its `N_scored` figures are a sanity
 * check of the *method*, **not** production evidence. Per this issue's adoption
 * gate, a preset may be flipped only when the primary metric improves by ≥5 %
 * on the **production creature + 21 GiB binary corpus** with repeatable seeds.
 * To produce the adoption-gate numbers on GRQ, a human replaces the synthetic
 * `buildNetwork`/`buildDataset`/scoring with the production creature and corpus
 * scorer, and sets `costPerEvalSeconds` to the value measured from #3256
 * `phaseTimingTotals`. This file flips **no** default.
 *
 * No production/runtime code is changed — this is pure measurement + docs.
 *
 * Run with (synthetic sanity check):
 *   deno run --allow-read --allow-env --allow-ffi \
 *     bench/ProductionPaceLeverBakeOff.ts
 *
 * The standalone run reads the modelled per-evaluation cost from the
 * `BAKE_OFF_COST_PER_EVAL_SECONDS` environment variable when set (else the
 * 90-second placeholder), so the real GRQ per-eval cost can be modelled without
 * editing the source.
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import {
  createSeededRng,
  type RandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

// ---------------------------------------------------------------------------
// Options + results
// ---------------------------------------------------------------------------

/** Tunable problem, population policy, and production cost model. */
export interface BakeOffOptions {
  readonly inputs: number;
  readonly outputs: number;
  readonly hidden: number;
  readonly datasetSize: number;
  /** Population size (the `populationSize` lever). */
  readonly populationSize: number;
  /**
   * Fraction of the population carried forward as elites without re-scoring
   * (the elitism lever). Clamped to `[0, 0.9]`; always keeps at least one.
   */
  readonly elitismFraction: number;
  /** Fittest members trained with real backprop each generation (memetic). */
  readonly trainPerGen: number;
  /** Inner backprop iterations per trained creature per generation. */
  readonly innerTrainIters: number;
  /** Generation cap. */
  readonly generations: number;
  /** Best-error threshold that counts as "reached target". */
  readonly targetError: number;
  /** Deterministic seed. */
  readonly seed: number;
  /**
   * Modelled cost of one full-corpus fitness evaluation, in seconds. On GRQ
   * this is derived from #3256 `phaseTimingTotals` (fitness ms ÷ scored count).
   * Only scales `modelledWallClockSeconds`; it never affects `scoredEvaluations`
   * or the lever ranking.
   */
  readonly costPerEvalSeconds: number;
}

/** Measured outcome for one lever configuration. */
export interface BakeOffResult {
  readonly name: string;
  readonly populationSize: number;
  readonly elitismFraction: number;
  readonly trainPerGen: number;
  /**
   * Total number of full-corpus fitness evaluations performed — the
   * corpus-independent primary metric (production wall-clock ∝ this).
   */
  readonly scoredEvaluations: number;
  /** Generations until `targetError` reached, or `null` if never reached. */
  readonly generationsToTarget: number | null;
  /** Best (lowest) error reached during the run. */
  readonly bestError: number;
  /** Modelled production wall-clock: `scoredEvaluations × costPerEvalSeconds`. */
  readonly modelledWallClockSeconds: number;
}

/**
 * Production-shaped defaults. Kept modest so a standalone run finishes quickly;
 * the *ranking* — not the absolute count — is the transferable signal.
 * `costPerEvalSeconds` defaults to a 90-second placeholder (a minutes-scale
 * full-corpus score); pass the real GRQ figure to model true wall-clock.
 */
export const DEFAULT_BAKE_OFF_OPTIONS: BakeOffOptions = {
  inputs: 6,
  outputs: 3,
  hidden: 8,
  datasetSize: 48,
  populationSize: 24,
  elitismFraction: 0.1,
  trainPerGen: 6,
  innerTrainIters: 4,
  generations: 60,
  targetError: 0.05,
  seed: 3259,
  costPerEvalSeconds: 90,
};

// ---------------------------------------------------------------------------
// Fixed supervised problem (same construction as EvolutionPaceLeverComparison)
// ---------------------------------------------------------------------------

interface Sample {
  readonly input: Float32Array;
  readonly target: Float32Array;
}

const BASE_LEARNING_RATE = 0.1;
const BASE_PERTURB_SCALE = 0.1;

function buildNetwork(
  rng: RandomNumberGenerator,
  opts: BakeOffOptions,
): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  const inputUUIDs = Array.from(
    { length: opts.inputs },
    (_, i) => `input-${i}`,
  );
  const hiddenUUIDs: string[] = [];
  for (let h = 0; h < opts.hidden; h++) {
    const uuid = `h-${h}`;
    hiddenUUIDs.push(uuid);
    neurons.push({
      type: "hidden",
      uuid,
      squash: "TANH",
      bias: (rng.random() * 2 - 1) * 0.1,
    });
  }
  const outputUUIDs: string[] = [];
  for (let o = 0; o < opts.outputs; o++) {
    const uuid = `output-${o}`;
    outputUUIDs.push(uuid);
    neurons.push({
      type: "output",
      uuid,
      squash: "LOGISTIC",
      bias: (rng.random() * 2 - 1) * 0.1,
    });
  }

  for (const from of inputUUIDs) {
    for (const to of hiddenUUIDs) {
      synapses.push({
        fromUUID: from,
        toUUID: to,
        weight: (rng.random() * 2 - 1) * 0.3,
      });
    }
  }
  for (const from of hiddenUUIDs) {
    for (const to of outputUUIDs) {
      synapses.push({
        fromUUID: from,
        toUUID: to,
        weight: (rng.random() * 2 - 1) * 0.3,
      });
    }
  }

  return {
    input: opts.inputs,
    output: opts.outputs,
    neurons,
    synapses,
  };
}

function buildDataset(
  rng: RandomNumberGenerator,
  opts: BakeOffOptions,
): Sample[] {
  const targetW: number[][] = Array.from(
    { length: opts.outputs },
    () => Array.from({ length: opts.inputs }, () => rng.random() * 2 - 1),
  );
  const logistic = (x: number) => 1 / (1 + Math.exp(-x));

  const samples: Sample[] = [];
  for (let s = 0; s < opts.datasetSize; s++) {
    const input = new Float32Array(opts.inputs);
    for (let i = 0; i < opts.inputs; i++) input[i] = rng.random() * 2 - 1;
    const target = new Float32Array(opts.outputs);
    for (let o = 0; o < opts.outputs; o++) {
      let sum = 0;
      for (let i = 0; i < opts.inputs; i++) sum += targetW[o][i] * input[i];
      target[o] = logistic(sum);
    }
    samples.push({ input, target });
  }
  return samples;
}

function meanError(
  creature: Creature,
  data: readonly Sample[],
  outputs: number,
): number {
  let total = 0;
  for (const { input, target } of data) {
    const out = creature.activate(input);
    for (let o = 0; o < outputs; o++) total += Math.abs(out[o] - target[o]);
  }
  return total / (data.length * outputs);
}

function trainCreature(
  creature: Creature,
  data: readonly Sample[],
  learningRate: number,
  innerIters: number,
): void {
  const json = creature.exportJSON();
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
  });
  const sparse = new SparseConfig(json, config);
  for (let iter = 0; iter < innerIters; iter++) {
    for (const { input, target } of data) {
      creature.activateAndTrace(input, false, sparse);
      creature.propagate(target, config, sparse);
    }
  }
  creature.applyLearnings(config, sparse);
}

function perturb(
  source: Creature,
  rng: RandomNumberGenerator,
  scale: number,
): Creature {
  const json = source.exportJSON();
  for (const s of json.synapses) s.weight += (rng.random() * 2 - 1) * scale;
  for (const n of json.neurons) {
    if (typeof n.bias === "number") n.bias += (rng.random() * 2 - 1) * scale;
  }
  return Creature.fromJSON(json);
}

// ---------------------------------------------------------------------------
// One member of the evolving population
// ---------------------------------------------------------------------------

interface Member {
  creature: Creature;
  error: number;
}

/** Number of elites carried (score reused) for the given options. */
export function eliteCount(opts: BakeOffOptions): number {
  const fraction = Math.min(0.9, Math.max(0, opts.elitismFraction));
  return Math.max(1, Math.floor(opts.populationSize * fraction));
}

// ---------------------------------------------------------------------------
// Core bake-off loop, parameterised by the population-policy levers
// ---------------------------------------------------------------------------

/**
 * Runs one seeded evolution under `opts`, faithfully counting full-corpus
 * fitness evaluations under production's score-carry contract (elites are never
 * re-scored; trained creatures always are). Pure and deterministic: identical
 * options → identical `scoredEvaluations`, `generationsToTarget`, `bestError`.
 */
export function runBakeOffConfig(opts: BakeOffOptions): BakeOffResult {
  const setupRng = createSeededRng(opts.seed);
  const dataset = buildDataset(setupRng, opts);
  // A distinct stream for evolution so dataset size does not shift breeding.
  const rng = createSeededRng(opts.seed ^ 0x5bd1e995);

  let scoredEvaluations = 0;
  const score = (creature: Creature): number => {
    scoredEvaluations++;
    return meanError(creature, dataset, opts.outputs);
  };

  // Initial population — every member is unscored, so every member is scored.
  let members: Member[] = [];
  for (let p = 0; p < opts.populationSize; p++) {
    const creature = Creature.fromJSON(buildNetwork(setupRng, opts));
    members.push({ creature, error: score(creature) });
  }

  const keep = Math.min(members.length, eliteCount(opts));
  let best = Number.POSITIVE_INFINITY;
  let generationsToTarget: number | null = null;

  for (let gen = 0; gen < opts.generations; gen++) {
    members.sort((a, b) => a.error - b.error);
    best = Math.min(best, members[0].error);

    if (best <= opts.targetError) {
      generationsToTarget = gen;
      break;
    }

    // Memetic training: train the fittest `trainPerGen`, then re-score them
    // (training changes their output, so the carried score is invalidated).
    const trainCount = Math.min(opts.trainPerGen, members.length);
    for (let i = 0; i < trainCount; i++) {
      const m = members[i];
      trainCreature(
        m.creature,
        dataset,
        BASE_LEARNING_RATE,
        opts.innerTrainIters,
      );
      m.error = score(m.creature);
    }
    members.sort((a, b) => a.error - b.error);

    // Elitism: carry the top `keep` members WITH their scores (no re-score).
    const next: Member[] = members.slice(0, keep).map((m) => ({ ...m }));

    // Breed the remainder from the top quartile; each child is unscored.
    const topQuarter = Math.max(1, Math.floor(members.length / 4));
    while (next.length < opts.populationSize) {
      const parent = members[rng.randomInt(0, topQuarter - 1)];
      const childCreature = perturb(parent.creature, rng, BASE_PERTURB_SCALE);
      next.push({ creature: childCreature, error: score(childCreature) });
    }

    members = next;
  }

  // Final sweep so a last-generation improvement is not missed (no re-score:
  // every surviving member already carries a score).
  for (const m of members) best = Math.min(best, m.error);
  if (generationsToTarget === null && best <= opts.targetError) {
    generationsToTarget = opts.generations;
  }

  return {
    name:
      `pop=${opts.populationSize} elite=${opts.elitismFraction} train=${opts.trainPerGen}`,
    populationSize: opts.populationSize,
    elitismFraction: opts.elitismFraction,
    trainPerGen: opts.trainPerGen,
    scoredEvaluations,
    generationsToTarget,
    bestError: best,
    modelledWallClockSeconds: scoredEvaluations * opts.costPerEvalSeconds,
  };
}

/**
 * One-factor-at-a-time sweep: runs `base` once per override, changing a single
 * lever each time. Returns one result per override (in order).
 */
export function runLeverSweep(
  base: BakeOffOptions,
  overrides: readonly Partial<BakeOffOptions>[],
): BakeOffResult[] {
  return overrides.map((o) => runBakeOffConfig({ ...base, ...o }));
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** Renders results as a GitHub-flavoured Markdown table. */
export function formatBakeOffTable(results: readonly BakeOffResult[]): string {
  const header =
    "| config | scored evals | gens-to-target | best error | modelled wall-clock (s) |";
  const divider =
    "| ------ | ------------ | -------------- | ---------- | ----------------------- |";
  const rows = results.map((r) => {
    const gens = r.generationsToTarget === null
      ? "—"
      : r.generationsToTarget.toString();
    return `| ${r.name} | ${r.scoredEvaluations} | ${gens} | ${
      r.bestError.toFixed(6)
    } | ${r.modelledWallClockSeconds.toFixed(1)} |`;
  });
  return [header, divider, ...rows].join("\n");
}

/**
 * Picks the result with the lowest modelled wall-clock among those that
 * reached the target. Returns `null` when none reached it.
 */
export function recommendByWallClock(
  results: readonly BakeOffResult[],
): BakeOffResult | null {
  const reached = results.filter((r) => r.generationsToTarget !== null);
  if (reached.length === 0) return null;
  return reached.reduce((best, r) =>
    r.modelledWallClockSeconds < best.modelledWallClockSeconds ? r : best
  );
}

// ---------------------------------------------------------------------------
// Standalone benchmark entrypoint
// ---------------------------------------------------------------------------

/** Reads the modelled per-eval cost from the environment, else the default. */
function resolveCostPerEvalSeconds(fallback: number): number {
  const raw = Deno.env.get("BAKE_OFF_COST_PER_EVAL_SECONDS");
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `BAKE_OFF_COST_PER_EVAL_SECONDS must be a positive number, got: ${raw}`,
    );
  }
  return parsed;
}

if (import.meta.main) {
  const base: BakeOffOptions = {
    ...DEFAULT_BAKE_OFF_OPTIONS,
    costPerEvalSeconds: resolveCostPerEvalSeconds(
      DEFAULT_BAKE_OFF_OPTIONS.costPerEvalSeconds,
    ),
  };
  console.log("Issue #3259 — Production pace-lever bake-off\n");
  console.log(
    `Primary metric: full-corpus scored evaluations (production wall-clock ∝ this).\n` +
      `Modelled cost per evaluation: ${base.costPerEvalSeconds}s ` +
      `(set BAKE_OFF_COST_PER_EVAL_SECONDS to the GRQ figure).\n`,
  );

  const sweeps: Record<string, Partial<BakeOffOptions>[]> = {
    populationSize: [
      { populationSize: 12 },
      { populationSize: 24 },
      { populationSize: 48 },
    ],
    elitismFraction: [
      { elitismFraction: 0.0 },
      { elitismFraction: 0.1 },
      { elitismFraction: 0.25 },
      { elitismFraction: 0.5 },
    ],
    trainPerGen: [
      { trainPerGen: 0 },
      { trainPerGen: 2 },
      { trainPerGen: 6 },
    ],
  };

  for (const [lever, overrides] of Object.entries(sweeps)) {
    console.log(`\n### ${lever} sweep\n`);
    const results = runLeverSweep(base, overrides);
    console.log(formatBakeOffTable(results));
    const rec = recommendByWallClock(results);
    if (rec) {
      console.log(
        `\nLowest modelled wall-clock that reached target: ${rec.name} ` +
          `(${rec.scoredEvaluations} scored evals).`,
      );
    }
  }

  console.log(
    "\nNOTE: synthetic sanity check only — NOT production evidence. " +
      "Flip a default only after ≥5% improvement on the GRQ corpus/creature.",
  );
}
