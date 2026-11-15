/**
 * One genome expressed at several complexity budgets — Issue #4161.
 *
 * The question: if a single genome carries a heritable *expression order* (a
 * priority per candidate synapse) and is trained against several size budgets
 * at once, does the champion's smaller expressions generalise better — in
 * particular to budgets it was never trained at — than (a) a separate search
 * per budget at the same total cost, or (b) one full-size search whose
 * finished network is pruned by weight magnitude?
 *
 * ## Design
 *
 * A genome is a fixed pool of {@link SYNAPSE_COUNT} candidate synapses (4
 * inputs to 8 hidden, 8 hidden to 1 output, 4 inputs to the output), each with
 * a weight and a priority, plus biases. Expressing the genome at budget `b`
 * keeps the top `round(b * 44)` candidates by priority, then drops every
 * hidden neuron left without an inbound or an outbound kept synapse, so a
 * smaller budget is always a nested subset of a larger one.
 *
 * Arms (equal charged train records `C` per seed):
 *
 * - `conditioned`: one search whose fitness is the mean calibration MSE over
 *   the training budgets (25%, 50%, 100%); the champion is expressed at every
 *   evaluation budget, including the two unseen ones (37.5%, 75%).
 * - `independent`: five searches, one per evaluation budget, each with `C / 5`.
 * - `pruned`: one full-size search; the champion is cut to each budget by
 *   `|weight|` with no retraining.
 *
 * ## Relation to NEAT-AI-Ockham
 *
 * NEAT-AI-Ockham prunes a finished network's frozen weights. Here the
 * expression order is an evolved, heritable gene, selected under the budgets;
 * the `pruned` control is the frozen-weight-by-magnitude alternative and is
 * the thing the conditioned arm has to beat.
 *
 * ## What is real and what is a stand-in
 *
 * Real: the creatures ({@link Creature}), their validation
 * ({@link creatureValidate}) and the scoring ({@link scoreCreature}).
 *
 * A stand-in: the search is a small (mu+lambda) evolution over the genome
 * vector rather than the production NEAT-AI loop, and the objective is a
 * synthetic 4-input regression scored in-process. Cost is counted in charged
 * calibration records. The validation split is read only after a search has
 * finished and never guides a decision. Latency is indicative wall-clock only
 * and never feeds a verdict.
 *
 * The cited paper's method is pinned in {@link SOURCE_METHOD}, together with
 * how this study maps onto it and where it departs. The main departure: the
 * paper feeds developmental time to a HyperNEAT generator as an input, while
 * this genome has no budget input. A budget picks the top-k synapses by an
 * evolved priority gene, so the negative result here does not test the
 * paper's generator.
 *
 * @module budgetConditionedStudy
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import {
  createSeededRng,
  type RandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { type ABRecord, scoreCreature } from "./preSelectionAB.ts";
import {
  buildStudyCorpus,
  pairedBootstrapCi,
  quantile,
} from "./connectivityPriorStudy.ts";
import { median } from "./rankFidelity.ts";
import denoConfig from "../../deno.json" with { type: "json" };

/** Network inputs. */
export const INPUTS = 4;
/** Candidate hidden neurons. */
export const HIDDEN = 8;

/** A candidate synapse, by endpoint. `to === HIDDEN` is the output. */
export interface Candidate {
  readonly from: { kind: "input" | "hidden"; index: number };
  readonly to: { kind: "hidden" | "output"; index: number };
}

/** Input to hidden, then hidden to output, then input to output. */
export const CANDIDATES: readonly Candidate[] = (() => {
  const list: Candidate[] = [];
  for (let k = 0; k < INPUTS; k++) {
    for (let h = 0; h < HIDDEN; h++) {
      list.push({
        from: { kind: "input", index: k },
        to: { kind: "hidden", index: h },
      });
    }
  }
  for (let h = 0; h < HIDDEN; h++) {
    list.push({
      from: { kind: "hidden", index: h },
      to: { kind: "output", index: 0 },
    });
  }
  for (let k = 0; k < INPUTS; k++) {
    list.push({
      from: { kind: "input", index: k },
      to: { kind: "output", index: 0 },
    });
  }
  return list;
})();

