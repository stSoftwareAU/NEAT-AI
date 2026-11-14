/**
 * Short protected refinement for major topology mutations — Issue #4158.
 *
 * The question: when a mutation makes a *major* structural change (a new
 * hidden neuron, rewired synapses, a changed activation), the child usually
 * scores badly straight away because its new parts have not been tuned yet, so
 * selection culls it before it can show its worth. Does holding such a child in
 * a small protected pen for a few cheap refinement rounds, before it competes,
 * buy a better endpoint for the same number of records charged?
 *
 * The method here is this repository's reading of the issue. The paper the
 * issue cites (arXiv 2610.35647) could not be verified, so nothing below
 * claims to reproduce it.
 *
 * ## What is real and what is a stand-in
 *
 * Real: the creatures, the crossover ({@link Offspring.breed}), the mutation
 * operators ({@link Mutator}), speciation ({@link Genus}) and genetic distance
 * ({@link geneticCompatibility}).
 *
 * Stand-in: the **corpus** is the small deterministic synthetic regression from
 * `preSelectionAB`, scored in-process, and the **refinement** is a stochastic
 * hill climb on a strided sub-sample of the training records rather than
 * back-propagation. Cost is counted in **records charged**, which is what the
 * real corpus charges for. The holdout is measured once at the end, is never
 * charged, and never guides anything.
 *
 * What this measures is the **mechanism**; it cannot say how a 5,317-neuron
 * production creature behaves.
 *
 * A measurement harness, not a production code path: nothing under `src/`
 * imports it.
 *
 * @module protectedRefinementStudy
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Mutator } from "@neat/Mutator.ts";
import { Genus } from "@neat/Genus.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  type RandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import {
  type ABRecord,
  breedChildren,
  buildCorpus,
  DEFAULT_AB_SETTINGS,
  meanGeneticDistance,
  scoreCreature,
  seedPopulation,
} from "./preSelectionAB.ts";
import { median } from "./rankFidelity.ts";

/** First seed of the validation runs. */
export const VALIDATION_BASE_SEED = 4158;
/** Validation seeds run. */
export const VALIDATION_SEED_COUNT = 20;
/** First seed of the calibration runs — disjoint from validation. */
export const CALIBRATION_BASE_SEED = 94158;
/** Calibration seeds run per candidate refinement depth. */
export const CALIBRATION_SEED_COUNT = 4;
/** Seed of the synthetic corpus, shared by every run. */
export const CORPUS_SEED = 4158;
/** Bootstrap resamples behind every confidence interval. */
export const BOOTSTRAP_RESAMPLES = 10_000;
/** Seed of the bootstrap, so the interval is reproducible. */
export const BOOTSTRAP_SEED = 4158;
/** Refinement depths the calibration chooses between. */
export const CALIBRATION_REFINE_ROUNDS: readonly number[] = Object.freeze([
  2,
  3,
  4,
]);

/** The verdict criteria, declared before any run. */
export const VERDICT_CRITERIA = Object.freeze({
  benefit:
    "ci95.upper < 0 AND winFraction >= 0.6 AND speciesRatio >= 0.8 (difference is arm minus baseline holdout MSE; negative is better)",
  harm: "ci95.lower > 0",
  otherwise: "no-benefit",
  minWinFraction: 0.6,
  minSpeciesRatio: 0.8,
});

/** How one run is set up. Every field is explicit so a run is reproducible. */
export interface RefinementSettings {
  readonly populationSize: number;
  /** Records the run may charge in total. */
  readonly budgetRecords: number;
  readonly trainRecords: number;
  readonly holdoutRecords: number;
  /** A refinement score uses every nth training record. */
  readonly refineStride: number;
  /** Standard deviation of the Gaussian perturbation of a refinement round. */
  readonly refineSigma: number;
  /** Refinement rounds a protected or refined child receives. */
  readonly refineRounds: number;
  /** Children the pen holds at once. */
  readonly penCapacity: number;
  readonly mutationRate: number;
  readonly maxGenerations: number;
}

