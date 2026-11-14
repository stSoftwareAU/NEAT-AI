/**
 * Lineage-informed targeted offspring versus ordinary mutation — Issue #4155.
 *
 * An opt-in research harness. It asks one question: does remembering what each
 * mutation operator did to a parent's error (the lineage), and aiming a
 * candidate screen at the parent's worst stratum, buy a better held-out
 * endpoint for the same evaluation budget than ordinary mutation?
 *
 * Nothing under `src/` imports this and no production behaviour changes.
 *
 * ## What is real and what is a stand-in
 *
 * Real: the creatures, the {@link Mutator} operators and its repair step, the
 * genetic distance and the {@link Genus} speciation.
 *
 * Stand-ins: the corpus is a small synthetic regression split into train,
 * calibration and holdout, scored in-process by activating the creature, and
 * its "strata" are the four quadrants of the two inputs. Cost is counted in
 * records scored, the unit a production corpus charges in. The harness cannot
 * say how a production-scale creature behaves; it measures the **mechanism**.
 *
 * ## Leakage policy
 *
 * Selection reads the train split. Lineage history and targeting read the
 * calibration split. The holdout split is evaluated for reporting only, on the
 * best-by-train creature after selection, and is never charged to the budget
 * and never read by any mutation, selection or targeting decision.
 *
 * @module lineageTargetingStudy
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
import { meanGeneticDistance, seedPopulation } from "./preSelectionAB.ts";
import { median as strictMedian } from "./rankFidelity.ts";

/** Median of a set; `NaN` for an empty one (the strict helper throws). */
export function median(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : strictMedian(values);
}

/** Mean of a set; `NaN` for an empty one. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Strata in the corpus: the quadrants of the two inputs. */
export const STRATUM_COUNT = 4;

/** The three disjoint corpus splits. */
export type Split = "train" | "calibration" | "holdout";

/** One corpus record. */
export interface StudyRecord {
  readonly input: Float32Array;
  readonly target: number;
  /** Quadrant of the inputs `(a, b)`: `(a >= 0 ? 1 : 0) + (b >= 0 ? 2 : 0)`. */
  readonly stratum: number;
}

/** How one run is set up. */
export interface StudySettings {
  readonly seed: number;
  /** Records in each of the three splits. */
  readonly recordsPerSplit: number;
  readonly populationSize: number;
  readonly elitism: number;
  /** R: ordinary candidates screened per targeted offspring. */
  readonly candidatesPerTarget: number;
  /** K: operators sampled when history chooses one. */
  readonly historyProposals: number;
  /** Probability, in `[0, 1]`, of ignoring history and taking the first sample. */
  readonly historyExploration: number;
  /** Budget in exact-evaluation equivalents (train + calibration records). */
  readonly evaluationBudget: number;
  /** The held-out target is this fraction of generation 1's holdout MSE. */
  readonly targetHoldoutFraction: number;
}

/**
 * The sample size fixed in advance for the representative run: the number of
 * seeds the verdict is read from. The CLI defaults `--seeds` to this.
 */
export const PREDECLARED_SEEDS = 30;

export const DEFAULT_STUDY_SETTINGS: StudySettings = Object.freeze({
  seed: 4155,
  recordsPerSplit: 400,
  populationSize: 16,
  elitism: 2,
  candidatesPerTarget: 3,
  historyProposals: 4,
  historyExploration: 0.25,
  evaluationBudget: 400,
  targetHoldoutFraction: 0.5,
});

