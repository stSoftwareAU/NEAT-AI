/**
 * Separating topology gains from new-edge weight-placement luck — Issue #4162.
 *
 * The question: when a structural mutation adds one edge and the child scores
 * better, was it the topology, or did the random weight happen to land well?
 * Each parent receives one uniformly chosen new forward edge, evaluated with
 * several independent weight draws. Every draw is paired with a weight-only
 * perturbation of an existing synapse of the same Float32 magnitude, so the
 * pair differs in nothing but "new edge" versus "nudge an old weight". Three
 * preregistered selection rules, applied to a cheap sample only, are then
 * checked against the full train corpus and an untouched holdout.
 *
 * ## What is real and what is a stand-in
 *
 * Real: the parents (evolved {@link Creature}s from the same breeding and
 * mutation machinery the sibling studies use), the new-edge weight draw
 * (`Synapse.randomWeight`, the production AddConnection draw) and the scoring
 * ({@link scoreCreature}).
 *
 * Stand-ins: the objective is the 4-input synthetic regression of
 * {@link buildStudyCorpus}, scored in-process. The "structural mutation" is
 * one uniformly chosen AddConnection candidate per parent (an assumption: the
 * production operator also biases by prediction error). Scorer #588
 * perturbation machinery is not in this repository; perturbations are built
 * here from `Synapse.randomWeight` and `Math.fround`.
 *
 * Cost unit: records scored. The holdout never influences selection.
 *
 * The paper note: arXiv 2611.01213 — method not pinned; this is the
 * repository's reading of the issue.
 *
 * @module topologyWeightLuckStudy
 */

import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Synapse } from "@architecture/Synapse.ts";
import { Mutator } from "@neat/Mutator.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { DEFAULT_STRUCTURAL_MUTATION_OPTIONS } from "@mutate/StructuralMutationOptions.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  type RandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import {
  type ABRecord,
  breedOffspring,
  scoreCreature,
} from "./preSelectionAB.ts";
import { median } from "./rankFidelity.ts";
import {
  buildControlCreature,
  buildStudyCorpus,
  quantile,
  withSeededGlobals,
} from "./connectivityPriorStudy.ts";
import denoConfig from "../../deno.json" with { type: "json" };

/** Parents the study aims for. */
export const TARGET_PARENTS = 100;
/** Independent evolution runs that supply parents. */
export const PARENT_RUNS = 10;
/** Parents kept from each run. */
export const PARENTS_PER_RUN = 10;
/** Run r uses seed `PARENT_BASE_SEED + r`. */
export const PARENT_BASE_SEED = 4162;
/** Weight draws per mutation. */
export const DRAWS = 8;
/** Draw k uses seed `DRAW_BASE_SEED + k`; the same seeds for every mutation. */
export const DRAW_BASE_SEED = 41620;
/** Seed of the corpus. */
export const CORPUS_SEED = 4162;
/** Records in the cheap calibration sample. */
export const CHEAP_RECORDS = 50;
/** Bootstrap resamples. */
export const BOOTSTRAP_RESAMPLES = 10_000;
/** Bootstrap seed. */
export const BOOTSTRAP_SEED = 4162;
/** Draws (of {@link DRAWS}) in which the new edge must win to count as consistent. */
export const CONSISTENCY_THRESHOLD = 6;

/** How one study is set up. */
export interface StudySettings {
  readonly parentRuns: number;
  readonly parentsPerRun: number;
  readonly populationSize: number;
  readonly generations: number;
  readonly mutationRate: number;
  readonly trainRecords: number;
  readonly holdoutRecords: number;
  readonly cheapRecords: number;
}

/** Defaults for the real study. */
export const DEFAULT_SETTINGS: StudySettings = Object.freeze({
  parentRuns: PARENT_RUNS,
  parentsPerRun: PARENTS_PER_RUN,
  populationSize: 16,
  generations: 15,
  mutationRate: 0.5,
  trainRecords: 300,
  holdoutRecords: 300,
  cheapRecords: CHEAP_RECORDS,
});