/** The settings the study declares. */
export const DEFAULT_REFINEMENT_SETTINGS: RefinementSettings = Object.freeze({
  populationSize: 20,
  budgetRecords: 120_000,
  trainRecords: 300,
  holdoutRecords: 300,
  refineStride: 10,
  refineSigma: 0.15,
  refineRounds: 3,
  penCapacity: 4,
  mutationRate: 0.5,
  maxGenerations: 2_000,
});

/**
 * Refuse settings that cannot make a meaningful run.
 *
 * @throws {Error} Naming the offending field.
 */
export function validateSettings(s: RefinementSettings): void {
  const positiveInt = (name: keyof RefinementSettings) => {
    const v = s[name];
    if (!Number.isInteger(v) || v < 1) {
      throw new Error(`settings.${name} must be a positive integer, got ${v}`);
    }
  };
  positiveInt("populationSize");
  positiveInt("budgetRecords");
  positiveInt("trainRecords");
  positiveInt("holdoutRecords");
  positiveInt("refineStride");
  positiveInt("penCapacity");
  positiveInt("maxGenerations");
  if (
    !Number.isInteger(s.refineRounds) || s.refineRounds < 1 ||
    s.refineRounds > 10
  ) {
    throw new Error(
      `settings.refineRounds must be an integer in 1..10, got ${s.refineRounds}`,
    );
  }
  if (!Number.isFinite(s.refineSigma) || s.refineSigma <= 0) {
    throw new Error(`settings.refineSigma must be > 0, got ${s.refineSigma}`);
  }
  if (!Number.isFinite(s.mutationRate) || s.mutationRate < 0) {
    throw new Error(
      `settings.mutationRate must be >= 0, got ${s.mutationRate}`,
    );
  }
  if (s.penCapacity >= s.populationSize) {
    throw new Error(
      `settings.penCapacity must be < populationSize (${s.populationSize}), got ${s.penCapacity}`,
    );
  }
  if (s.budgetRecords < s.populationSize * s.trainRecords) {
    throw new Error(
      `settings.budgetRecords must be >= populationSize * trainRecords (${
        s.populationSize * s.trainRecords
      }), got ${s.budgetRecords}`,
    );
  }
}

/** The train and holdout records of a study. */
export interface StudyCorpus {
  readonly train: readonly ABRecord[];
  readonly holdout: readonly ABRecord[];
}

/** Build the corpus: the first `trainRecords` train, the rest holdout. */
export function buildStudyCorpus(settings: RefinementSettings): StudyCorpus {
  const all = buildCorpus({
    ...DEFAULT_AB_SETTINGS,
    seed: CORPUS_SEED,
    corpusRecords: settings.trainRecords + settings.holdoutRecords,
  });
  return {
    train: all.slice(0, settings.trainRecords),
    holdout: all.slice(settings.trainRecords),
  };
}

/** What kind of change a mutation made. */
export interface MutationClass {
  readonly addNeuron: boolean;
  readonly rewiring: boolean;
  readonly activation: boolean;
  /** Any of the three. Weight and bias changes alone are not major. */
  readonly major: boolean;
}

/** Stable key for a neuron: its uuid, else its type and position. */
function neuronKeys(json: CreatureExport): Map<string, string | undefined> {
  const counts: Record<string, number> = {};
  const keys = new Map<string, string | undefined>();
  for (const neuron of json.neurons) {
    const n = counts[neuron.type] = (counts[neuron.type] ?? -1) + 1;
    keys.set(neuron.uuid ?? `${neuron.type}-${n}`, neuron.squash);
  }
  return keys;
}

/**
 * Classify the change a mutation made, from the pre-mutation snapshot and the
 * mutated creature.
 */