/** Throw a descriptive error when settings cannot describe a valid run. */
export function validateSettings(settings: StudySettings): void {
  const positiveInt = (name: keyof StudySettings) => {
    const v = settings[name];
    if (!Number.isInteger(v) || v <= 0) {
      throw new Error(`${name} must be a positive integer, got ${v}`);
    }
  };
  positiveInt("recordsPerSplit");
  positiveInt("populationSize");
  positiveInt("evaluationBudget");
  const { elitism, populationSize } = settings;
  if (!Number.isInteger(elitism) || elitism < 0 || elitism >= populationSize) {
    throw new Error(
      `elitism must be an integer in [0, populationSize), got ${elitism}`,
    );
  }
  if (
    !Number.isInteger(settings.candidatesPerTarget) ||
    settings.candidatesPerTarget < 1
  ) {
    throw new Error(
      `candidatesPerTarget must be an integer >= 1, got ${settings.candidatesPerTarget}`,
    );
  }
  if (
    !Number.isInteger(settings.historyProposals) ||
    settings.historyProposals < 1
  ) {
    throw new Error(
      `historyProposals must be an integer >= 1, got ${settings.historyProposals}`,
    );
  }
  const x = settings.historyExploration;
  if (!(x >= 0 && x <= 1)) {
    throw new Error(`historyExploration must be in [0, 1], got ${x}`);
  }
  const f = settings.targetHoldoutFraction;
  if (!(f > 0 && f <= 1)) {
    throw new Error(`targetHoldoutFraction must be in (0, 1], got ${f}`);
  }
}

/**
 * Build the three disjoint splits.
 *
 * Each split has its own seeded stream, so changing one split's size never
 * moves another's records. Records cycle through the strata so every split
 * holds every stratum.
 */
export function buildStratifiedCorpus(
  settings: Pick<StudySettings, "seed" | "recordsPerSplit">,
): Record<Split, StudyRecord[]> {
  const splits: Split[] = ["train", "calibration", "holdout"];
  const corpus = {} as Record<Split, StudyRecord[]>;
  splits.forEach((split, index) => {
    const rng = createSeededRng(settings.seed * 3 + index);
    const records: StudyRecord[] = [];
    for (let r = 0; r < settings.recordsPerSplit; r++) {
      const stratum = r % STRATUM_COUNT;
      // Magnitude from the stream, sign from the wanted stratum.
      const a = Math.abs(rng.random() * 2 - 1) * ((stratum & 1) ? 1 : -1);
      const b = Math.abs(rng.random() * 2 - 1) * ((stratum & 2) ? 1 : -1);
      const noise = (rng.random() - 0.5) * 0.05;
      records.push({
        input: new Float32Array([a, b]),
        target: 0.6 * Math.tanh(1.5 * a) - 0.35 * b * b +
          0.25 * Math.sin(3 * a * b) + noise,
        stratum: (a >= 0 ? 1 : 0) + (b >= 0 ? 2 : 0),
      });
    }
    corpus[split] = records;
  });
  return corpus;
}

/** Mean squared error per stratum and overall. */
export interface StratumErrors {
  /** MSE per stratum; `NaN` for a stratum that was not scored. */
  readonly perStratum: number[];
  /** MSE over every scored record. */
  readonly overall: number;
  /** Records scored — the cost. */
  readonly records: number;
}

/**
 * Score a creature over a split.
 *
 * @param onlyStratum - When given, only that stratum's records are scored.
 */
export function stratumErrors(
  creature: Creature,
  records: readonly StudyRecord[],
  onlyStratum?: number,
): StratumErrors {
  const sums = new Array<number>(STRATUM_COUNT).fill(0);
  const counts = new Array<number>(STRATUM_COUNT).fill(0);
  let total = 0;
  let count = 0;
  for (const record of records) {
    if (onlyStratum !== undefined && record.stratum !== onlyStratum) continue;
    const delta = creature.activate(record.input, false)[0] - record.target;
    const squared = delta * delta;
    sums[record.stratum] += squared;
    counts[record.stratum]++;
    total += squared;
    count++;
  }
  const finite = (value: number) => Number.isFinite(value) ? value : Infinity;
  return {
    perStratum: sums.map((sum, s) =>
      counts[s] === 0 ? Number.NaN : finite(sum / counts[s])
    ),
    overall: count === 0 ? Number.NaN : finite(total / count),
    records: count,
  };
}