/** Refuse settings that cannot describe a study. */
export function validateSettings(s: StudySettings): void {
  const counts: (keyof StudySettings)[] = [
    "parentRuns",
    "parentsPerRun",
    "populationSize",
    "generations",
    "trainRecords",
    "holdoutRecords",
    "cheapRecords",
  ];
  for (const field of counts) {
    const value = s[field];
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(
        `settings.${field} must be a positive integer, got ${value}`,
      );
    }
  }
  if (s.cheapRecords > s.trainRecords) {
    throw new Error(
      `settings.cheapRecords (${s.cheapRecords}) must not exceed settings.trainRecords (${s.trainRecords})`,
    );
  }
  if (!(s.mutationRate > 0 && s.mutationRate <= 1)) {
    throw new Error(
      `settings.mutationRate must be in (0, 1], got ${s.mutationRate}`,
    );
  }
}

/** The corpora a mutation is scored on. */
export interface Corpora {
  readonly cheap: readonly ABRecord[];
  readonly train: readonly ABRecord[];
  readonly holdout: readonly ABRecord[];
}

export type CorpusName = "cheap" | "train" | "holdout";
const CORPUS_NAMES: readonly CorpusName[] = ["cheap", "train", "holdout"];

/** MSE on each corpus. */
export interface Mse {
  cheap: number;
  train: number;
  holdout: number;
}

/** Snapshot every weight and non-input bias at Float32 precision. */
function float32Snapshot(creature: Creature): Creature {
  const clone = Creature.fromJSON(creature.exportJSON());
  for (const synapse of clone.synapses) {
    synapse.weight = Math.fround(synapse.weight);
  }
  for (const neuron of clone.neurons) {
    if (neuron.type !== "input") neuron.bias = Math.fround(neuron.bias);
  }
  delete clone.uuid;
  CreatureUtil.makeUUID(clone);
  return clone;
}

/**
 * Evolve one population on the train corpus and return its best distinct
 * creatures as Float32 snapshots.
 *
 * Mirrors the connectivity study's control arm: no budget, no threshold, a
 * fixed number of generations.
 */
export function prepareParents(
  runSeed: number,
  settings: StudySettings,
  train: readonly ABRecord[],
): { parents: Creature[]; records: number } {
  return withSeededGlobals(runSeed, () => {
    const rng = createSeededRng(runSeed ^ 0x5a5a);
    const config = createNeatConfig({
      populationSize: settings.populationSize,
      elitism: 2,
      mutationRate: settings.mutationRate,
      seed: runSeed,
    });
    const mutator = new Mutator(config);
    let records = 0;
    const scorePass = (creatures: readonly Creature[]) => {
      for (const creature of creatures) {
        if (creature.score !== undefined) continue;
        const scored = scoreCreature(creature, train);
        creature.score = scored.score;
        records += scored.records;
      }
    };
    const byScore = (a: Creature, b: Creature) =>
      (b.score ?? -Infinity) - (a.score ?? -Infinity);

    let population: Creature[] = [];
    for (let i = 0; i < settings.populationSize; i++) {
      population.push(buildControlCreature(rng));
    }
    scorePass(population);
    population.sort(byScore);
    for (let g = 0; g < settings.generations; g++) {
      const offspring = breedOffspring(
        population,
        settings.populationSize,
        mutator,
        config,
        rng,
      );
      scorePass(offspring);
      population = [
        ...population,
        ...offspring.filter((c) => c.score !== undefined),
      ].sort(byScore).slice(0, settings.populationSize);
    }

    const seen = new Set<string>();
    const parents: Creature[] = [];
    for (const creature of population) {
      if (parents.length >= settings.parentsPerRun) break;
      const uuid = CreatureUtil.makeUUID(creature);
      if (seen.has(uuid)) continue;
      seen.add(uuid);
      parents.push(float32Snapshot(creature));
    }
    return { parents, records };
  });
}