export function classifyMutation(
  before: CreatureExport,
  after: Creature | CreatureExport,
): MutationClass {
  const afterJson = "exportJSON" in after ? after.exportJSON() : after;
  const beforeHidden = new Set(
    before.neurons.filter((n) => n.type === "hidden").map((n) => n.uuid),
  );
  const addNeuron = afterJson.neurons.some((n) =>
    n.type === "hidden" && !beforeHidden.has(n.uuid)
  );
  const keyOf = (s: CreatureExport["synapses"][number]) =>
    `${s.fromUUID}|${s.toUUID}|${s.type ?? ""}`;
  const beforeSyn = new Set(before.synapses.map(keyOf));
  const afterSyn = new Set(afterJson.synapses.map(keyOf));
  let rewiring = beforeSyn.size !== afterSyn.size;
  if (!rewiring) {
    for (const k of afterSyn) {
      if (!beforeSyn.has(k)) {
        rewiring = true;
        break;
      }
    }
  }
  const beforeNeurons = neuronKeys(before);
  let activation = false;
  for (const [key, squash] of neuronKeys(afterJson)) {
    if (beforeNeurons.has(key) && beforeNeurons.get(key) !== squash) {
      activation = true;
      break;
    }
  }
  return {
    addNeuron,
    rewiring,
    activation,
    major: addNeuron || rewiring || activation,
  };
}

/** A standard normal draw by Box–Muller. */
function gaussian(rng: RandomNumberGenerator): number {
  const u1 = Math.max(rng.random(), 1e-12);
  const u2 = rng.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** What one refinement round produced. */
export interface RefineOutcome {
  /** The better of the input and its perturbed clone. Never the input mutated. */
  readonly creature: Creature;
  /** Records charged by the round. */
  readonly records: number;
  /** Score of {@link RefineOutcome.creature} on the subsample. */
  readonly score: number;
}

/**
 * One refinement round: perturb a clone's biases and weights, keep the better
 * on the subsample (ties keep the original).
 *
 * @param knownScore - The input's subsample score when already known, which
 *   saves re-scoring it.
 */
export function refineRound(
  creature: Creature,
  subsample: readonly ABRecord[],
  sigma: number,
  rng: RandomNumberGenerator,
  knownScore?: number,
): RefineOutcome {
  const clone = Creature.fromJSON(creature.exportJSON());
  for (const neuron of clone.neurons) {
    if (neuron.type === "input") continue;
    neuron.bias += gaussian(rng) * sigma;
  }
  for (const synapse of clone.synapses) {
    synapse.weight += gaussian(rng) * sigma;
  }
  // The clone's content changed, so shed the inherited identity and derive a
  // fresh one: a later round exports the clone and export needs a uuid.
  delete clone.uuid;
  CreatureUtil.makeUUID(clone);
  delete clone.score;
  let records = 0;
  let current = knownScore;
  if (current === undefined) {
    const scored = scoreCreature(creature, subsample);
    current = scored.score;
    records += scored.records;
  }
  const trial = scoreCreature(clone, subsample);
  records += trial.records;
  if (trial.score > current) {
    return { creature: clone, records, score: trial.score };
  }
  return { creature, records, score: current };
}

/** The arms of the study. */
export type RefinementArm =
  | "immediate"
  | "protect-refine"
  | "protect-only"
  | "refine-only"
  | "matched-ordinary";

/** Every arm, in report order. */
export const ARMS: readonly RefinementArm[] = Object.freeze([
  "immediate",
  "protect-refine",
  "protect-only",
  "refine-only",
  "matched-ordinary",
] as RefinementArm[]);

/** What one run produced. */
export interface RefinementRunResult {
  readonly arm: RefinementArm;
  readonly seed: number;
  readonly trainMse: number;
  readonly holdoutMse: number;
  readonly recordsCharged: number;
  readonly recordsByPhase: { evaluation: number; refinement: number };
  readonly generations: number;
  readonly wallMs: number;
  readonly majorProduced: number;
  readonly majorByKind: {
    addNeuron: number;
    rewiring: number;
    activation: number;
  };
  readonly majorCompeted: number;
  readonly majorRetained: number;
  readonly ordinaryCompeted: number;
  readonly ordinaryRetained: number;
  readonly penPeak: number;
  readonly speciesCount: number;
  readonly meanGeneticDistance: number;
  readonly championHiddenNeurons: number;
  readonly stalled: boolean;
}

interface Candidate {
  creature: Creature;
  major: boolean;
  subScore?: number;
}

interface PenEntry extends Candidate {
  age: number;
}

/**
 * Run one arm at one seed.
 *
 * Sets the global generator for the run and restores the caller's afterwards.
 */
export async function runArm(
  arm: RefinementArm,
  seed: number,
  settings: RefinementSettings,
  corpus: StudyCorpus,
): Promise<RefinementRunResult> {
  const rng = createSeededRng(seed);
  const previousRng = getRandomNumberGenerator();
  setRandomNumberGenerator(createSeededRng(seed));
  // New neurons take `crypto.randomUUID()`, and those uuids feed the creature
  // hash and the sort order the operators index into, so an unseeded uuid makes
  // two runs of one seed diverge. Seed them from a separate stream so the
  // run's own draws do not shift.
  const uuidRng = createSeededRng(seed + 0x5eed);
  const hadOwn = Object.prototype.hasOwnProperty.call(crypto, "randomUUID");
  const original = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    writable: true,
    value: () => seededUuid(uuidRng),
  });
  try {
    // `return await`: otherwise `finally` restores the caller's generator at
    // the first inner await and the run continues unseeded.
    return await Promise.resolve(runSeeded(arm, seed, settings, corpus, rng));
  } finally {
    if (hadOwn && original !== undefined) {
      Object.defineProperty(crypto, "randomUUID", original);
    } else {
      delete (crypto as unknown as Record<string, unknown>).randomUUID;
    }
    setRandomNumberGenerator(previousRng);
  }
}