/**
 * How many calibration records form the behavioural-diversity probe.
 *
 * Diversity is measured on a fixed prefix of the calibration split so every
 * generation and every arm is compared on the same inputs. The probe's
 * activations are measurement only: they are counted in `diagnosticRecords`,
 * never charged to `recordsScored`, and never read by selection, mutation or
 * targeting.
 */
export const DIVERSITY_PROBE_RECORDS = 64;

/**
 * Behavioural diversity of a population: the mean, over all unordered pairs of
 * creatures, of the root-mean-square difference of their first output across
 * the probe records.
 *
 * Offspring are mutation-only clones, so hidden-neuron UUIDs are shared by
 * every descendant of a founder and UUID-based genetic distance collapses to
 * zero within a few generations. Behaviour does not. Each creature's output
 * vector is computed once. A pair with a non-finite output has an infinite RMS
 * and is skipped; with no finite pair (or fewer than two creatures) the result
 * is 0.
 */
export function behaviouralDiversity(
  population: readonly Creature[],
  probe: readonly StudyRecord[],
): number {
  if (population.length < 2 || probe.length === 0) return 0;
  const outputs = population.map((creature) =>
    probe.map((record) => creature.activate(record.input, false)[0])
  );
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      let squared = 0;
      for (let k = 0; k < probe.length; k++) {
        const delta = outputs[i][k] - outputs[j][k];
        squared += delta * delta;
      }
      const rms = Math.sqrt(squared / probe.length);
      if (!Number.isFinite(rms)) continue;
      sum += rms;
      pairs++;
    }
  }
  return pairs === 0 ? 0 : sum / pairs;
}

/** The most gene keys {@link affectedGenes} lists, to keep reports small. */
export const AFFECTED_GENES_CAP = 16;

/**
 * Which genes a child differs from its parent in, by UUID identity only.
 *
 * Neurons are `n:<uuid>` (bias and squash); synapses are
 * `s:<fromUUID>><toUUID>:<type>` (weight). `genes` lists at most
 * {@link AFFECTED_GENES_CAP} keys; the counts are always exact.
 */
export function affectedGenes(
  parent: CreatureExport,
  child: CreatureExport,
): { added: number; removed: number; changed: number; genes: string[] } {
  const index = (creature: CreatureExport): Map<string, string> => {
    const genes = new Map<string, string>();
    for (const neuron of creature.neurons) {
      if (neuron.uuid === undefined) continue;
      genes.set(`n:${neuron.uuid}`, `${neuron.bias}|${neuron.squash ?? ""}`);
    }
    for (const synapse of creature.synapses) {
      if (synapse.fromUUID === undefined || synapse.toUUID === undefined) {
        continue;
      }
      genes.set(
        `s:${synapse.fromUUID}>${synapse.toUUID}:${synapse.type ?? ""}`,
        `${synapse.weight}`,
      );
    }
    return genes;
  };
  const before = index(parent);
  const after = index(child);
  let added = 0;
  let removed = 0;
  let changed = 0;
  const genes: string[] = [];
  const note = (key: string) => {
    if (genes.length < AFFECTED_GENES_CAP) genes.push(key);
  };
  for (const [key, value] of after) {
    const old = before.get(key);
    if (old === undefined) {
      added++;
      note(key);
    } else if (old !== value) {
      changed++;
      note(key);
    }
  }
  for (const key of before.keys()) {
    if (!after.has(key)) {
      removed++;
      note(key);
    }
  }
  return { added, removed, changed, genes };
}

/** One parent-to-child step, with what it did to the error. */
export interface LineageEdge {
  generation: number;
  /** Parent creature UUID. */
  parent: string;
  /** Child creature UUID. */
  child: string;
  kind: "ordinary" | "targeted";
  operator: string;
  /** The operator really changed the creature and repair succeeded. */
  changed: boolean;
  /** Exact counts, plus at most {@link AFFECTED_GENES_CAP} gene keys. */
  affected: {
    added: number;
    removed: number;
    changed: number;
    genes: string[];
  };
  targetStratum: number | null;
  /** The parent's calibration MSE per stratum — what targeting read. */
  parentCalibration: number[];
  /** Child minus parent, calibration split, per stratum. */
  calibrationDelta: number[];
  /** Child minus parent, calibration split, overall. */
  overallDelta: number;
  /** Child minus parent, train split. */
  trainDelta: number;
}