/**
 * The Float32 new-edge weights, one per draw seed. The same values are used
 * for every mutation, so a draw is a fixed "luck" index, not fresh noise.
 */
export function drawNewEdgeWeights(
  draws = DRAWS,
  scale = DEFAULT_STRUCTURAL_MUTATION_OPTIONS.structuralWeightScale,
): number[] {
  const previous = getRandomNumberGenerator();
  try {
    const out: number[] = [];
    for (let k = 0; k < draws; k++) {
      setRandomNumberGenerator(createSeededRng(DRAW_BASE_SEED + k));
      out.push(Math.fround(Synapse.randomWeight(scale)));
    }
    return out;
  } finally {
    setRandomNumberGenerator(previous);
  }
}

/** The name a neuron carries on the wire: `input-N`, `output-N` or its uuid. */
function wireUuid(creature: Creature, index: number): string {
  const neuron = creature.neurons[index];
  if (neuron.type === "input") return `input-${index}`;
  if (neuron.type === "output") {
    return `output-${index - (creature.neurons.length - creature.output)}`;
  }
  if (neuron.uuid === undefined) {
    throw new Error(`neuron ${index} has no uuid`);
  }
  return neuron.uuid;
}

/** A new forward edge, by position and by wire uuid. */
export interface NewEdge {
  from: number;
  to: number;
  fromUUID: string;
  toUUID: string;
}

/**
 * One uniformly chosen AddConnection candidate: a forward pair (`from < to`,
 * the target neither input nor constant) with no synapse between them in any
 * role. An assumption of this study: the production operator may bias the
 * choice, this one does not.
 */
export function chooseNewEdge(
  parent: Creature,
  rng: RandomNumberGenerator,
): NewEdge {
  const candidates: [number, number][] = [];
  const count = parent.neurons.length;
  for (let to = parent.input; to < count; to++) {
    if (parent.neurons[to].type === "constant") continue;
    for (let from = 0; from < to; from++) {
      if (!parent.hasConnection(from, to)) candidates.push([from, to]);
    }
  }
  if (candidates.length === 0) {
    throw new Error("no available forward connection");
  }
  const [from, to] = candidates[Math.floor(rng.random() * candidates.length)];
  return {
    from,
    to,
    fromUUID: wireUuid(parent, from),
    toUUID: wireUuid(parent, to),
  };
}

function clone(parent: Creature): Creature {
  return Creature.fromJSON(parent.exportJSON());
}

function finish(creature: Creature): Creature {
  delete creature.memetic;
  delete creature.uuid;
  CreatureUtil.makeUUID(creature);
  return creature;
}

/** A copy of `parent` with `edge` added at `weight`. The parent is untouched. */
export function buildTopologyVariant(
  parent: Creature,
  edge: { fromUUID: string; toUUID: string },
  weight: number,
): Creature {
  const child = clone(parent);
  const byUuid = new Map<string, number>();
  for (let i = 0; i < child.neurons.length; i++) {
    byUuid.set(wireUuid(child, i), i);
  }
  const from = byUuid.get(edge.fromUUID);
  const to = byUuid.get(edge.toUUID);
  if (from === undefined || to === undefined) {
    throw new Error(
      `edge ${edge.fromUUID} -> ${edge.toUUID} not found in the parent`,
    );
  }
  child.connect(from, to, weight);
  return finish(child);
}

/** A weight-only variant and what it changed. */
export interface WeightOnlyVariant {
  creature: Creature;
  synapse: { fromUUID: string; toUUID: string };
  delta: number;
  realisedBudget: number;
}

/**
 * A copy of `parent` with one existing weight moved by `±budget` at Float32
 * precision. The sign and synapse come from `rng`.
 */