/** An RFC 4122 version 4 shaped uuid drawn from a seeded generator. */
function seededUuid(rng: RandomNumberGenerator): string {
  const bytes = Array.from(
    { length: 16 },
    () => Math.floor(rng.random() * 256),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}

function runSeeded(
  arm: RefinementArm,
  seed: number,
  settings: RefinementSettings,
  corpus: StudyCorpus,
  rng: RandomNumberGenerator,
): RefinementRunResult {
  const startedMs = performance.now();
  // `createNeatConfig` installs a fresh unseeded global generator unless it is
  // given a seed, which would silently undo the seeding `runArm` just did.
  const config = createNeatConfig({
    seed,
    populationSize: settings.populationSize,
    elitism: 2,
    mutationRate: settings.mutationRate,
  });
  const mutator = new Mutator(config);
  const subsample = corpus.train.filter((_, i) =>
    i % settings.refineStride === 0
  );
  const protects = arm === "protect-refine" || arm === "protect-only";

  let evaluation = 0;
  let refinement = 0;
  const canAfford = (n: number) =>
    evaluation + refinement + n <= settings.budgetRecords;

  let population = seedPopulation(settings, rng);
  let pen: PenEntry[] = [];
  let majorProduced = 0;
  const majorByKind = { addNeuron: 0, rewiring: 0, activation: 0 };
  let majorCompeted = 0;
  let majorRetained = 0;
  let ordinaryCompeted = 0;
  let ordinaryRetained = 0;
  let penPeak = 0;
  let generations = 0;
  let stalled = false;
  let budgetHit = false;

  /** Up to `rounds` refinement rounds, each charged; stops when unaffordable. */
  const refine = (candidate: Candidate, rounds: number): Candidate => {
    let current = candidate;
    for (let r = 0; r < rounds; r++) {
      const cost = subsample.length * (current.subScore === undefined ? 2 : 1);
      if (!canAfford(cost)) break;
      const out = refineRound(
        current.creature,
        subsample,
        settings.refineSigma,
        rng,
        current.subScore,
      );
      refinement += out.records;
      current = {
        creature: out.creature,
        major: current.major,
        subScore: out.score,
      };
    }
    return current;
  };

  for (let generation = 1;; generation++) {
    if (generation > settings.maxGenerations) {
      stalled = true;
      break;
    }
    // 1. Score the unscored members of the population on the full train set.
    for (const creature of population) {
      if (creature.score !== undefined) continue;
      if (!canAfford(corpus.train.length)) {
        budgetHit = true;
        break;
      }
      const scored = scoreCreature(creature, corpus.train);
      creature.score = scored.score;
      evaluation += scored.records;
    }
    if (budgetHit) break;
    generations = generation;
    population.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    if (!canAfford(corpus.train.length)) break;

    // 2. Pen release.
    const competitors: Candidate[] = [];
    const stay: PenEntry[] = [];
    for (const entry of pen) {
      if (entry.age >= settings.refineRounds) {
        competitors.push({ creature: entry.creature, major: true });
      } else stay.push(entry);
    }
    pen = stay;

    // 3. Breed, snapshot, mutate, classify.
    const children = breedChildren(
      population,
      settings.populationSize - 2,
      config,
      rng,
    );
    const snapshots = children.map((child) => child.exportJSON());
    mutator.mutate(children);
    const candidates: Candidate[] = [];
    children.forEach((child, i) => {
      delete child.score;
      if (child.uuid === undefined) CreatureUtil.makeUUID(child);
      const kind = classifyMutation(snapshots[i], child);
      if (kind.major) {
        majorProduced++;
        if (kind.addNeuron) majorByKind.addNeuron++;
        if (kind.rewiring) majorByKind.rewiring++;
        if (kind.activation) majorByKind.activation++;
      }
      candidates.push({ creature: child, major: kind.major });
    });

    // 4. Treatment.
    const toPen: Candidate[] = [];
    if (arm === "immediate") {
      competitors.push(...candidates);
    } else if (protects) {
      for (const c of candidates) {
        if (c.major && pen.length + toPen.length < settings.penCapacity) {
          toPen.push(c);
        } else competitors.push(c);
      }
    } else if (arm === "refine-only") {
      let refined = 0;
      for (const c of candidates) {
        if (c.major && refined < settings.penCapacity) {
          refined++;
          competitors.push(refine(c, settings.refineRounds));
        } else competitors.push(c);
      }
    } else {
      const majors = candidates.filter((c) => c.major).length;
      let k = Math.min(majors, settings.penCapacity);
      for (const c of candidates) {
        if (!c.major && k > 0) {
          k--;
          competitors.push(refine(c, settings.refineRounds));
        } else competitors.push(c);
      }
    }

    // 5. Pen round for members already in the pen before this generation.
    pen = pen.map((entry) => {
      const aged = { ...entry, age: entry.age + 1 };
      if (arm !== "protect-refine") return aged;
      const refined = refine(entry, 1);
      return { ...refined, age: aged.age };
    });
    for (const c of toPen) pen.push({ ...c, age: 0 });
    penPeak = Math.max(penPeak, pen.length);

    // 6. Competition on the full train score.
    const scoredCompetitors: Candidate[] = [];
    for (const c of competitors) {
      if (!canAfford(corpus.train.length)) {
        budgetHit = true;
        break;
      }
      const scored = scoreCreature(c.creature, corpus.train);
      c.creature.score = scored.score;
      evaluation += scored.records;
      scoredCompetitors.push(c);
    }
    const pool = [...population, ...scoredCompetitors.map((c) => c.creature)];
    pool.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    population = pool.slice(0, settings.populationSize);
    const retained = new Set(population);

    // 7. Bookkeeping.
    for (const c of scoredCompetitors) {
      const kept = retained.has(c.creature);
      if (c.major) {
        majorCompeted++;
        if (kept) majorRetained++;
      } else {
        ordinaryCompeted++;
        if (kept) ordinaryRetained++;
      }
    }

    // 8. Stop on budget.
    if (budgetHit) break;
  }

  const scoredPopulation = population.filter((c) => c.score !== undefined);
  scoredPopulation.sort((a, b) =>
    (b.score ?? -Infinity) - (a.score ?? -Infinity)
  );
  const champion = scoredPopulation[0];
  const genus = new Genus();
  for (const creature of scoredPopulation) {
    if (!Number.isFinite(creature.score)) continue;
    genus.addCreature(creature);
  }
  return {
    arm,
    seed,
    trainMse: -(champion.score ?? -Infinity),
    holdoutMse: -scoreCreature(champion, corpus.holdout).score,
    recordsCharged: evaluation + refinement,
    recordsByPhase: { evaluation, refinement },
    generations,
    wallMs: performance.now() - startedMs,
    majorProduced,
    majorByKind,
    majorCompeted,
    majorRetained,
    ordinaryCompeted,
    ordinaryRetained,
    penPeak,
    speciesCount: genus.speciesMap.size,
    meanGeneticDistance: meanGeneticDistance(scoredPopulation),
    championHiddenNeurons: champion.neurons.filter((n) => n.type === "hidden")
      .length,
    stalled,
  };
}

/** A 95% interval. */
export interface ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
}