/** Number of candidate synapses (44). */
export const SYNAPSE_COUNT = CANDIDATES.length;

/** Budgets the conditioned arm trains on. */
export const TRAINING_BUDGETS: readonly number[] = [0.25, 0.5, 1];
/** Budgets no arm's conditioned search sees. */
export const UNSEEN_BUDGETS: readonly number[] = [0.375, 0.75];
/** Every budget a champion is expressed and validated at. */
export const EVAL_BUDGETS: readonly number[] = [0.25, 0.375, 0.5, 0.75, 1];

/** First validation seed. */
export const VALIDATION_BASE_SEED = 4161;
/** Seeds in the real study. */
export const SEED_COUNT = 20;
/** Seed of the corpus every run scores against. */
export const CORPUS_SEED = 4161;
/** Bootstrap resamples. */
export const BOOTSTRAP_RESAMPLES = 10_000;
/** Bootstrap seed. */
export const BOOTSTRAP_SEED = 4161;

/** Arms, in the order their rng streams are derived. */
export const ARM_NAMES = ["conditioned", "independent", "pruned"] as const;
export type ArmName = typeof ARM_NAMES[number];

/** How one run is set up. */
export interface BudgetStudySettings {
  readonly mu: number;
  readonly lambda: number;
  /** Charged calibration records one arm may spend per seed. */
  readonly budgetRecords: number;
  readonly calibrationRecords: number;
  readonly validationRecords: number;
  readonly geneMutationRate: number;
  readonly mutationSigma: number;
  /** Measure activation latency on the validation records. */
  readonly measureLatency: boolean;
}

/** Defaults for the real study. */
export const DEFAULT_SETTINGS: BudgetStudySettings = Object.freeze({
  mu: 10,
  lambda: 10,
  budgetRecords: 300_000,
  calibrationRecords: 300,
  validationRecords: 300,
  geneMutationRate: 0.2,
  mutationSigma: 0.3,
  measureLatency: false,
});

/** Refuse settings that cannot describe a run. */
export function validateSettings(s: BudgetStudySettings): void {
  const counts: (keyof BudgetStudySettings)[] = [
    "mu",
    "lambda",
    "budgetRecords",
    "calibrationRecords",
    "validationRecords",
  ];
  for (const field of counts) {
    const value = s[field] as number;
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(
        `settings.${field} must be a positive integer, got ${value}`,
      );
    }
  }
  if (!(s.geneMutationRate > 0 && s.geneMutationRate <= 1)) {
    throw new Error(
      `settings.geneMutationRate must be in (0, 1], got ${s.geneMutationRate}`,
    );
  }
  if (!(s.mutationSigma > 0) || !Number.isFinite(s.mutationSigma)) {
    throw new Error(
      `settings.mutationSigma must be a positive number, got ${s.mutationSigma}`,
    );
  }
}

/** Synapses kept at `budget`. */
export function budgetSynapses(budget: number): number {
  if (!Number.isFinite(budget) || budget <= 0 || budget > 1) {
    throw new Error(`budget ${budget} must be in (0, 1]`);
  }
  const kept = Math.round(budget * SYNAPSE_COUNT);
  if (kept < 1) throw new Error(`budget ${budget} rounds to no synapses`);
  return kept;
}

/** The heritable genome. */
export interface Genome {
  weights: number[];
  priorities: number[];
  /** Hidden biases, then the output bias last. */
  biases: number[];
}

/** A random genome from the local stream. */
export function randomGenome(rng: RandomNumberGenerator): Genome {
  const u = (lo: number, hi: number) => lo + rng.random() * (hi - lo);
  return {
    weights: Array.from({ length: SYNAPSE_COUNT }, () => u(-1, 1)),
    priorities: Array.from({ length: SYNAPSE_COUNT }, () => u(0, 1)),
    biases: Array.from({ length: HIDDEN + 1 }, () => u(-1, 1)),
  };
}