/** What each operator has done to calibration error, from lineage edges only. */
export class OperatorHistory {
  readonly #edges = new Map<string, LineageEdge[]>();

  record(edge: LineageEdge): void {
    const list = this.#edges.get(edge.operator);
    if (list === undefined) this.#edges.set(edge.operator, [edge]);
    else list.push(edge);
  }

  /**
   * Mean calibration delta for an operator: over the whole split when
   * `stratum` is `null`, otherwise for that stratum. Non-finite deltas are
   * ignored. `undefined` when there is nothing to average.
   */
  meanDelta(operator: string, stratum: number | null): number | undefined {
    const list = this.#edges.get(operator);
    if (list === undefined) return undefined;
    let sum = 0;
    let count = 0;
    for (const edge of list) {
      const value = stratum === null
        ? edge.overallDelta
        : edge.calibrationDelta[stratum];
      if (value === undefined || !Number.isFinite(value)) continue;
      sum += value;
      count++;
    }
    return count === 0 ? undefined : sum / count;
  }

  /** Edges recorded for an operator. */
  samples(operator: string): number {
    return this.#edges.get(operator)?.length ?? 0;
  }
}

export type ArmName = "ordinary" | "history" | "targeted" | "history-targeted";

export const ARMS: readonly ArmName[] = [
  "ordinary",
  "history",
  "targeted",
  "history-targeted",
];

/** The two factors an arm switches on. */
export function armFactors(
  arm: ArmName,
): { history: boolean; targeting: boolean } {
  return {
    history: arm === "history" || arm === "history-targeted",
    targeting: arm === "targeted" || arm === "history-targeted",
  };
}

/** Everything offspring creation needs. */
export interface BreedContext {
  readonly mutator: Mutator;
  readonly history: OperatorHistory;
  readonly settings: StudySettings;
  /** The calibration split — the only data targeting may read. */
  readonly calibration: readonly StudyRecord[];
  /** Records charged to candidate screening so far. */
  screenRecords: number;
}

/** A context for {@link breedPair}. */
export function createBreedContext(
  settings: StudySettings,
  calibration: readonly StudyRecord[],
  history: OperatorHistory = new OperatorHistory(),
): BreedContext {
  const mutator = new Mutator(createNeatConfig({
    populationSize: settings.populationSize,
    elitism: settings.elitism,
    mutationRate: 1,
  }));
  return { mutator, history, settings, calibration, screenRecords: 0 };
}

/** A parent's measured errors. */
export interface ParentErrors {
  readonly train: StratumErrors;
  readonly calibration: StratumErrors;
}

/** An offspring and the lineage edge describing it (deltas filled in later). */
export interface Bred {
  child: Creature;
  edge: LineageEdge;
}

function cloneOf(parent: Creature): Creature {
  const child = Creature.fromJSON(parent.exportJSON());
  delete child.score;
  return child;
}

/** Pick an operator for `clone`, by history or at random. */
function chooseMethod(
  ctx: BreedContext,
  clone: Creature,
  useHistory: boolean,
  stratum: number | null,
): { name: string } {
  const first = ctx.mutator.selectMutationMethod(clone);
  if (!useHistory) return first;
  const sampled = [first];
  for (let k = 1; k < ctx.settings.historyProposals; k++) {
    sampled.push(ctx.mutator.selectMutationMethod(clone));
  }
  // Always draw, so the stream does not depend on what history holds.
  const explore = getRandomNumberGenerator().random() <
    ctx.settings.historyExploration;
  if (explore) return first;
  let best: { name: string } | undefined;
  let bestDelta = Infinity;
  for (const method of sampled) {
    const delta = ctx.history.meanDelta(method.name, stratum);
    if (delta !== undefined && delta < bestDelta) {
      best = method;
      bestDelta = delta;
    }
  }
  return best ?? first;
}