/** Paired bootstrap 95% interval of the mean difference. */
export function pairedBootstrapCi(
  diffs: readonly number[],
  resamples: number,
  seed: number,
): ConfidenceInterval {
  if (diffs.length === 0) {
    throw new Error("pairedBootstrapCi needs at least one difference");
  }
  const rng = createSeededRng(seed);
  const means: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let sum = 0;
    for (let i = 0; i < diffs.length; i++) {
      sum += diffs[Math.floor(rng.random() * diffs.length)];
    }
    means.push(sum / diffs.length);
  }
  means.sort((a, b) => a - b);
  const at = (q: number) =>
    means[Math.min(means.length - 1, Math.floor(q * means.length))];
  return { lower: at(0.025), upper: at(0.975) };
}

export type Verdict = "benefit" | "harm" | "no-benefit";

/** One arm compared with one baseline, paired by seed. */
export interface Comparison {
  readonly label: string;
  readonly n: number;
  /** Mean of arm minus baseline holdout MSE; negative is better. */
  readonly meanDiff: number;
  readonly ci95: ConfidenceInterval;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly winFraction: number;
  readonly speciesRatio: number;
  readonly retainedFractionArm: number | null;
  readonly retainedFractionBaseline: number | null;
  readonly verdict: Verdict;
}

