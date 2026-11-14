/**
 * Initial connectivity and input fan-out as interacting priors — Issue #4160.
 *
 * The question: does starting evolution from a sparser, input-fan-out
 * controlled hidden layer beat today's fully connected initialisation, at an
 * equal cost in charged train records? Two knobs are swept together because
 * they interact: the mean in-degree of the hidden neurons, and the number of
 * hidden neurons each input feeds (its fan-out).
 *
 * ## What is real and what is a stand-in
 *
 * Real: the creatures ({@link Creature}), the crossover
 * ({@link breedOffspring}, which calls `Offspring.breed`), the mutation
 * operators ({@link Mutator}) and the scoring ({@link scoreCreature}).
 *
 * A stand-in: the objective is a 4-input synthetic regression (one input is a
 * distractor) scored in-process by activating the creature, not a production
 * corpus scored through the Rust scorer. Cost is counted in **charged train
 * records**, which is what a real corpus would charge for. The held-out score
 * never influences selection and is not charged.
 *
 * The method is this repository's reading of the issue; the paper it cites
 * (arXiv 2610.33498) was not read.
 *
 * @module connectivityPriorStudy
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Mutator } from "@neat/Mutator.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
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
import denoConfig from "../../deno.json" with { type: "json" };

/** Network inputs. */
export const INPUTS = 4;
/** Hidden neurons in every starting creature. */
export const HIDDEN = 8;
/** First validation seed. */
export const VALIDATION_BASE_SEED = 4160;
/** Validation seeds. */
export const VALIDATION_SEED_COUNT = 20;
/** First calibration seed — disjoint from the validation seeds. */
export const CALIBRATION_BASE_SEED = 94160;
/** Calibration seeds. */
export const CALIBRATION_SEED_COUNT = 4;
/** Seed of the corpus every run scores against. */
export const CORPUS_SEED = 4160;
/** Bootstrap resamples. */
export const BOOTSTRAP_RESAMPLES = 10_000;
/** Bootstrap seed. */
export const BOOTSTRAP_SEED = 4160;
/** Swept mean hidden in-degrees. */
export const IN_DEGREES: readonly number[] = [1.5, 2, 3];
/** Swept per-input fan-outs. */
export const FAN_OUTS: readonly number[] = [1, 2, 3];

/** How one run is set up. */
export interface StudySettings {
  readonly populationSize: number;
  /** Charged train records a run may spend. */
  readonly budgetRecords: number;
  readonly trainRecords: number;
  readonly holdoutRecords: number;
  readonly mutationRate: number;
  readonly maxGenerations: number;
  /** Consecutive generations with zero offspring that end a run. */
  readonly stallGenerations: number;
  /** Train MSE at which `recordsToThreshold` is read; omitted when unset. */
  readonly threshold?: number;
}

/** Defaults for the real study. */
export const DEFAULT_SETTINGS: StudySettings = Object.freeze({
  populationSize: 20,
  budgetRecords: 60_000,
  trainRecords: 300,
  holdoutRecords: 300,
  mutationRate: 0.5,
  maxGenerations: 1000,
  stallGenerations: 50,
});

/** Refuse settings that cannot describe a run. */
export function validateSettings(s: StudySettings): void {
  const counts: (keyof StudySettings)[] = [
    "populationSize",
    "budgetRecords",
    "trainRecords",
    "holdoutRecords",
    "maxGenerations",
    "stallGenerations",
  ];
  for (const field of counts) {
    const value = s[field] as number;
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(
        `settings.${field} must be a positive integer, got ${value}`,
      );
    }
  }
  if (!(s.mutationRate > 0 && s.mutationRate <= 1)) {
    throw new Error(
      `settings.mutationRate must be in (0, 1], got ${s.mutationRate}`,
    );
  }
}

/**
 * One arm: the control, one cell of the in-degree by fan-out grid, or the
 * self-loop arm, which runs on the recurrent execution path.
 */
export type StudyArm =
  | { arm: string; kind: "control" }
  | { arm: string; kind: "prior"; inDegree: number; fanOut: number }
  | { arm: string; kind: "selfLoop" };

/** Name of the self-loop arm. */
export const SELF_LOOP_ARM = "control-selfloop";

/**
 * The control first, then the grid with in-degree outer and fan-out inner,
 * then the self-loop arm. The self-loop arm is never a calibration candidate.
 */