/** One mutation on a fresh clone of the parent; the parent is never touched. */
function mutateClone(
  ctx: BreedContext,
  parent: Creature,
  useHistory: boolean,
  stratum: number | null,
): { child: Creature; operator: string; changed: boolean } {
  let child = cloneOf(parent);
  const method = chooseMethod(ctx, child, useHistory, stratum);
  let changed = ctx.mutator.mutateCreature(child, method);
  if (changed && !ctx.mutator.repairAfterMutation(child)) {
    child = cloneOf(parent);
    changed = false;
  }
  delete child.score;
  CreatureUtil.makeUUID(child);
  return { child, operator: method.name, changed };
}

function argMax(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    const b = values[best];
    if (Number.isNaN(b) || v > b) best = i;
  }
  return best;
}

/**
 * Produce offspring from one parent: the first is always ordinary, the second
 * is the arm's treatment. The parent is never modified.
 *
 * @param count - 1 or 2 offspring wanted.
 */
export function breedPair(
  arm: ArmName,
  parent: Creature,
  parentErrors: ParentErrors,
  ctx: BreedContext,
  generation: number,
  count: 1 | 2 = 2,
): Bred[] {
  const factors = armFactors(arm);
  const parentExport = parent.exportJSON();
  const parentUuid = CreatureUtil.makeUUID(parent);
  const parentCalibration = [...parentErrors.calibration.perStratum];
  const out: Bred[] = [];

  const wrap = (
    made: { child: Creature; operator: string; changed: boolean },
    kind: "ordinary" | "targeted",
    targetStratum: number | null,
  ): Bred => ({
    child: made.child,
    edge: {
      generation,
      parent: parentUuid,
      child: made.child.uuid ?? CreatureUtil.makeUUID(made.child),
      kind,
      operator: made.operator,
      changed: made.changed,
      affected: made.changed
        ? affectedGenes(parentExport, made.child.exportJSON())
        : { added: 0, removed: 0, changed: 0, genes: [] },
      targetStratum,
      parentCalibration,
      calibrationDelta: [],
      overallDelta: Number.NaN,
      trainDelta: Number.NaN,
    },
  });

  out.push(wrap(mutateClone(ctx, parent, false, null), "ordinary", null));
  if (count < 2) return out;

  if (!factors.targeting) {
    out.push(
      wrap(mutateClone(ctx, parent, factors.history, null), "ordinary", null),
    );
    return out;
  }

  const stratum = argMax(parentCalibration);
  let best: ReturnType<typeof mutateClone> | undefined;
  let bestError = Infinity;
  for (let r = 0; r < ctx.settings.candidatesPerTarget; r++) {
    const candidate = mutateClone(ctx, parent, factors.history, stratum);
    const screened = stratumErrors(candidate.child, ctx.calibration, stratum);
    ctx.screenRecords += screened.records;
    if (best === undefined || screened.overall < bestError) {
      best = candidate;
      bestError = screened.overall;
    }
  }
  if (best === undefined) {
    throw new Error("candidatesPerTarget must be at least 1");
  }
  out.push(wrap(best, "targeted", stratum));
  return out;
}

/** One generation's trace. */
export interface GenerationTrace {
  generation: number;
  recordsScored: number;
  evaluations: number;
  bestTrainMse: number;
  bestHoldoutMse: number;
  meanGeneticDistance: number;
  speciesCount: number;
  /** Mean pairwise output RMS difference of the population just evaluated. */
  behaviouralDiversity: number;
  /** Indicative only: wall-clock is not comparable across machines. */
  wallMs: number;
}