/** Apply the predeclared criteria. Harm is checked first. */
export function verdict(
  c: Pick<Comparison, "ci95" | "winFraction" | "speciesRatio">,
): Verdict {
  if (c.ci95.lower > 0) return "harm";
  if (
    c.ci95.upper < 0 &&
    c.winFraction >= VERDICT_CRITERIA.minWinFraction &&
    c.speciesRatio >= VERDICT_CRITERIA.minSpeciesRatio
  ) return "benefit";
  return "no-benefit";
}

const mean = (xs: readonly number[]) =>
  xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

function retainedFraction(rs: readonly RefinementRunResult[]): number | null {
  const competed = rs.reduce((a, r) => a + r.majorCompeted, 0);
  if (competed === 0) return null;
  return rs.reduce((a, r) => a + r.majorRetained, 0) / competed;
}

/** Compare an arm with a baseline, pairing by seed on holdout MSE. */
export function pairedComparison(
  armResults: readonly RefinementRunResult[],
  baselineResults: readonly RefinementRunResult[],
  label: string,
): Comparison {
  const baseBySeed = new Map(baselineResults.map((r) => [r.seed, r]));
  const arms: RefinementRunResult[] = [];
  const bases: RefinementRunResult[] = [];
  for (const r of armResults) {
    const b = baseBySeed.get(r.seed);
    if (b === undefined) continue;
    arms.push(r);
    bases.push(b);
  }
  const diffs = arms.map((r, i) => r.holdoutMse - bases[i].holdoutMse);
  const wins = diffs.filter((d) => d < 0).length;
  const losses = diffs.filter((d) => d > 0).length;
  const n = diffs.length;
  const ci95 = n === 0
    ? { lower: Number.NaN, upper: Number.NaN }
    : pairedBootstrapCi(diffs, BOOTSTRAP_RESAMPLES, BOOTSTRAP_SEED);
  const partial = {
    ci95,
    winFraction: n === 0 ? Number.NaN : wins / n,
    speciesRatio: mean(arms.map((r) => r.speciesCount)) /
      mean(bases.map((r) => r.speciesCount)),
  };
  return {
    label,
    n,
    meanDiff: mean(diffs),
    ci95,
    wins,
    losses,
    ties: n - wins - losses,
    winFraction: partial.winFraction,
    speciesRatio: partial.speciesRatio,
    retainedFractionArm: retainedFraction(arms),
    retainedFractionBaseline: retainedFraction(bases),
    verdict: verdict(partial),
  };
}