export function buildWeightOnlyVariant(
  parent: Creature,
  budget: number,
  rng: RandomNumberGenerator,
): WeightOnlyVariant {
  if (parent.synapses.length === 0) {
    throw new Error("parent has no synapses to perturb");
  }
  const child = clone(parent);
  const index = Math.floor(rng.random() * child.synapses.length);
  const sign = rng.random() < 0.5 ? -1 : 1;
  const synapse = child.synapses[index];
  const old = synapse.weight;
  const newWeight = Math.fround(old + Math.fround(sign * budget));
  synapse.weight = newWeight;
  return {
    creature: finish(child),
    synapse: {
      fromUUID: wireUuid(child, synapse.from),
      toUUID: wireUuid(child, synapse.to),
    },
    delta: newWeight - old,
    realisedBudget: Math.abs(newWeight - old),
  };
}

/** One draw of the new edge. */
export interface TopologyDraw {
  k: number;
  weight: number;
  budget: number;
  mse: Mse;
}

/** One matched weight-only perturbation. */
export interface WeightDraw {
  k: number;
  synapse: { fromUUID: string; toUUID: string };
  delta: number;
  budget: number;
  mse: Mse;
}

/** Everything measured for one parent and one new edge. */
export interface MutationRecord {
  parentId: string;
  edge: { fromUUID: string; toUUID: string };
  parentMse: Mse;
  topology: TopologyDraw[];
  weightOnly: WeightDraw[];
  records: { cheap: number; train: number; holdout: number };
}

function mseOn(
  creature: Creature,
  corpora: Corpora,
  spent: { cheap: number; train: number; holdout: number },
): Mse {
  const out = { cheap: 0, train: 0, holdout: 0 };
  for (const name of CORPUS_NAMES) {
    const scored = scoreCreature(creature, corpora[name]);
    out[name] = -scored.score;
    spent[name] += scored.records;
  }
  return out;
}

/** Score the parent, each topology draw and each matched weight-only draw. */
export function evaluateMutation(
  parent: Creature,
  parentId: string,
  edge: { fromUUID: string; toUUID: string },
  weights: readonly number[],
  corpora: Corpora,
  mutationSeed: number,
): MutationRecord {
  const spent = { cheap: 0, train: 0, holdout: 0 };
  const parentMse = mseOn(parent, corpora, spent);
  const topology: TopologyDraw[] = [];
  const weightOnly: WeightDraw[] = [];
  for (let k = 0; k < weights.length; k++) {
    const weight = weights[k];
    const variant = buildTopologyVariant(parent, edge, weight);
    topology.push({
      k,
      weight,
      budget: Math.abs(weight),
      mse: mseOn(variant, corpora, spent),
    });
    const perturbed = buildWeightOnlyVariant(
      parent,
      Math.abs(weight),
      createSeededRng(mutationSeed * 31 + k),
    );
    weightOnly.push({
      k,
      synapse: perturbed.synapse,
      delta: perturbed.delta,
      budget: perturbed.realisedBudget,
      mse: mseOn(perturbed.creature, corpora, spent),
    });
  }
  return {
    parentId,
    edge: { fromUUID: edge.fromUUID, toUUID: edge.toUUID },
    parentMse,
    topology,
    weightOnly,
    records: spent,
  };
}

/** One corpus's view of a mutation. Gains are positive when the child is better. */
export interface Summary {
  /** `weightOnly mse - topology mse` per draw; positive: the new edge won. */
  pairedDiffs: number[];
  medianPairedGain: number;
  /** Draws in which the new edge beat its matched weight-only perturbation. */
  signConsistency: number;
  medianTopologyGain: number;
  medianWeightGain: number;
  bestDrawGain: number;
  firstDrawGain: number;
}

/** Summarise one mutation on one corpus. */
export function summarise(record: MutationRecord, corpus: CorpusName): Summary {
  const parent = record.parentMse[corpus];
  const topo = record.topology.map((t) => t.mse[corpus]);
  const weight = record.weightOnly.map((w) => w.mse[corpus]);
  if (topo.length === 0 || topo.length !== weight.length) {
    throw new Error("a mutation needs matching, non-empty draws");
  }
  const pairedDiffs = weight.map((w, k) => w - topo[k]);
  const topoGains = topo.map((t) => parent - t);
  const weightGains = weight.map((w) => parent - w);
  return {
    pairedDiffs,
    medianPairedGain: median(pairedDiffs),
    signConsistency: pairedDiffs.filter((d) => d > 0).length,
    medianTopologyGain: median(topoGains),
    medianWeightGain: median(weightGains),
    bestDrawGain: Math.max(...topoGains) - Math.max(...weightGains),
    firstDrawGain: pairedDiffs[0],
  };
}