/** What one arm produced for one seed. */
export interface ArmResult {
  arm: ArmName;
  factors: { history: boolean; targeting: boolean };
  seed: number;
  finalTrainMse: number;
  finalHoldoutMse: number;
  evaluations: number;
  /** Train + calibration records plus screening; excludes holdout. */
  recordsScored: number;
  screenRecords: number;
  /** Reporting-only holdout records; not charged to the budget. */
  holdoutRecords: number;
  /** Diversity-probe activations; measurement only, not charged to the budget. */
  diagnosticRecords: number;
  target: number;
  toTarget: {
    recordsScored: number;
    evaluations: number;
    generation: number;
    wallMs: number;
  } | null;
  failures: number;
  repeatedFailures: number;
  noChange: number;
  offspring: number;
  targetedOffspring: number;
  finalMeanGeneticDistance: number;
  finalSpeciesCount: number;
  /**
   * Mean of the per-generation behavioural diversity over generations 2 and
   * later (generation 1 is the identical seeded population in every arm and
   * would dominate the average); `NaN` when the run has none.
   */
  meanBehaviouralDiversity: number;
  finalBehaviouralDiversity: number;
  generations: GenerationTrace[];
  edges: LineageEdge[];
}

interface Evaluated {
  train: StratumErrors;
  calibration: StratumErrors;
}

interface Pending {
  edge: LineageEdge;
  child: Creature;
  parentEval: Evaluated;
}

/**
 * Run one arm for one seed.
 *
 * Seeds the global generator (the mutation operators draw from it) and
 * restores the caller's in `finally`.
 */
export function runArm(
  arm: ArmName,
  settings: StudySettings,
  corpus: Record<Split, StudyRecord[]>,
): ArmResult {
  validateSettings(settings);
  // `createNeatConfig` installs its own generator, so the caller's generator is
  // captured *first* and restored in `finally` even if building the context
  // throws. The context is built *before* seeding: otherwise the same seed
  // gives a different search on every run.
  const previousRng = getRandomNumberGenerator();
  try {
    const history = new OperatorHistory();
    const ctx = createBreedContext(settings, corpus.calibration, history);
    setRandomNumberGenerator(createSeededRng(settings.seed));
    return runSeededArm(arm, settings, corpus, history, ctx);
  } finally {
    setRandomNumberGenerator(previousRng);
  }
}