/** One row of the calibration table. */
export interface CalibrationRow {
  readonly refineRounds: number;
  readonly medianTrainMse: number;
  readonly recordsSpent: number;
  readonly runs: number;
}

/**
 * The refinement depth with the lowest median TRAIN MSE; ties go to the first
 * listed. The holdout is never consulted.
 */
export function chooseRefineRounds(
  table: readonly Pick<CalibrationRow, "refineRounds" | "medianTrainMse">[],
): number {
  let best: number | undefined;
  let bestMse = Infinity;
  for (const row of table) {
    if (!Number.isFinite(row.medianTrainMse)) continue;
    if (best === undefined || row.medianTrainMse < bestMse) {
      best = row.refineRounds;
      bestMse = row.medianTrainMse;
    }
  }
  if (best === undefined) {
    throw new Error("chooseRefineRounds: no calibration row has a finite MSE");
  }
  return best;
}

/** A run that threw. */
export interface RunFailure {
  readonly arm: RefinementArm;
  readonly seed: number;
  readonly message: string;
}

/** Options of {@link runStudy}. */
export interface StudyOptions {
  readonly settings?: Partial<RefinementSettings>;
  readonly validationSeeds?: number;
  readonly validationBaseSeed?: number;
  readonly calibrationSeeds?: number;
  readonly codeVersion: string;
  readonly onProgress?: (line: string) => void;
}

/** Everything the study reports; JSON-serialisable. */
export interface StudyReport {
  readonly manifest: Record<string, unknown>;
  readonly calibrationTable: readonly CalibrationRow[];
  readonly chosenRefineRounds: number | null;
  readonly calibrationRecords: number;
  readonly results: readonly RefinementRunResult[];
  readonly comparisons: readonly Comparison[];
  readonly coverage: Record<string, { completed: number; planned: number }>;
  readonly failures: readonly RunFailure[];
}