/** A preregistered selection rule, applied to the cheap summary only. */
export interface Rule {
  name: string;
  description: string;
  /** Evaluations of the cheap sample one mutation costs to apply the rule. */
  costEvaluations: number;
  selects: (summary: Summary) => boolean;
}

export const RULES: readonly Rule[] = Object.freeze([
  {
    name: "single-draw",
    description: "first draw: the new edge beat its matched weight-only nudge",
    costEvaluations: 2,
    selects: (s: Summary) => s.firstDrawGain > 0,
  },
  {
    name: "best-draw",
    description:
      "best new-edge draw gained more than the best weight-only draw",
    costEvaluations: 2 * DRAWS,
    selects: (s: Summary) => s.bestDrawGain > 0,
  },
  {
    name: "median-paired",
    description:
      `median paired gain above 0 and the new edge won at least ${CONSISTENCY_THRESHOLD} of ${DRAWS} draws`,
    costEvaluations: 2 * DRAWS,
    selects: (s: Summary) =>
      s.medianPairedGain > 0 && s.signConsistency >= CONSISTENCY_THRESHOLD,
  },
]);

/** Cheap-sample evaluations one mutation costs under `rule`. */
export function selectionCostEvaluations(rule: Rule): number {
  return rule.costEvaluations;
}

/** A mutation is confirmed on a corpus iff its median paired gain is positive. */
export function confirmed(record: MutationRecord, corpus: CorpusName): boolean {
  return summarise(record, corpus).medianPairedGain > 0;
}

/** What a rule did across the mutations. */
export interface RuleOutcome {
  rule: string;
  selected: number;
  confirmedTrain: number;
  confirmedHoldout: number;
  precisionTrain: number | null;
  precisionHoldout: number | null;
  meanHoldoutGainSelected: number | null;
  /** Records the rule's selection scoring costs, whatever it selects. */
  selectionCostRecords: number;
}

/** Apply `rule` to the cheap summaries and check the selections. */
export function ruleOutcome(
  rule: Rule,
  records: readonly MutationRecord[],
  cheapRecords = CHEAP_RECORDS,
): RuleOutcome {
  const chosen = records.filter((r) => rule.selects(summarise(r, "cheap")));
  const confirmedTrain = chosen.filter((r) => confirmed(r, "train")).length;
  const confirmedHoldout = chosen.filter((r) => confirmed(r, "holdout")).length;
  const n = chosen.length;
  return {
    rule: rule.name,
    selected: n,
    confirmedTrain,
    confirmedHoldout,
    precisionTrain: n === 0 ? null : confirmedTrain / n,
    precisionHoldout: n === 0 ? null : confirmedHoldout / n,
    meanHoldoutGainSelected: n === 0 ? null : chosen.reduce(
      (sum, r) => sum + summarise(r, "holdout").medianPairedGain,
      0,
    ) / n,
    selectionCostRecords: records.length * rule.costEvaluations * cheapRecords,
  };
}

export type PrecisionVerdict = "benefit" | "harm" | "no-benefit";

/** Benefit iff the interval lies above 0, harm iff below, else no-benefit. */
export function precisionVerdict(
  ci: { low: number; high: number } | null,
): PrecisionVerdict {
  if (ci === null) return "no-benefit";
  if (ci.low > 0) return "benefit";
  if (ci.high < 0) return "harm";
  return "no-benefit";
}

/** Paired bootstrap of holdout precision, rule A minus rule B. */
export interface PrecisionComparison {
  a: string;
  b: string;
  observed: number | null;
  ci: { low: number; high: number } | null;
  resamples: number;
  undefinedResamples: number;
  verdict: PrecisionVerdict;
}