function runSeededArm(
  arm: ArmName,
  settings: StudySettings,
  corpus: Record<Split, StudyRecord[]>,
  history: OperatorHistory,
  ctx: BreedContext,
): ArmResult {
  const startedMs = performance.now();
  const rng: RandomNumberGenerator = createSeededRng(settings.seed);
  const limit = settings.evaluationBudget * 2 * settings.recordsPerSplit;

  const evaluated = new Map<Creature, Evaluated>();
  const edges: LineageEdge[] = [];
  const generations: GenerationTrace[] = [];
  let pending: Pending[] = [];
  const failedPairs = new Set<string>();
  let population = seedPopulation(settings, rng);
  let evalRecords = 0;
  let evaluations = 0;
  let holdoutRecords = 0;
  let diagnosticRecords = 0;
  const probe = corpus.calibration.slice(0, DIVERSITY_PROBE_RECORDS);
  let failures = 0;
  let repeatedFailures = 0;
  let noChange = 0;
  let offspring = 0;
  let targetedOffspring = 0;
  let target = Number.NaN;
  let toTarget: ArmResult["toTarget"] = null;
  let finalTrainMse: number;
  let finalHoldoutMse: number;
  let finalDistance = 0;
  let finalSpecies = 0;

  for (let generation = 1;; generation++) {
    // 1. Exact evaluation: train + calibration. Holdout is not in here.
    for (const creature of population) {
      if (evaluated.has(creature)) continue;
      const train = stratumErrors(creature, corpus.train);
      const calibration = stratumErrors(creature, corpus.calibration);
      evaluated.set(creature, { train, calibration });
      creature.score = -train.overall;
      evalRecords += train.records + calibration.records;
      evaluations++;
    }

    // 2. Child-side deltas for last generation's offspring.
    for (const item of pending) {
      const now = evaluated.get(item.child);
      if (now === undefined) continue;
      const edge = item.edge;
      edge.calibrationDelta = now.calibration.perStratum.map((v, s) =>
        v - item.parentEval.calibration.perStratum[s]
      );
      edge.overallDelta = now.calibration.overall -
        item.parentEval.calibration.overall;
      edge.trainDelta = now.train.overall - item.parentEval.train.overall;
      history.record(edge);
      edges.push(edge);
      offspring++;
      if (edge.kind === "targeted") targetedOffspring++;
      if (!edge.changed) noChange++;
      if (!edge.changed || now.train.overall > item.parentEval.train.overall) {
        failures++;
        const key = `${edge.parent}|${edge.operator}`;
        if (failedPairs.has(key)) repeatedFailures++;
        else failedPairs.add(key);
      }
    }
    pending = [];

    // 3. Rank by train score only.
    population.sort((a, b) =>
      (evaluated.get(b)!.train.overall === evaluated.get(a)!.train.overall)
        ? 0
        : evaluated.get(a)!.train.overall - evaluated.get(b)!.train.overall
    );
    const best = population[0];
    finalTrainMse = evaluated.get(best)!.train.overall;

    // 4. Reporting only: holdout of the best-by-train creature.
    const holdout = stratumErrors(best, corpus.holdout);
    holdoutRecords += holdout.records;
    finalHoldoutMse = holdout.overall;

    const genus = new Genus();
    for (const creature of population) {
      if (!Number.isFinite(creature.score)) continue;
      if (creature.uuid === undefined) CreatureUtil.makeUUID(creature);
      genus.addCreature(creature);
    }
    finalSpecies = genus.speciesMap.size;
    finalDistance = meanGeneticDistance(population);
    // Measurement only: not charged to the budget, never read by a decision.
    const diversity = behaviouralDiversity(population, probe);
    diagnosticRecords += population.length * probe.length;
    const recordsScored = evalRecords + ctx.screenRecords;
    const wallMs = performance.now() - startedMs;
    if (generation === 1) {
      target = settings.targetHoldoutFraction * holdout.overall;
    }
    generations.push({
      generation,
      recordsScored,
      evaluations,
      bestTrainMse: finalTrainMse,
      bestHoldoutMse: holdout.overall,
      meanGeneticDistance: finalDistance,
      speciesCount: finalSpecies,
      behaviouralDiversity: diversity,
      wallMs,
    });
    if (toTarget === null && holdout.overall <= target) {
      toTarget = { recordsScored, evaluations, generation, wallMs };
    }

    if (recordsScored >= limit) break;

    // 5. Breed the next generation.
    const elites = population.slice(0, settings.elitism);
    const slots = settings.populationSize - elites.length;
    const next: Creature[] = [...elites];
    let made = 0;
    const parentDraws = Math.ceil(slots / 2);
    for (let p = 0; p < parentDraws; p++) {
      const r = rng.random();
      const parent = population[Math.floor(r * r * population.length)];
      const parentEval = evaluated.get(parent)!;
      const want = Math.min(2, slots - made) as 1 | 2;
      const pair = breedPair(arm, parent, parentEval, ctx, generation, want);
      for (const bred of pair) {
        next.push(bred.child);
        pending.push({ edge: bred.edge, child: bred.child, parentEval });
        made++;
      }
    }
    population = next;
  }

  return {
    arm,
    factors: armFactors(arm),
    seed: settings.seed,
    finalTrainMse,
    finalHoldoutMse,
    evaluations,
    recordsScored: evalRecords + ctx.screenRecords,
    screenRecords: ctx.screenRecords,
    holdoutRecords,
    diagnosticRecords,
    target,
    toTarget,
    failures,
    repeatedFailures,
    noChange,
    offspring,
    targetedOffspring,
    finalMeanGeneticDistance: finalDistance,
    finalSpeciesCount: finalSpecies,
    meanBehaviouralDiversity: mean(
      generations.filter((g) => g.generation >= 2).map((g) =>
        g.behaviouralDiversity
      ),
    ),
    finalBehaviouralDiversity: generations.length === 0
      ? 0
      : generations[generations.length - 1].behaviouralDiversity,
    generations,
    edges,
  };
}