export type Ranking = "priority" | "magnitude";

/** A genome expressed at one budget. */
export interface Expression {
  creature: Creature;
  /** Candidate indices kept by the ranking. */
  kept: number[];
  keptSynapses: number;
  /** Synapses left once dead-end hidden neurons are dropped. */
  effectiveSynapses: number;
  expressivity: number;
  valid: boolean;
  /** The validator's message when `valid` is false, otherwise null. */
  invalidReason: string | null;
}

/** Candidate indices kept at `budget` under `ranking`, in rank order. */
export function keptIndices(
  genome: Genome,
  budget: number,
  ranking: Ranking,
): number[] {
  const key = (i: number) =>
    ranking === "priority" ? genome.priorities[i] : Math.abs(genome.weights[i]);
  const order = Array.from({ length: SYNAPSE_COUNT }, (_, i) => i);
  order.sort((a, b) => key(b) - key(a) || a - b);
  return order.slice(0, budgetSynapses(budget));
}

const hiddenUuid = (h: number) => `hidden-${h}`;
const OUTPUT_UUID = "out-0";
const endpoint = (
  e: { kind: "input" | "hidden" | "output"; index: number },
) =>
  e.kind === "input"
    ? `input-${e.index}`
    : e.kind === "hidden"
    ? hiddenUuid(e.index)
    : OUTPUT_UUID;