/** Resample mutations; skip resamples in which either rule selects none. */
export function comparePrecision(
  records: readonly MutationRecord[],
  ruleA: Rule,
  ruleB: Rule,
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): PrecisionComparison {
  const flags = records.map((r) => ({
    a: ruleA.selects(summarise(r, "cheap")),
    b: ruleB.selects(summarise(r, "cheap")),
    ok: confirmed(r, "holdout"),
  }));
  const precision = (indices: readonly number[], pick: "a" | "b") => {
    let selected = 0;
    let ok = 0;
    for (const i of indices) {
      if (!flags[i][pick]) continue;
      selected++;
      if (flags[i].ok) ok++;
    }
    return selected === 0 ? null : ok / selected;
  };
  const all = records.map((_, i) => i);
  const pa = precision(all, "a");
  const pb = precision(all, "b");
  const observed = pa === null || pb === null ? null : pa - pb;

  const rng = createSeededRng(seed);
  const diffs: number[] = [];
  let undefinedResamples = 0;
  for (let r = 0; r < resamples; r++) {
    const indices: number[] = [];
    for (let i = 0; i < records.length; i++) {
      indices.push(Math.floor(rng.random() * records.length));
    }
    const a = precision(indices, "a");
    const b = precision(indices, "b");
    if (a === null || b === null) {
      undefinedResamples++;
      continue;
    }
    diffs.push(a - b);
  }
  const ci = diffs.length === 0
    ? null
    : { low: quantile(diffs, 0.025), high: quantile(diffs, 0.975) };
  return {
    a: ruleA.name,
    b: ruleB.name,
    observed,
    ci,
    resamples,
    undefinedResamples,
    verdict: precisionVerdict(ci),
  };
}

/** Options for {@link runStudy}. */
export interface StudyOptions {
  codeVersion?: string;
  settings?: Partial<StudySettings>;
  bootstrapResamples?: number;
}

interface Failure {
  parentId: string;
  stage: "prepare" | "mutation";
  message: string;
}

const CRITERIA =
  "Primary test: holdout precision of median-paired minus best-draw; benefit iff the paired-bootstrap 95% CI lies above 0, harm iff below, else no-benefit. Secondary: median-paired minus single-draw, same criteria. Descriptive: the holdout distribution of medianPairedGain. A mutation is confirmed on a corpus iff its median paired gain there is above 0. Selection uses the cheap sample only.";

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** The descriptive distribution of the median paired gain over `records`. */
export function distribution(
  records: readonly MutationRecord[],
  corpus: CorpusName,
  resamples: number,
) {
  const gains = records.map((r) => summarise(r, corpus));
  const medians = gains.map((g) => g.medianPairedGain);
  const histogram = new Array<number>(DRAWS + 1).fill(0);
  for (const g of gains) histogram[g.signConsistency]++;
  const n = gains.length;
  let ci: { low: number; high: number } | null = null;
  if (n > 0) {
    const rng = createSeededRng(BOOTSTRAP_SEED);
    const resampled: number[] = [];
    for (let r = 0; r < resamples; r++) {
      const pick: number[] = [];
      for (let i = 0; i < n; i++) {
        pick.push(medians[Math.floor(rng.random() * n)]);
      }
      resampled.push(median(pick));
    }
    ci = { low: quantile(resampled, 0.025), high: quantile(resampled, 0.975) };
  }
  return {
    n,
    medianOfMedianPairedGain: n === 0 ? null : median(medians),
    medianCi: ci,
    signConsistencyHistogram: histogram,
    fractionConsistent: n === 0
      ? null
      : gains.filter((g) => g.signConsistency >= CONSISTENCY_THRESHOLD).length /
        n,
    fractionLuckOnly: n === 0
      ? null
      : gains.filter((g) => g.bestDrawGain > 0 && g.medianPairedGain <= 0)
        .length / n,
  };
}