export const ARMS: readonly StudyArm[] = (() => {
  const arms: StudyArm[] = [{ arm: "control", kind: "control" }];
  for (const inDegree of IN_DEGREES) {
    for (const fanOut of FAN_OUTS) {
      arms.push({
        arm: `d${inDegree}-f${fanOut}`,
        kind: "prior",
        inDegree,
        fanOut,
      });
    }
  }
  arms.push({ arm: SELF_LOOP_ARM, kind: "selfLoop" });
  return arms;
})();

/** Train then holdout records from one seed. Input `d` is a distractor. */
export function buildStudyCorpus(
  seed: number,
  trainRecords: number,
  holdoutRecords: number,
): { train: ABRecord[]; holdout: ABRecord[] } {
  const rng = createSeededRng(seed);
  const draw = (count: number): ABRecord[] => {
    const records: ABRecord[] = [];
    for (let r = 0; r < count; r++) {
      const a = rng.random() * 2 - 1;
      const b = rng.random() * 2 - 1;
      const c = rng.random() * 2 - 1;
      const d = rng.random() * 2 - 1;
      const noise = (rng.random() - 0.5) * 0.05;
      records.push({
        input: new Float32Array([a, b, c, d]),
        target: 0.6 * Math.tanh(1.5 * a) - 0.35 * b * b + 0.3 * a * c + noise,
      });
    }
    return records;
  };
  const train = draw(trainRecords);
  const holdout = draw(holdoutRecords);
  return { train, holdout };
}

/** Today's initialisation: fully connected, 4 inputs to 8 hidden to 1 output. */
export function buildControlCreature(rng: RandomNumberGenerator): Creature {
  const creature = new Creature(INPUTS, 1, {
    layers: [{ squash: "TANH", count: HIDDEN }],
    outputLayer: { squash: "IDENTITY" },
  });
  for (const neuron of creature.neurons) {
    if (neuron.type === "input") continue;
    neuron.bias = (rng.random() - 0.5) * 2;
  }
  for (const synapse of creature.synapses) {
    synapse.weight = (rng.random() - 0.5) * 2;
  }
  delete creature.uuid;
  CreatureUtil.makeUUID(creature);
  return creature;
}

/**
 * The control topology plus a self-loop on every hidden neuron, built for the
 * recurrent execution path (`forwardOnly: false`, run with
 * `feedbackLoop: true`). The forward synapses are today's fully connected
 * layer, so the self-loops are the only difference from the control.
 */
export function buildSelfLoopCreature(rng: RandomNumberGenerator): Creature {
  const base = buildControlCreature(rng).exportJSON();
  const selfLoops: CreatureExport["synapses"] = base.neurons
    .filter((n) => n.type === "hidden")
    .map((n) => ({
      fromUUID: n.uuid,
      toUUID: n.uuid,
      weight: (rng.random() - 0.5) * 2,
    }));
  const creature = Creature.fromJSON({
    ...base,
    synapses: [...base.synapses, ...selfLoops],
    forwardOnly: false,
  });
  delete creature.uuid;
  CreatureUtil.makeUUID(creature);
  return creature;
}

/** Self-loops on hidden neurons — a synapse from a neuron to itself. */
export function countSelfLoops(creature: Creature): number {
  return creature.synapses.filter((s) => s.from === s.to).length;
}

/** Refuse a grid cell that no forward-only layer can realise. */
export function validateCell(inDegree: number, fanOut: number): void {
  const cell = `d${inDegree}-f${fanOut}`;
  if (!Number.isInteger(fanOut) || fanOut < 1 || fanOut > HIDDEN) {
    throw new Error(
      `cell ${cell}: fanOut must be an integer in [1, ${HIDDEN}]`,
    );
  }
  const target = inDegree * HIDDEN;
  if (!Number.isInteger(target)) {
    throw new Error(`cell ${cell}: inDegree * ${HIDDEN} must be an integer`);
  }
  const inputEdges = INPUTS * fanOut;
  if (inputEdges > target) {
    throw new Error(
      `cell ${cell}: input edges ${inputEdges} exceed the ${target} inward synapses the in-degree allows`,
    );
  }
  const repairEdges = Math.max(0, HIDDEN - inputEdges);
  if (repairEdges + inputEdges > target) {
    throw new Error(
      `cell ${cell}: ${inputEdges} input edges plus ${repairEdges} repair edges exceed the ${target} inward synapses the in-degree allows`,
    );
  }
  const hiddenEdges = target - inputEdges;
  if (hiddenEdges > (HIDDEN * (HIDDEN - 1)) / 2) {
    throw new Error(
      `cell ${cell}: ${hiddenEdges} hidden-to-hidden edges needed exceed the ${
        (HIDDEN * (HIDDEN - 1)) / 2
      } a forward-only layer holds`,
    );
  }
}