/** Calibrate the refinement depth on train MSE, then validate every arm. */
export async function runStudy(options: StudyOptions): Promise<StudyReport> {
  const settings: RefinementSettings = {
    ...DEFAULT_REFINEMENT_SETTINGS,
    ...options.settings,
  };
  validateSettings(settings);
  const validationSeeds = options.validationSeeds ?? VALIDATION_SEED_COUNT;
  const validationBase = options.validationBaseSeed ?? VALIDATION_BASE_SEED;
  const calibrationSeeds = options.calibrationSeeds ?? CALIBRATION_SEED_COUNT;
  const say = options.onProgress ?? (() => {});
  const corpus = buildStudyCorpus(settings);
  const failures: RunFailure[] = [];

  const attempt = async (
    arm: RefinementArm,
    seed: number,
    s: RefinementSettings,
  ): Promise<RefinementRunResult | undefined> => {
    try {
      // Runs are sequential: each seeds the global generator.
      return await runArm(arm, seed, s, corpus);
    } catch (error) {
      failures.push({
        arm,
        seed,
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  };

  const calibrationTable: CalibrationRow[] = [];
  let calibrationRecords = 0;
  for (const rounds of CALIBRATION_REFINE_ROUNDS) {
    const runs: RefinementRunResult[] = [];
    for (let i = 0; i < calibrationSeeds; i++) {
      // deno-lint-ignore no-await-in-loop
      const r = await attempt(
        "protect-refine",
        CALIBRATION_BASE_SEED + i,
        { ...settings, refineRounds: rounds },
      );
      if (r !== undefined) runs.push(r);
    }
    const spent = runs.reduce((a, r) => a + r.recordsCharged, 0);
    calibrationRecords += spent;
    calibrationTable.push({
      refineRounds: rounds,
      medianTrainMse: runs.length === 0
        ? Number.NaN
        : median(runs.map((r) => r.trainMse)),
      recordsSpent: spent,
      runs: runs.length,
    });
    say(`calibration R=${rounds}: ${runs.length}/${calibrationSeeds} runs`);
  }
  let chosen: number | null = null;
  try {
    chosen = chooseRefineRounds(calibrationTable);
  } catch (error) {
    failures.push({
      arm: "protect-refine",
      seed: CALIBRATION_BASE_SEED,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const results: RefinementRunResult[] = [];
  if (chosen !== null) {
    const chosenSettings = { ...settings, refineRounds: chosen };
    for (let i = 0; i < validationSeeds; i++) {
      for (const arm of ARMS) {
        // deno-lint-ignore no-await-in-loop
        const r = await attempt(arm, validationBase + i, chosenSettings);
        if (r !== undefined) results.push(r);
      }
      say(`validation seed ${validationBase + i} done`);
    }
  }

  const of = (arm: RefinementArm) => results.filter((r) => r.arm === arm);
  const primary = of("protect-refine");
  const comparisons = chosen === null ? [] : [
    pairedComparison(primary, of("immediate"), "protect-refine vs immediate"),
    pairedComparison(
      primary,
      of("matched-ordinary"),
      "protect-refine vs matched-ordinary",
    ),
    pairedComparison(
      primary,
      of("refine-only"),
      "protect-refine vs refine-only",
    ),
    pairedComparison(
      primary,
      of("protect-only"),
      "protect-refine vs protect-only",
    ),
  ];
  const coverage: Record<string, { completed: number; planned: number }> = {};
  for (const arm of ARMS) {
    coverage[arm] = { completed: of(arm).length, planned: validationSeeds };
  }

  const denoJson = JSON.parse(
    await Deno.readTextFile(new URL("../../deno.json", import.meta.url)),
  );
  return {
    manifest: {
      codeVersion: options.codeVersion,
      neatAiVersion: denoJson.version,
      deno: Deno.version.deno,
      corpusSeed: CORPUS_SEED,
      validationSeeds: { base: validationBase, count: validationSeeds },
      calibrationSeeds: {
        base: CALIBRATION_BASE_SEED,
        count: calibrationSeeds,
      },
      calibrationRefineRounds: CALIBRATION_REFINE_ROUNDS,
      bootstrap: { resamples: BOOTSTRAP_RESAMPLES, seed: BOOTSTRAP_SEED },
      settings,
      criteria: VERDICT_CRITERIA,
      arms: ARMS,
      note:
        "arXiv 2610.35647 could not be verified; the method is this repository's reading of Issue #4158, measured on a synthetic regression corpus with cost counted in records charged.",
    },
    calibrationTable,
    chosenRefineRounds: chosen,
    calibrationRecords,
    results,
    comparisons,
    coverage,
    failures,
  };
}