/** Prepare parents, evaluate every mutation and summarise. */
export function runStudy(options: StudyOptions = {}) {
  const settings: StudySettings = { ...DEFAULT_SETTINGS, ...options.settings };
  validateSettings(settings);
  const resamples = options.bootstrapResamples ?? BOOTSTRAP_RESAMPLES;
  const { train, holdout } = buildStudyCorpus(
    CORPUS_SEED,
    settings.trainRecords,
    settings.holdoutRecords,
  );
  const corpora: Corpora = {
    cheap: train.slice(0, settings.cheapRecords),
    train,
    holdout,
  };
  const weights = drawNewEdgeWeights();
  const failures: Failure[] = [];
  const mutations: MutationRecord[] = [];
  const parentSeeds: number[] = [];
  let preparationRecords = 0;
  let actualParents = 0;
  const spent = { cheap: 0, train: 0, holdout: 0 };

  for (let r = 0; r < settings.parentRuns; r++) {
    const runSeed = PARENT_BASE_SEED + r;
    parentSeeds.push(runSeed);
    let parents: Creature[];
    try {
      const prepared = prepareParents(runSeed, settings, train);
      parents = prepared.parents;
      preparationRecords += prepared.records;
    } catch (error) {
      failures.push({
        parentId: `r${r}`,
        stage: "prepare",
        message: message(error),
      });
      continue;
    }
    actualParents += parents.length;
    for (let i = 0; i < parents.length; i++) {
      const parentId = `r${r}-p${i}`;
      const mutationSeed = runSeed * 1000 + i;
      try {
        const edge = chooseNewEdge(parents[i], createSeededRng(mutationSeed));
        const record = evaluateMutation(
          parents[i],
          parentId,
          edge,
          weights,
          corpora,
          mutationSeed,
        );
        mutations.push(record);
        spent.cheap += record.records.cheap;
        spent.train += record.records.train;
        spent.holdout += record.records.holdout;
      } catch (error) {
        failures.push({ parentId, stage: "mutation", message: message(error) });
      }
    }
  }

  const byName = (name: string) => RULES.find((rule) => rule.name === name)!;
  return {
    manifest: {
      issue: 4162,
      codeVersion: options.codeVersion ?? "unknown",
      neatAiVersion: (denoConfig as { version: string }).version,
      denoVersion: Deno.version.deno,
      corpusSeed: CORPUS_SEED,
      settings,
      parentSeeds,
      drawSeeds: Array.from({ length: DRAWS }, (_, k) => DRAW_BASE_SEED + k),
      drawWeights: weights,
      consistencyThreshold: CONSISTENCY_THRESHOLD,
      bootstrap: { resamples, seed: BOOTSTRAP_SEED },
      rules: RULES.map((r) => ({
        name: r.name,
        description: r.description,
        costEvaluations: r.costEvaluations,
      })),
      criteria: CRITERIA,
      paper:
        "arXiv 2611.01213 — method not pinned; this is the repository's reading of the issue",
      scorer588:
        "Scorer #588 perturbation machinery is not in this repository; perturbations are built here from Synapse.randomWeight and Math.fround",
    },
    mutations,
    distribution: {
      cheap: distribution(mutations, "cheap", resamples),
      train: distribution(mutations, "train", resamples),
      holdout: distribution(mutations, "holdout", resamples),
    },
    rules: RULES.map((rule) =>
      ruleOutcome(rule, mutations, settings.cheapRecords)
    ),
    primary: comparePrecision(
      mutations,
      byName("median-paired"),
      byName("best-draw"),
      resamples,
      BOOTSTRAP_SEED,
    ),
    secondary: comparePrecision(
      mutations,
      byName("median-paired"),
      byName("single-draw"),
      resamples,
      BOOTSTRAP_SEED,
    ),
    cost: {
      preparationRecords,
      cheapRecords: spent.cheap,
      trainRecords: spent.train,
      holdoutRecords: spent.holdout,
    },
    coverage: {
      targetParents: settings.parentRuns * settings.parentsPerRun,
      actualParents,
      mutationsEvaluated: mutations.length,
      failures,
    },
  };
}