/** The paired comparison of an arm against a control, over shared seeds. */
export interface PairedComparison {
  n: number;
  meanDiff: number;
  medianDiff: number;
  ci95: [number, number];
  wins: number;
  losses: number;
  diffs: number[];
  recordsToTarget: {
    armReached: number;
    controlReached: number;
    pairedMedianDiff: number | null;
  };
  /**
   * Median over seeds of arm / control `meanBehaviouralDiversity`; `NaN` when
   * no seed has a usable (non-zero, finite) control value.
   */
  diversityRatio: number;
}

/**
 * Compare an arm with a control, paired by seed. A negative difference means
 * the arm reached a lower (better) held-out MSE.
 *
 * @throws {Error} When the seeds do not match one for one.
 */
export function pairedComparison(
  control: readonly ArmResult[],
  arm: readonly ArmResult[],
  bootstrapSamples = 2000,
  seed = 4155,
): PairedComparison {
  if (
    control.length !== arm.length ||
    control.some((result, i) => result.seed !== arm[i].seed)
  ) {
    throw new Error("control and arm runs must pair up by seed");
  }
  const diffs = arm.map((r, i) =>
    r.finalHoldoutMse - control[i].finalHoldoutMse
  );
  const n = diffs.length;
  const rng = createSeededRng(seed);
  const means: number[] = [];
  if (n > 0) {
    for (let b = 0; b < bootstrapSamples; b++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += diffs[Math.floor(rng.random() * n)];
      means.push(sum / n);
    }
    means.sort((a, b) => a - b);
  }
  const at = (q: number) =>
    means.length === 0
      ? Number.NaN
      : means[Math.min(means.length - 1, Math.floor(q * means.length))];

  const bothReached: number[] = [];
  arm.forEach((r, i) => {
    const c = control[i];
    if (r.toTarget !== null && c.toTarget !== null) {
      bothReached.push(r.toTarget.recordsScored - c.toTarget.recordsScored);
    }
  });
  const ratios: number[] = [];
  arm.forEach((r, i) => {
    const denominator = control[i].meanBehaviouralDiversity;
    if (denominator !== 0 && Number.isFinite(denominator)) {
      ratios.push(r.meanBehaviouralDiversity / denominator);
    }
  });

  return {
    n,
    meanDiff: n === 0 ? Number.NaN : mean(diffs),
    medianDiff: median(diffs),
    ci95: [at(0.025), at(0.975)],
    wins: diffs.filter((d) => d < 0).length,
    losses: diffs.filter((d) => d > 0).length,
    diffs,
    recordsToTarget: {
      armReached: arm.filter((r) => r.toTarget !== null).length,
      controlReached: control.filter((r) => r.toTarget !== null).length,
      pairedMedianDiff: bothReached.length === 0 ? null : median(bothReached),
    },
    diversityRatio: median(ratios),
  };
}

/**
 * The criteria fixed before any run, so a result cannot move them.
 *
 * The diversity criterion is behavioural diversity
 * ({@link behaviouralDiversity}) averaged over generations 2 and later
 * (generation 1 is the identical seeded population in every arm), as a ratio of arm to
 * control. UUID-based genetic distance is reported but not used, because it
 * collapses to zero for mutation-only clones.
 */
export const SUCCESS_CRITERIA = Object.freeze({
  maxCiUpper: 0,
  minWinFraction: 0.7,
  minDiversityRatio: 0.8,
});

/** Benefit, harm, or neither, against {@link SUCCESS_CRITERIA}. */
export function verdict(
  comparison: PairedComparison,
): "benefit" | "no-benefit" | "harm" {
  if (
    comparison.ci95[1] < SUCCESS_CRITERIA.maxCiUpper &&
    comparison.n > 0 &&
    comparison.wins / comparison.n >= SUCCESS_CRITERIA.minWinFraction &&
    comparison.diversityRatio >= SUCCESS_CRITERIA.minDiversityRatio
  ) {
    return "benefit";
  }
  if (comparison.ci95[0] > 0) return "harm";
  return "no-benefit";
}