/**
 * A forward-only creature whose hidden neurons have mean in-degree exactly
 * `inDegree` and whose inputs each feed exactly `fanOut` hidden neurons.
 *
 * Input k's first `min(fanOut, ceil(HIDDEN / INPUTS))` targets are placed
 * round-robin at hidden `(k + j * INPUTS) % HIDDEN`, so the input edges cover
 * `min(INPUTS * fanOut, HIDDEN)` distinct hidden neurons; any further targets
 * are random among the input's untaken hidden neurons. A hidden neuron still
 * unfed gets a repair edge from a random earlier hidden neuron, and the rest
 * of the in-degree budget is filled with random forward hidden-to-hidden edges.
 *
 * @param prefix - Unique within a population; names the neurons.
 */
export function buildPriorCreature(
  inDegree: number,
  fanOut: number,
  rng: RandomNumberGenerator,
  prefix: string,
): Creature {
  validateCell(inDegree, fanOut);
  const cell = `d${inDegree}-f${fanOut}`;
  const target = inDegree * HIDDEN;
  const w = () => (rng.random() - 0.5) * 2;
  const hid = (i: number) => `${prefix}-hidden-${i}`;
  const outUuid = `${prefix}-output-0`;

  const inputEdges: [number, number][] = [];
  const fed = new Array<boolean>(HIDDEN).fill(false);
  for (let k = 0; k < INPUTS; k++) {
    const chosen: number[] = [];
    const roundRobin = Math.min(fanOut, Math.ceil(HIDDEN / INPUTS));
    for (let j = 0; j < roundRobin; j++) chosen.push((k + j * INPUTS) % HIDDEN);
    const others: number[] = [];
    for (let h = 0; h < HIDDEN; h++) if (!chosen.includes(h)) others.push(h);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(rng.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    chosen.push(...others.slice(0, fanOut - chosen.length));
    for (const h of chosen) {
      inputEdges.push([k, h]);
      fed[h] = true;
    }
  }

  const hh = new Set<string>();
  const hiddenEdges: [number, number][] = [];
  const addHidden = (from: number, to: number) => {
    hh.add(`${from}>${to}`);
    hiddenEdges.push([from, to]);
  };
  for (let h = 0; h < HIDDEN; h++) {
    if (fed[h] || hiddenEdges.some(([, to]) => to === h)) continue;
    addHidden(Math.floor(rng.random() * h), h);
  }
  const needed = target - inputEdges.length;
  if (hiddenEdges.length > needed) {
    throw new Error(
      `cell ${cell}: ${hiddenEdges.length} repair edges exceed the ${needed} hidden-to-hidden edges the budget allows`,
    );
  }
  const candidates: [number, number][] = [];
  for (let i = 0; i < HIDDEN; i++) {
    for (let j = i + 1; j < HIDDEN; j++) {
      if (!hh.has(`${i}>${j}`)) candidates.push([i, j]);
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const [from, to] of candidates) {
    if (hiddenEdges.length >= needed) break;
    addHidden(from, to);
  }

  const neurons: CreatureExport["neurons"] = [];
  for (let h = 0; h < HIDDEN; h++) {
    neurons.push({ type: "hidden", uuid: hid(h), squash: "TANH", bias: w() });
  }
  neurons.push({
    type: "output",
    uuid: outUuid,
    squash: "IDENTITY",
    bias: w(),
  });
  const synapses: CreatureExport["synapses"] = [];
  for (const [k, h] of inputEdges) {
    synapses.push({ fromUUID: `input-${k}`, toUUID: hid(h), weight: w() });
  }
  for (const [from, to] of hiddenEdges) {
    synapses.push({ fromUUID: hid(from), toUUID: hid(to), weight: w() });
  }
  for (let h = 0; h < HIDDEN; h++) {
    synapses.push({ fromUUID: hid(h), toUUID: outUuid, weight: w() });
  }
  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: INPUTS,
    output: 1,
    forwardOnly: true,
  });
  CreatureUtil.makeUUID(creature);
  return creature;
}