/** Express `genome` at `budget`. */
export function expressGenome(
  genome: Genome,
  budget: number,
  ranking: Ranking,
): Expression {
  const kept = keptIndices(genome, budget, ranking);
  const hasIn = new Array<boolean>(HIDDEN).fill(false);
  const hasOut = new Array<boolean>(HIDDEN).fill(false);
  for (const i of kept) {
    const c = CANDIDATES[i];
    if (c.to.kind === "hidden") hasIn[c.to.index] = true;
    if (c.from.kind === "hidden") hasOut[c.from.index] = true;
  }
  const live = hasIn.map((v, h) => v && hasOut[h]);
  const effective = [...kept].sort((a, b) => a - b).filter((i) => {
    const c = CANDIDATES[i];
    if (c.to.kind === "hidden" && !live[c.to.index]) return false;
    if (c.from.kind === "hidden" && !live[c.from.index]) return false;
    return true;
  });

  const neurons: CreatureExport["neurons"] = [];
  for (let h = 0; h < HIDDEN; h++) {
    if (!live[h]) continue;
    neurons.push({
      type: "hidden",
      uuid: hiddenUuid(h),
      squash: "TANH",
      bias: genome.biases[h],
    });
  }
  neurons.push({
    type: "output",
    uuid: OUTPUT_UUID,
    squash: "IDENTITY",
    bias: genome.biases[HIDDEN],
  });
  const synapses: CreatureExport["synapses"] = effective.map((i) => ({
    fromUUID: endpoint(CANDIDATES[i].from),
    toUUID: endpoint(CANDIDATES[i].to),
    weight: genome.weights[i],
  }));

  let creature: Creature;
  try {
    creature = Creature.fromJSON({
      neurons,
      synapses,
      input: INPUTS,
      output: 1,
      forwardOnly: true,
    });
  } catch (error) {
    throw new Error(
      `expressing budget ${budget} (${ranking}) with ${synapses.length} synapses failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  let invalidReason: string | null = null;
  try {
    creatureValidate(creature);
  } catch (error) {
    // Recorded as result fields and counted in the summary, not hidden.
    invalidReason = error instanceof Error ? error.message : String(error);
  }
  return {
    creature,
    kept,
    keptSynapses: kept.length,
    effectiveSynapses: effective.length,
    expressivity: effective.length / kept.length,
    valid: invalidReason === null,
    invalidReason,
  };
}

/** Mean calibration MSE over `budgets`; non-finite becomes `Infinity`. */
export function calibrationMse(
  genome: Genome,
  budgets: readonly number[],
  ranking: Ranking,
  calibration: readonly ABRecord[],
): number {
  let sum = 0;
  for (const b of budgets) {
    const e = expressGenome(genome, b, ranking);
    sum += -scoreCreature(e.creature, calibration).score;
  }
  const mse = sum / budgets.length;
  return Number.isFinite(mse) ? mse : Infinity;
}

/** A standard normal draw (Box-Muller) from the local stream. */
function gaussian(rng: RandomNumberGenerator): number {
  const u1 = Math.max(rng.random(), Number.MIN_VALUE);
  const u2 = rng.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function offspringOf(
  a: Genome,
  b: Genome,
  settings: BudgetStudySettings,
  rng: RandomNumberGenerator,
): Genome {
  const child = (x: number[], y: number[]) =>
    x.map((v, i) => {
      const gene = rng.random() < 0.5 ? v : y[i];
      return rng.random() < settings.geneMutationRate
        ? gene + gaussian(rng) * settings.mutationSigma
        : gene;
    });
  return {
    weights: child(a.weights, b.weights),
    priorities: child(a.priorities, b.priorities),
    biases: child(a.biases, b.biases),
  };
}

/** What a search returns. */
export interface EvolveResult {
  champion: Genome;
  championFitness: number;
  recordsCharged: number;
  evaluations: number;
  generations: number;
}

/** (mu+lambda) truncation search under a charged-record budget. */
export function evolve(
  trainBudgets: readonly number[],
  ranking: Ranking,
  recordBudget: number,
  settings: BudgetStudySettings,
  corpus: { train: readonly ABRecord[] },
  rng: RandomNumberGenerator,
): EvolveResult {
  validateSettings(settings);
  const cost = corpus.train.length * trainBudgets.length;
  let charged = 0;
  let evaluations = 0;
  const evaluate = (g: Genome): number | null => {
    if (charged + cost > recordBudget) return null;
    charged += cost;
    evaluations++;
    return calibrationMse(g, trainBudgets, ranking, corpus.train);
  };
  type Scored = { genome: Genome; fitness: number };

  let survivors: Scored[] = [];
  for (let i = 0; i < settings.mu; i++) {
    const genome = randomGenome(rng);
    const fitness = evaluate(genome);
    if (fitness === null) break;
    survivors.push({ genome, fitness });
  }
  if (survivors.length < settings.mu) {
    throw new Error(
      `budget ${recordBudget} cannot evaluate ${settings.mu} initial genomes at ${cost} records each`,
    );
  }
  survivors.sort((a, b) => a.fitness - b.fitness);

  let generations = 0;
  let halted = false;
  while (!halted) {
    const children: Scored[] = [];
    for (let i = 0; i < settings.lambda; i++) {
      const pa = survivors[Math.floor(rng.random() * survivors.length)];
      const pb = survivors[Math.floor(rng.random() * survivors.length)];
      const genome = offspringOf(pa.genome, pb.genome, settings, rng);
      const fitness = evaluate(genome);
      if (fitness === null) {
        halted = true;
        break;
      }
      children.push({ genome, fitness });
    }
    if (children.length > 0) generations++;
    survivors = [...survivors, ...children]
      .sort((a, b) => a.fitness - b.fitness)
      .slice(0, settings.mu);
  }
  return {
    champion: survivors[0].genome,
    championFitness: survivors[0].fitness,
    recordsCharged: charged,
    evaluations,
    generations,
  };
}

/** One champion expressed and validated at one budget. */
export interface BudgetResult {
  budget: number;
  keptSynapses: number;
  effectiveSynapses: number;
  expressivity: number;
  valid: boolean;
  invalidReason: string | null;
  calibrationMse: number;
  validationMse: number;
  /** Mean microseconds per activation; null unless measured. */
  latencyMicros: number | null;
}

/** One arm at one seed. */
export interface ArmSeedRun {
  arm: ArmName;
  seed: number;
  recordsCharged: number;
  evaluations: number;
  budgets: BudgetResult[];
}

type Corpus = {
  train: readonly ABRecord[];
  holdout: readonly ABRecord[];
};

function resultFor(
  genome: Genome,
  budget: number,
  ranking: Ranking,
  settings: BudgetStudySettings,
  corpus: Corpus,
): BudgetResult {
  const e = expressGenome(genome, budget, ranking);
  const calibration = -scoreCreature(e.creature, corpus.train).score;
  // Validation is read here, after the search that produced `genome` is over.
  const validation = -scoreCreature(e.creature, corpus.holdout).score;
  let latencyMicros: number | null = null;
  if (settings.measureLatency && corpus.holdout.length > 0) {
    const start = performance.now();
    for (const r of corpus.holdout) e.creature.activate(r.input, false);
    latencyMicros = ((performance.now() - start) * 1000) /
      corpus.holdout.length;
  }
  return {
    budget,
    keptSynapses: e.keptSynapses,
    effectiveSynapses: e.effectiveSynapses,
    expressivity: e.expressivity,
    valid: e.valid,
    invalidReason: e.invalidReason,
    calibrationMse: Number.isFinite(calibration) ? calibration : Infinity,
    validationMse: Number.isFinite(validation) ? validation : Infinity,
    latencyMicros,
  };
}

/** Run one arm at one seed. */
export function runArmSeed(
  arm: ArmName,
  seed: number,
  settings: BudgetStudySettings,
  corpus: Corpus,
): ArmSeedRun {
  validateSettings(settings);
  const armIndex = ARM_NAMES.indexOf(arm);
  if (armIndex < 0) throw new Error(`unknown arm ${arm}`);
  const base = seed * 31 + armIndex;
  const C = settings.budgetRecords;
  const budgets: BudgetResult[] = [];
  let recordsCharged = 0;
  let evaluations = 0;

  if (arm === "conditioned") {
    const r = evolve(
      TRAINING_BUDGETS,
      "priority",
      C,
      settings,
      corpus,
      createSeededRng(base),
    );
    recordsCharged = r.recordsCharged;
    evaluations = r.evaluations;
    for (const b of EVAL_BUDGETS) {
      budgets.push(resultFor(r.champion, b, "priority", settings, corpus));
    }
  } else if (arm === "independent") {
    const each = Math.floor(C / EVAL_BUDGETS.length);
    EVAL_BUDGETS.forEach((b, bi) => {
      const r = evolve(
        [b],
        "priority",
        each,
        settings,
        corpus,
        createSeededRng(base + 1_000_003 * (bi + 1)),
      );
      recordsCharged += r.recordsCharged;
      evaluations += r.evaluations;
      budgets.push(resultFor(r.champion, b, "priority", settings, corpus));
    });
  } else {
    const r = evolve(
      [1],
      "priority",
      C,
      settings,
      corpus,
      createSeededRng(base),
    );
    recordsCharged = r.recordsCharged;
    evaluations = r.evaluations;
    for (const b of EVAL_BUDGETS) {
      budgets.push(resultFor(r.champion, b, "magnitude", settings, corpus));
    }
  }
  return { arm, seed, recordsCharged, evaluations, budgets };
}

/** Mean validation MSE over the unseen budgets. */
export function unseenScore(run: ArmSeedRun): number {
  const rows = run.budgets.filter((b) => UNSEEN_BUDGETS.includes(b.budget));
  return rows.reduce((s, b) => s + b.validationMse, 0) / rows.length;
}

export type BudgetVerdictName =
  | "insufficient-data"
  | "benefit"
  | "harm"
  | "no-benefit";

/** Lower is better throughout: the inputs are MSE differences. */
export function budgetVerdict(
  n: number,
  ci: { low: number; high: number },
): BudgetVerdictName {
  if (n < 5) return "insufficient-data";
  if (ci.high < 0) return "benefit";
  if (ci.low > 0) return "harm";
  return "no-benefit";
}

/** A paired comparison of conditioned against one control. */
export interface BudgetComparison {
  n: number;
  meanDiff: number;
  ci: { mean: number; low: number; high: number };
  wins: number;
  losses: number;
  verdict: BudgetVerdictName;
}

/** Pair by seed; diff is conditioned minus control. */
export function compare(
  conditionedRuns: readonly ArmSeedRun[],
  controlRuns: readonly ArmSeedRun[],
  pick: (run: ArmSeedRun) => number,
  resamples = BOOTSTRAP_RESAMPLES,
  bootstrapSeed = BOOTSTRAP_SEED,
): BudgetComparison {
  if (
    conditionedRuns.length !== controlRuns.length ||
    conditionedRuns.some((r, i) => r.seed !== controlRuns[i].seed)
  ) {
    throw new Error("conditioned and control runs are not paired by seed");
  }
  const n = conditionedRuns.length;
  const diffs = conditionedRuns.map((r, i) => pick(r) - pick(controlRuns[i]));
  const ci = n === 0
    ? { mean: NaN, low: NaN, high: NaN }
    : pairedBootstrapCi(diffs, resamples, bootstrapSeed);
  return {
    n,
    meanDiff: ci.mean,
    ci,
    wins: diffs.filter((d) => d < 0).length,
    losses: diffs.filter((d) => d > 0).length,
    verdict: budgetVerdict(n, ci),
  };
}

/** The predeclared success rule. */
export function studyOutcome(c: {
  vsIndependent: { verdict: BudgetVerdictName };
  vsPruned: { verdict: BudgetVerdictName };
  fullSize: { verdict: BudgetVerdictName };
}): { outcome: "success" | "failure"; reasons: string[] } {
  const reasons: string[] = [];
  if (c.vsIndependent.verdict !== "benefit") {
    reasons.push(
      `conditioned does not beat independent per-budget searches on unseen budgets (${c.vsIndependent.verdict})`,
    );
  }
  if (c.vsPruned.verdict !== "benefit") {
    reasons.push(
      `conditioned does not beat the magnitude-pruned full-size network on unseen budgets (${c.vsPruned.verdict})`,
    );
  }
  if (c.fullSize.verdict === "harm") {
    reasons.push(
      "conditioned regresses against the pruned arm at the full-size budget",
    );
  }
  return { outcome: reasons.length === 0 ? "success" : "failure", reasons };
}

/** Options for {@link runStudy}. */
export interface StudyOptions {
  codeVersion?: string;
  seedCount?: number;
  baseSeed?: number;
  budgetRecords?: number;
  populationSize?: number;
  settings?: Partial<BudgetStudySettings>;
}

interface Failure {
  arm: ArmName;
  seed: number;
  message: string;
}

/** One element of the source method, how this study maps it, and how faithfully. */
export interface PinnedMethodElement {
  /** The paper's element, as read. */
  paper: string;
  /** What this study does in its place. */
  study: string;
  /** `same`: reproduced as read. `analogue`: same role, different mechanism. `departs`: not reproduced. */
  fidelity: "same" | "analogue" | "departs";
}

/**
 * The source method, pinned before the reproduction is judged (Issue #4161).
 *
 * The paper was read on 2026-11-15 through search-indexed excerpts of its
 * abstract page and its HTML full text. A direct fetch of arxiv.org was
 * refused by this host's proxy, so the details the excerpts do not give are
 * listed in `unpinned`, not guessed.
 */
export const SOURCE_METHOD = Object.freeze({
  arxivId: "2611.06895",
  version: "v1",
  submitted: "2026-11-04",
  doi: "10.48550/arXiv.2611.06895",
  title:
    "Learning Time-Varying Connectomes for Stable Behavior Across Development",
  authors: ["Christof Fehrman", "Jacob J. Morra", "Eva A. Naumann"],
  categories: ["q-bio.NC", "cs.NE"],
  readOn: "2026-11-15",
  readVia:
    "search-indexed excerpts of https://arxiv.org/abs/2611.06895 and https://arxiv.org/html/2611.06895; direct fetch refused by the host proxy",
  elements: Object.freeze(
    [
      {
        paper:
          "One compact generative encoding: a HyperNEAT CPPN that takes developmental time as an extra input and emits age-specific connectivity for a recurrent controller.",
        study:
          "One genome of weights, biases and an evolved expression-priority gene; a budget keeps the top-k candidate synapses by priority. The genome has no budget input.",
        fidelity: "departs",
      },
      {
        paper:
          "The substrate (neuron birth, position, sensory organisation, intrinsic time constants) is prescribed per age; only connectivity is generated.",
        study:
          "One fixed candidate topology (4 inputs, 8 hidden, 1 output, 44 candidate synapses); the budget sets how many candidates are expressed.",
        fidelity: "analogue",
      },
      {
        paper:
          "Developmentally aware conditions optimise mean fitness across 3, 5 or 15 evenly spaced developmental snapshots.",
        study:
          "The conditioned arm optimises mean calibration MSE across 3 budgets: 25%, 50% and 100% (not evenly spaced).",
        fidelity: "analogue",
      },
      {
        paper:
          "Performance is measured over the whole developmental interval, at trained and at unseen ages.",
        study:
          "Validation MSE at the trained budgets and at the unseen 37.5% and 75%, on a validation split no search reads.",
        fidelity: "analogue",
      },
      {
        paper:
          "Controls: the same optimiser run at the initial substrate only or the mature substrate only (five conditions in all).",
        study:
          "Controls: independent per-budget searches (including the unseen budgets, which is stronger than single-snapshot training) and a full-size search pruned by frozen-weight magnitude, all at an equal charged-record budget.",
        fidelity: "analogue",
      },
      {
        paper:
          "Five independent evolutionary runs per condition for each substrate-task pair, 200 generations each.",
        study:
          "20 seeds per arm, stopped by an equal charged-calibration-record budget rather than a generation count.",
        fidelity: "departs",
      },
      {
        paper:
          "Two substrates (Fish, Ring) and two closed-loop visuomotor tasks (optomotor response, phototaxis).",
        study: "One synthetic 4-input regression scored in-process.",
        fidelity: "departs",
      },
    ] as readonly PinnedMethodElement[],
  ),
  unpinned: Object.freeze(
    [
      "CPPN inputs beyond developmental time, its output activation and how connections are thresholded",
      "the population size and the NEAT settings of the CPPN search",
      "the fitness definitions for the optomotor and phototaxis tasks",
      "the exact ages evaluated as unseen",
    ] as readonly string[],
  ),
});

const CRITERIA =
  "Primary metric: per-seed mean validation MSE over the unseen budgets (37.5%, 75%). benefit iff the paired-bootstrap 95% CI of (conditioned - control) lies below 0, harm iff it lies above 0, insufficient-data when fewer than 5 paired seeds, otherwise no-benefit. Success iff benefit against both independent and pruned controls and the full-size (100%) validation MSE against pruned is not harm. Per-budget comparisons are exploratory.";

/** Run every arm at every seed and summarise. */
export function runStudy(options: StudyOptions = {}) {
  const settings: BudgetStudySettings = {
    ...DEFAULT_SETTINGS,
    ...options.settings,
    ...(options.budgetRecords === undefined
      ? {}
      : { budgetRecords: options.budgetRecords }),
    ...(options.populationSize === undefined ? {} : {
      mu: options.populationSize,
      lambda: options.populationSize,
    }),
  };
  validateSettings(settings);
  const base = options.baseSeed ?? VALIDATION_BASE_SEED;
  const seeds = Array.from(
    { length: options.seedCount ?? SEED_COUNT },
    (_, i) => base + i,
  );
  const corpus = buildStudyCorpus(
    CORPUS_SEED,
    settings.calibrationRecords,
    settings.validationRecords,
  );
  const failures: Failure[] = [];
  const runs: ArmSeedRun[] = [];
  for (const arm of ARM_NAMES) {
    for (const seed of seeds) {
      try {
        runs.push(runArmSeed(arm, seed, settings, corpus));
      } catch (error) {
        failures.push({
          arm,
          seed,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const runsOf = (arm: ArmName) => runs.filter((r) => r.arm === arm);
  const common = seeds.filter((s) =>
    ARM_NAMES.every((a) => runsOf(a).some((r) => r.seed === s))
  );
  const paired = (arm: ArmName) =>
    runsOf(arm).filter((r) => common.includes(r.seed));
  const at = (budget: number) => (r: ArmSeedRun) =>
    r.budgets.find((b) => b.budget === budget)!.validationMse;

  const vsIndependent = compare(
    paired("conditioned"),
    paired("independent"),
    unseenScore,
  );
  const vsPruned = compare(
    paired("conditioned"),
    paired("pruned"),
    unseenScore,
  );
  const fullSize = compare(paired("conditioned"), paired("pruned"), at(1));
  const perBudget = EVAL_BUDGETS.map((budget) => ({
    budget,
    vsIndependent: compare(
      paired("conditioned"),
      paired("independent"),
      at(budget),
    ),
    vsPruned: compare(paired("conditioned"), paired("pruned"), at(budget)),
  }));

  const perArmBudget = ARM_NAMES.flatMap((arm) =>
    EVAL_BUDGETS.map((budget) => {
      const rows = runsOf(arm).map((r) =>
        r.budgets.find((b) => b.budget === budget)!
      );
      const lat = rows.filter((r) => r.latencyMicros !== null).map((r) =>
        r.latencyMicros as number
      );
      const val = rows.map((r) => r.validationMse);
      return {
        arm,
        budget,
        n: rows.length,
        medianValidation: rows.length ? median(val) : null,
        upperQuartileValidation: rows.length ? quantile(val, 0.75) : null,
        medianEffectiveSynapses: rows.length
          ? median(rows.map((r) => r.effectiveSynapses))
          : null,
        meanExpressivity: rows.length
          ? rows.reduce((s, r) => s + r.expressivity, 0) / rows.length
          : null,
        invalid: rows.filter((r) => !r.valid).length,
        medianLatencyMicros: lat.length ? median(lat) : null,
      };
    })
  );

  return {
    manifest: {
      issue: 4161,
      codeVersion: options.codeVersion ?? "unknown",
      neatAiVersion: (denoConfig as { version: string }).version,
      denoVersion: Deno.version.deno,
      corpusSeed: CORPUS_SEED,
      settings,
      synapseCount: SYNAPSE_COUNT,
      trainingBudgets: TRAINING_BUDGETS,
      unseenBudgets: UNSEEN_BUDGETS,
      evalBudgets: EVAL_BUDGETS,
      budgetSynapses: EVAL_BUDGETS.map((b) => ({
        budget: b,
        synapses: budgetSynapses(b),
      })),
      seeds,
      bootstrap: { resamples: BOOTSTRAP_RESAMPLES, seed: BOOTSTRAP_SEED },
      criteria: CRITERIA,
      paper: SOURCE_METHOD,
      ockham:
        "Unlike NEAT-AI-Ockham's frozen-weight pruning, the expression order here is an evolved, heritable gene; the pruned control ranks a finished network's frozen weights by magnitude.",
    },
    runs,
    perArmBudget,
    primary: { vsIndependent, vsPruned },
    fullSize,
    perBudget,
    outcome: studyOutcome({ vsIndependent, vsPruned, fullSize }),
    coverage: {
      expectedRuns: seeds.length * ARM_NAMES.length,
      completedRuns: runs.length,
      failures,
    },
  };
}