/** What a creature's starting connectivity looks like. */
export interface ConnectivityStats {
  meanHiddenInDegree: number;
  meanInputFanOut: number;
  reachable: boolean;
}

/** Connectivity measured from the creature itself. */
export function connectivityStats(creature: Creature): ConnectivityStats {
  const hidden = creature.neurons.filter((n) => n.type === "hidden");
  const inputs = creature.neurons.filter((n) => n.type === "input");
  const outputs = creature.neurons.filter((n) => n.type === "output");
  const hiddenIdx = new Set(hidden.map((n) => n.index));
  let inward = 0;
  let fromInputs = 0;
  const inputIdx = new Set(inputs.map((n) => n.index));
  const fwd = new Map<number, number[]>();
  const rev = new Map<number, number[]>();
  for (const s of creature.synapses) {
    if (hiddenIdx.has(s.to)) inward++;
    if (inputIdx.has(s.from) && hiddenIdx.has(s.to)) fromInputs++;
    if (!fwd.has(s.from)) fwd.set(s.from, []);
    fwd.get(s.from)!.push(s.to);
    if (!rev.has(s.to)) rev.set(s.to, []);
    rev.get(s.to)!.push(s.from);
  }
  const walk = (starts: number[], graph: Map<number, number[]>) => {
    const seen = new Set<number>(starts);
    const stack = [...starts];
    while (stack.length > 0) {
      for (const next of graph.get(stack.pop()!) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return seen;
  };
  const fromIn = walk(inputs.map((n) => n.index), fwd);
  const toOut = walk(outputs.map((n) => n.index), rev);
  const reachable =
    hidden.every((n) => fromIn.has(n.index) && toOut.has(n.index)) &&
    inputs.every((n) => toOut.has(n.index));
  return {
    meanHiddenInDegree: hidden.length === 0 ? 0 : inward / hidden.length,
    meanInputFanOut: inputs.length === 0 ? 0 : fromInputs / inputs.length,
    reachable,
  };
}

/** The outcome of one arm at one seed. */
export interface ArmRun {
  arm: string;
  seed: number;
  trainMse: number;
  holdoutMse: number;
  recordsScored: number;
  recordsToThreshold: number | null;
  generations: number;
  stalled: boolean;
  initial: ConnectivityStats;
  final: ConnectivityStats;
  /** Self-loop synapses in the first starting creature and in the best. */
  selfLoops: { initial: number; final: number };
}

/** A v4-looking uuid string drawn from a seeded stream. */
function seededUuid(rng: RandomNumberGenerator): string {
  const hex = (n: number) => {
    let out = "";
    for (let i = 0; i < n; i++) {
      out += Math.floor(rng.random() * 16).toString(16);
    }
    return out;
  };
  const variant = (8 + Math.floor(rng.random() * 4)).toString(16);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

/** Run one arm at one seed, with the global generator and uuids seeded. */
export function runArm(
  arm: StudyArm,
  seed: number,
  settings: StudySettings,
  corpus: { train: readonly ABRecord[]; holdout: readonly ABRecord[] },
): ArmRun {
  validateSettings(settings);
  const previousRng = getRandomNumberGenerator();
  const originalUuid = crypto.randomUUID;
  const uuidRng = createSeededRng(seed + 1);
  setRandomNumberGenerator(createSeededRng(seed));
  // Neurons added by mutation take crypto.randomUUID; crossover aligns genes
  // by uuid, so an unseeded stream would make "same seed" untrue.
  (crypto as { randomUUID: () => string }).randomUUID = () =>
    seededUuid(uuidRng);
  try {
    // The run is synchronous, so the seeding holds for all of it.
    return runSeeded(arm, seed, settings, corpus);
  } finally {
    (crypto as { randomUUID: () => string }).randomUUID = originalUuid;
    setRandomNumberGenerator(previousRng);
  }
}

function runSeeded(
  arm: StudyArm,
  seed: number,
  settings: StudySettings,
  corpus: { train: readonly ABRecord[]; holdout: readonly ABRecord[] },
): ArmRun {
  const rng = createSeededRng(seed ^ 0x5a5a);
  const recurrent = arm.kind === "selfLoop";
  const config = createNeatConfig({
    populationSize: settings.populationSize,
    elitism: 2,
    mutationRate: settings.mutationRate,
    seed,
    // The recurrent path: feedback mutations allowed and records presented
    // in order (the engine requires the two together).
    ...(recurrent ? { feedbackLoop: true, disableRandomSamples: true } : {}),
  });
  const mutator = new Mutator(config);
  const trainLen = corpus.train.length;

  let population: Creature[] = [];
  for (let i = 0; i < settings.populationSize; i++) {
    population.push(
      arm.kind === "control"
        ? buildControlCreature(rng)
        : arm.kind === "selfLoop"
        ? buildSelfLoopCreature(rng)
        : buildPriorCreature(arm.inDegree, arm.fanOut, rng, `p${i}`),
    );
  }
  const initial = connectivityStats(population[0]);
  const initialSelfLoops = countSelfLoops(population[0]);
  // A recurrent creature carries state between activations; every score
  // starts from a cleared state so a score depends on the creature alone.
  const score = (creature: Creature, records: readonly ABRecord[]) => {
    if (recurrent) creature.clearState();
    return scoreCreature(creature, records).score;
  };

  let recordsScored = 0;
  let recordsToThreshold: number | null = null;
  let halted = false;
  const scorePass = (creatures: readonly Creature[]) => {
    for (const creature of creatures) {
      if (creature.score !== undefined) continue;
      if (recordsScored + trainLen > settings.budgetRecords) {
        halted = true;
        return;
      }
      creature.score = score(creature, corpus.train);
      recordsScored += trainLen;
    }
  };
  const byScore = (a: Creature, b: Creature) =>
    (b.score ?? -Infinity) - (a.score ?? -Infinity);
  const checkThreshold = () => {
    if (
      recordsToThreshold === null && settings.threshold !== undefined &&
      -(population[0].score ?? -Infinity) <= settings.threshold
    ) {
      recordsToThreshold = recordsScored;
    }
  };

  let generations = 0;
  let stalled = false;
  let stallCount = 0;
  while (generations < settings.maxGenerations) {
    scorePass(population);
    population = population.filter((c) => c.score !== undefined);
    population.sort(byScore);
    if (population.length === 0) {
      throw new Error("budget too small to score a single creature");
    }
    checkThreshold();
    if (halted) break;
    generations++;
    const offspring = breedOffspring(
      population,
      settings.populationSize,
      mutator,
      config,
      rng,
      !recurrent,
    );
    stallCount = offspring.length === 0 ? stallCount + 1 : 0;
    if (stallCount >= settings.stallGenerations) {
      stalled = true;
      break;
    }
    scorePass(offspring);
    const scored = offspring.filter((c) => c.score !== undefined);
    population = [...population, ...scored].sort(byScore).slice(
      0,
      settings.populationSize,
    );
    checkThreshold();
    if (halted) break;
  }

  const best = population[0];
  const trainMse = -(best.score ?? -Infinity);
  const holdoutMse = -score(best, corpus.holdout);
  return {
    arm: arm.arm,
    seed,
    trainMse,
    holdoutMse,
    recordsScored,
    recordsToThreshold,
    generations,
    stalled,
    initial,
    final: connectivityStats(best),
    selfLoops: { initial: initialSelfLoops, final: countSelfLoops(best) },
  };
}

/** Value at quantile `q` by linear interpolation. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) {
    throw new Error("quantile of an empty set is undefined");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Mean of paired differences with a percentile bootstrap interval. */
export function pairedBootstrapCi(
  diffs: readonly number[],
  resamples: number,
  seed: number,
): { mean: number; low: number; high: number } {
  if (diffs.length === 0) {
    throw new Error("bootstrap of an empty set is undefined");
  }
  const rng = createSeededRng(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < diffs.length; i++) {
      sum += diffs[Math.floor(rng.random() * diffs.length)];
    }
    means.push(sum / diffs.length);
  }
  return {
    mean: diffs.reduce((a, b) => a + b, 0) / diffs.length,
    low: quantile(means, 0.025),
    high: quantile(means, 0.975),
  };
}

export type Verdict = "benefit" | "harm" | "no-benefit";

/** Lower is better throughout: the inputs are MSEs. */
export function verdict(
  ci: { low: number; high: number },
  medianArm: number,
  medianControl: number,
  upperQuartileArm: number,
  upperQuartileControl: number,
): Verdict {
  if (
    ci.high < 0 && medianArm < medianControl &&
    upperQuartileArm < upperQuartileControl
  ) return "benefit";
  if (ci.low > 0) return "harm";
  return "no-benefit";
}

/** The comparison of one arm to the control over the same seeds. */
export interface Comparison {
  meanDiff: number;
  ci: { mean: number; low: number; high: number };
  wins: number;
  losses: number;
  medianArm: number;
  medianControl: number;
  upperQuartileArm: number;
  upperQuartileControl: number;
  verdict: Verdict;
}

/** Pair by seed; diff is arm minus control holdout MSE. */
export function compareToControl(
  control: readonly ArmRun[],
  arm: readonly ArmRun[],
  resamples = BOOTSTRAP_RESAMPLES,
  bootstrapSeed = BOOTSTRAP_SEED,
): Comparison {
  if (
    control.length !== arm.length ||
    control.some((run, i) => run.seed !== arm[i].seed)
  ) {
    throw new Error("control and arm runs are not paired by seed");
  }
  const diffs = arm.map((run, i) => run.holdoutMse - control[i].holdoutMse);
  const ci = pairedBootstrapCi(diffs, resamples, bootstrapSeed);
  const a = arm.map((r) => r.holdoutMse);
  const c = control.map((r) => r.holdoutMse);
  const medianArm = median(a);
  const medianControl = median(c);
  const upperQuartileArm = quantile(a, 0.75);
  const upperQuartileControl = quantile(c, 0.75);
  return {
    meanDiff: ci.mean,
    ci,
    wins: diffs.filter((d) => d < 0).length,
    losses: diffs.filter((d) => d > 0).length,
    medianArm,
    medianControl,
    upperQuartileArm,
    upperQuartileControl,
    verdict: verdict(
      ci,
      medianArm,
      medianControl,
      upperQuartileArm,
      upperQuartileControl,
    ),
  };
}

/**
 * The grid cell with the lowest median train MSE; ties go to ARMS order. The
 * control and the self-loop arm are never candidates.
 */
export function chooseCell(calibrationRuns: readonly ArmRun[]): string {
  let best: string | undefined;
  let bestMedian = Infinity;
  for (const arm of ARMS) {
    if (arm.kind !== "prior") continue;
    const runs = calibrationRuns.filter((r) => r.arm === arm.arm);
    if (runs.length === 0) continue;
    const m = median(runs.map((r) => r.trainMse));
    if (best === undefined || m < bestMedian) {
      best = arm.arm;
      bestMedian = m;
    }
  }
  if (best === undefined) {
    throw new Error("no calibration runs for any prior arm");
  }
  return best;
}

/** Options for {@link runStudy}. */
export interface StudyOptions {
  codeVersion?: string;
  validationSeedCount?: number;
  validationBaseSeed?: number;
  calibrationSeedCount?: number;
  budgetRecords?: number;
  populationSize?: number;
  settings?: Partial<StudySettings>;
}

interface Failure {
  arm: string;
  seed: number;
  phase: "calibration" | "validation";
  message: string;
}

const CRITERIA =
  "benefit iff the paired-bootstrap 95% CI of (arm - control) holdout MSE lies below 0, the median holdout MSE is lower, and the upper-quartile (lower-quartile performance) holdout MSE is lower; harm iff the CI lies above 0; otherwise no-benefit. Confirmatory test: the one cell chosen on calibration seeds. All other cells are exploratory.";

function seedsFrom(base: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => base + i);
}

/** Run the calibration then the validation phase and summarise. */
export function runStudy(options: StudyOptions = {}) {
  const settings: StudySettings = {
    ...DEFAULT_SETTINGS,
    ...options.settings,
    ...(options.budgetRecords === undefined
      ? {}
      : { budgetRecords: options.budgetRecords }),
    ...(options.populationSize === undefined
      ? {}
      : { populationSize: options.populationSize }),
  };
  validateSettings(settings);
  const calibrationSeeds = seedsFrom(
    CALIBRATION_BASE_SEED,
    options.calibrationSeedCount ?? CALIBRATION_SEED_COUNT,
  );
  const validationSeeds = seedsFrom(
    options.validationBaseSeed ?? VALIDATION_BASE_SEED,
    options.validationSeedCount ?? VALIDATION_SEED_COUNT,
  );
  const corpus = buildStudyCorpus(
    CORPUS_SEED,
    settings.trainRecords,
    settings.holdoutRecords,
  );
  const failures: Failure[] = [];

  const phase = (
    name: "calibration" | "validation",
    seeds: number[],
    s: StudySettings,
  ): ArmRun[] => {
    const runs: ArmRun[] = [];
    for (const arm of ARMS) {
      for (const seed of seeds) {
        try {
          runs.push(runArm(arm, seed, s, corpus));
        } catch (error) {
          failures.push({
            arm: arm.arm,
            seed,
            phase: name,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return runs;
  };

  const calibrationRuns = phase(
    "calibration",
    calibrationSeeds,
    settings,
  );
  const chosenCell = chooseCell(calibrationRuns);
  const threshold = median(
    calibrationRuns.filter((r) => r.arm === "control").map((r) => r.trainMse),
  );
  const calibrationRecords = calibrationRuns.reduce(
    (sum, r) => sum + r.recordsScored,
    0,
  );
  const validationRuns = phase("validation", validationSeeds, {
    ...settings,
    threshold,
  });

  const runsOf = (arm: string) => validationRuns.filter((r) => r.arm === arm);
  const control = runsOf("control");
  const compare = (arm: string) => {
    const runs = runsOf(arm);
    const seeds = new Set(runs.map((r) => r.seed));
    const paired = control.filter((r) => seeds.has(r.seed));
    const cSeeds = new Set(paired.map((r) => r.seed));
    if (paired.length === 0) return null;
    return compareToControl(paired, runs.filter((r) => cSeeds.has(r.seed)));
  };
  const priorArms = ARMS.filter((a) => a.kind === "prior").map((a) => a.arm);
  const mean = (v: number[]) =>
    v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
  const perArm = ARMS.map(({ arm }) => {
    const runs = runsOf(arm);
    const reached = runs.filter((r) => r.recordsToThreshold !== null);
    return {
      arm,
      n: runs.length,
      medianHoldout: runs.length ? median(runs.map((r) => r.holdoutMse)) : null,
      upperQuartileHoldout: runs.length
        ? quantile(runs.map((r) => r.holdoutMse), 0.75)
        : null,
      medianTrain: runs.length ? median(runs.map((r) => r.trainMse)) : null,
      medianRecordsToThreshold: reached.length
        ? median(reached.map((r) => r.recordsToThreshold as number))
        : null,
      reachedThreshold: reached.length,
      stalled: runs.filter((r) => r.stalled).length,
      meanInitialInDegree: mean(runs.map((r) => r.initial.meanHiddenInDegree)),
      meanInitialFanOut: mean(runs.map((r) => r.initial.meanInputFanOut)),
    };
  });

  const expectedRuns = ARMS.length *
    (calibrationSeeds.length + validationSeeds.length);
  return {
    manifest: {
      issue: 4160,
      codeVersion: options.codeVersion ?? "unknown",
      neatAiVersion: (denoConfig as { version: string }).version,
      denoVersion: Deno.version.deno,
      corpusSeed: CORPUS_SEED,
      inputs: INPUTS,
      hidden: HIDDEN,
      settings,
      inDegrees: IN_DEGREES,
      fanOuts: FAN_OUTS,
      calibrationSeeds,
      validationSeeds,
      bootstrap: { resamples: BOOTSTRAP_RESAMPLES, seed: BOOTSTRAP_SEED },
      criteria: CRITERIA,
      selfLoops: {
        status: "swept",
        arm: SELF_LOOP_ARM,
        path:
          "recurrent: forwardOnly false, feedbackLoop true, disableRandomSamples true; state cleared before every score",
        reason:
          "the grid cells run on the forward-only path (the production default); self-loops are tested only on the already-supported recurrent path, as one exploratory arm: the control topology plus a self-loop on every hidden neuron",
      },
      paper:
        "arXiv 2610.33498 not read; the method is this repository's reading of the issue",
    },
    calibration: {
      runs: calibrationRuns,
      chosenCell,
      threshold,
      records: calibrationRecords,
    },
    validation: { runs: validationRuns },
    confirmatory: { arm: chosenCell, comparison: compare(chosenCell) },
    exploratory: priorArms.map((arm) => ({ arm, comparison: compare(arm) })),
    selfLoop: { arm: SELF_LOOP_ARM, comparison: compare(SELF_LOOP_ARM) },
    perArm,
    coverage: {
      expectedRuns,
      completedRuns: calibrationRuns.length + validationRuns.length,
      failures,
    },
  };
}
