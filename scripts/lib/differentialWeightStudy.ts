/**
 * Differential-weight offspring and delayed population contraction — the
 * research harness for Issue #4156.
 *
 * The issue asks two questions and one cross-check, and this module is built so
 * each is answered by a number rather than an impression:
 *
 * - **Does a differential-weight (DE/rand/1/bin) offspring help?** A share of
 *   each generation's offspring is built weight-only from three donors in the
 *   target's species instead of by crossover and mutation.
 * - **Does delaying population contraction help?** The existing adaptive shrink
 *   rule ({@link computeAdaptivePopulationSize}) is held back until a fixed
 *   share of the record budget has been spent.
 * - **Does it matter whether locally refined descendants re-enter the
 *   population?** Production trains a creature and the trained descendant
 *   re-enters; the `@isolated` arms keep it out of breeding but let it compete
 *   for the creature that ships.
 *
 * ## What is real and what is a stand-in
 *
 * Real: the creatures, the crossover and mutation operators, speciation with a
 * real {@link Genus}, the plateau detector, and the adaptive sizing rule.
 *
 * Stand-ins, as in {@link ./preSelectionAB.ts}:
 *
 * - **The corpus** is a small deterministic regression scored in-process, not
 *   the production corpus behind the Rust scorer. Cost is counted in **records
 *   charged**, which is what the real corpus charges for.
 * - **Backpropagation** is replaced by {@link refineWeights}: a handful of
 *   Gaussian weight-and-bias perturbations of the best creature, each scored on
 *   the training split and charged to the budget. It is the same *role* (a
 *   costly local improvement of a good creature) not the same optimiser.
 * - **Behavioural diversity** is the mean pairwise RMS difference of outputs
 *   over a small probe set. It is measured, never charged, and never steers.
 *
 * Every decision is made on the training split. The holdout split is read
 * exactly once per run, at the end, to score the creature that ships.
 *
 * A measurement harness, not a production code path: nothing under `src/`
 * imports it.
 *
 * @module differentialWeightStudy
 */

import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Mutator } from "@neat/Mutator.ts";
import { Genus } from "@neat/Genus.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { computeAdaptivePopulationSize } from "@neat/AdaptivePopulationSizer.ts";
import { DEFAULT_ADAPTIVE_POPULATION_CONFIG } from "@config/AdaptivePopulationConfig.ts";
import { detectPlateau } from "@neat/PlateauDetector.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  type RandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import {
  type ABRecord,
  breedOffspring,
  buildCorpus,
  DEFAULT_AB_SETTINGS,
  scoreCreature,
  seedPopulation,
} from "./preSelectionAB.ts";
import { median } from "./rankFidelity.ts";

// ---------------------------------------------------------------------------
// Predeclared constants
// ---------------------------------------------------------------------------

/** First validation seed. The validation seeds are `base .. base + count - 1`. */
export const VALIDATION_BASE_SEED = 4156;
/** How many validation seeds the study runs. */
export const VALIDATION_SEED_COUNT = 30;
/** First calibration seed — a range disjoint from the validation seeds. */
export const CALIBRATION_BASE_SEED = 94156;
/** How many calibration seeds set the time-to-target threshold. */
export const CALIBRATION_SEED_COUNT = 5;
/** Seed of the one corpus every run scores against. */
export const CORPUS_SEED = 4156;
/** Bootstrap resamples for every confidence interval. */
export const BOOTSTRAP_RESAMPLES = 10_000;
/** Seed of the bootstrap's own generator. */
export const BOOTSTRAP_SEED = 4156;

/** Everything one run is set up with. Explicit so a run is reproducible. */
export interface StudySettings {
  /** Records in the training split — the cost of one evaluation. */
  readonly trainRecords: number;
  /** Records in the holdout split, read once per run at the end. */
  readonly holdoutRecords: number;
  /** Leading training records the behavioural-diversity probe activates. */
  readonly diversityProbeRecords: number;
  /** Base population size. */
  readonly populationSize: number;
  /** Creatures carried into the next generation unchanged. */
  readonly elitism: number;
  /** Records charged in total, across evaluations and refinement. */
  readonly recordBudget: number;
  /** Share of each generation's offspring slots given to DE offspring. */
  readonly deFraction: number;
  /** DE scale factor `F`. */
  readonly deF: number;
  /** DE crossover rate `CR`. */
  readonly deCR: number;
  /** Share of `recordBudget` that must be spent before contraction may begin. */
  readonly contractionDelayFraction: number;
  /**
   * Species diversity (species count over population size) above which the
   * existing adaptive rule shrinks the population on a plateau. The production
   * default is 0.8, but a 3-seed pilot showed 1.3-2.3 species per 24
   * creatures, so the shrink branch never fired and the contraction arms were
   * identical to their controls. `0` makes the existing rule contract on every
   * post-delay plateau, bounded below by `minPopulationFraction` (0.5); the rule's grow branch,
   * which would pre-empt the shrink at low diversity, is disabled. Must
   * be in `[0, 1)`.
   */
  readonly contractionHighDiversityThreshold: number;
  /** Plateau window, in generations. */
  readonly plateauWindow: number;
  /** Improvement rate under which the window counts as a plateau. */
  readonly plateauMinImprovement: number;
  /** Perturbed candidates the refinement stand-in scores each generation. */
  readonly refinementCandidates: number;
  /** Standard deviation of the refinement perturbation. */
  readonly refinementSigma: number;
}

/** The settings the full study runs with. */
export const DEFAULT_STUDY_SETTINGS: StudySettings = Object.freeze({
  trainRecords: 400,
  holdoutRecords: 400,
  diversityProbeRecords: 64,
  populationSize: 24,
  elitism: 2,
  recordBudget: 240_000,
  deFraction: 0.2,
  deF: 0.5,
  deCR: 0.9,
  contractionDelayFraction: 0.5,
  contractionHighDiversityThreshold: 0,
  plateauWindow: 5,
  plateauMinImprovement: 0.01,
  refinementCandidates: 4,
  refinementSigma: 0.1,
});

/**
 * Refuse settings that would make a run meaningless, naming the field.
 *
 * @throws {Error} Naming the first offending field.
 */
export function validateSettings(s: StudySettings): void {
  const positiveInts: (keyof StudySettings)[] = [
    "trainRecords",
    "holdoutRecords",
    "diversityProbeRecords",
    "populationSize",
    "elitism",
    "recordBudget",
    "plateauWindow",
    "refinementCandidates",
  ];
  for (const field of positiveInts) {
    const value = s[field];
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${field} must be a positive integer, got ${value}`);
    }
  }
  if (s.elitism >= s.populationSize) {
    throw new Error(
      `elitism (${s.elitism}) must be below populationSize (${s.populationSize})`,
    );
  }
  if (!(s.deFraction >= 0 && s.deFraction <= 1)) {
    throw new Error(`deFraction must be in [0, 1], got ${s.deFraction}`);
  }
  if (!(s.deF > 0 && s.deF <= 2)) {
    throw new Error(`deF must be in (0, 2], got ${s.deF}`);
  }
  if (!(s.deCR >= 0 && s.deCR <= 1)) {
    throw new Error(`deCR must be in [0, 1], got ${s.deCR}`);
  }
  if (!(s.contractionDelayFraction >= 0 && s.contractionDelayFraction <= 1)) {
    throw new Error(
      `contractionDelayFraction must be in [0, 1], got ${s.contractionDelayFraction}`,
    );
  }
  if (
    !(s.contractionHighDiversityThreshold >= 0 &&
      s.contractionHighDiversityThreshold < 1)
  ) {
    throw new Error(
      `contractionHighDiversityThreshold must be in [0, 1), got ${s.contractionHighDiversityThreshold}`,
    );
  }
  if (!Number.isFinite(s.plateauMinImprovement)) {
    throw new Error(
      `plateauMinImprovement must be finite, got ${s.plateauMinImprovement}`,
    );
  }
  if (!(s.refinementSigma > 0) || !Number.isFinite(s.refinementSigma)) {
    throw new Error(
      `refinementSigma must be a positive number, got ${s.refinementSigma}`,
    );
  }
  if (s.diversityProbeRecords > s.trainRecords) {
    throw new Error(
      `diversityProbeRecords (${s.diversityProbeRecords}) must not exceed trainRecords (${s.trainRecords})`,
    );
  }
  if (s.recordBudget < s.trainRecords * s.populationSize) {
    throw new Error(
      `recordBudget (${s.recordBudget}) must cover one generation: trainRecords * populationSize = ${
        s.trainRecords * s.populationSize
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// Data splits
// ---------------------------------------------------------------------------

/** The three views of the corpus a run uses. */
export interface StudySplits {
  /** Every decision is made on this. */
  readonly train: readonly ABRecord[];
  /** Read once, at the end, to judge the creature that ships. */
  readonly holdout: readonly ABRecord[];
  /** Leading training records; behavioural diversity is measured on these. */
  readonly probe: readonly ABRecord[];
}

/**
 * Build the splits. The same corpus serves every run seed, so seeds differ in
 * the search and not in the question.
 */
export function buildSplits(settings: StudySettings): StudySplits {
  const corpus = buildCorpus({
    ...DEFAULT_AB_SETTINGS,
    seed: CORPUS_SEED,
    corpusRecords: settings.trainRecords + settings.holdoutRecords,
  });
  const train = corpus.slice(0, settings.trainRecords);
  const holdout = corpus.slice(settings.trainRecords);
  return {
    train,
    holdout,
    probe: train.slice(0, settings.diversityProbeRecords),
  };
}

// ---------------------------------------------------------------------------
// Weight genes
// ---------------------------------------------------------------------------

type Exported = ReturnType<Creature["exportJSON"]>;

/** One weight or bias inside an export, addressable by a stable key. */
interface GeneRef {
  readonly key: string;
  get(): number;
  set(value: number): void;
}

/**
 * The tunable genes of an export: the bias of every hidden and output neuron
 * (by neuron uuid) and the weight of every synapse (by endpoint uuids and
 * role). Constant neurons carry no bias gene.
 */
function listGenes(exported: Exported): GeneRef[] {
  const genes: GeneRef[] = [];
  for (const neuron of exported.neurons) {
    if (neuron.type === "constant" || neuron.uuid === undefined) continue;
    genes.push({
      key: `bias|${neuron.uuid}`,
      get: () => neuron.bias,
      set: (value) => {
        neuron.bias = value;
      },
    });
  }
  for (const synapse of exported.synapses) {
    if (synapse.fromUUID === undefined || synapse.toUUID === undefined) {
      continue;
    }
    genes.push({
      key: `weight|${synapse.fromUUID}|${synapse.toUUID}|${synapse.type ?? ""}`,
      get: () => synapse.weight,
      set: (value) => {
        synapse.weight = value;
      },
    });
  }
  return genes;
}

/** Build a creature from an export, shedding everything that is not content. */
function creatureFromExport(exported: Exported): Creature {
  delete (exported as { memetic?: unknown }).memetic;
  delete (exported as { uuid?: unknown }).uuid;
  delete (exported as { score?: unknown }).score;
  const child = Creature.fromJSON(exported);
  delete child.score;
  CreatureUtil.makeUUID(child);
  return child;
}

/** What {@link deWeightOffspring} built. */
export interface DeOffspring {
  readonly child: Creature;
  /** Genes the target shares with all three donors. */
  readonly homologousGenes: number;
  /** Genes whose value was replaced. */
  readonly genesChanged: number;
}

/**
 * Weight-only DE/rand/1/bin across homologous genes.
 *
 * A gene is homologous when the target, `a`, `b` and `c` all carry it. For each
 * one, with probability `CR` — and always for one randomly chosen gene — the
 * child takes `a + F * (b - c)`; every other gene keeps the target's value.
 * Topology, squashes and neuron uuids are the target's. No parent is modified.
 *
 * @returns The child, or `undefined` when no gene is shared by all four.
 */
export function deWeightOffspring(
  target: Creature,
  a: Creature,
  b: Creature,
  c: Creature,
  F: number,
  CR: number,
  rng: RandomNumberGenerator,
): DeOffspring | undefined {
  const exported = target.exportJSON();
  const targetGenes = listGenes(exported);
  const donors = [a, b, c].map((donor) => {
    const values = new Map<string, number>();
    for (const gene of listGenes(donor.exportJSON())) {
      values.set(gene.key, gene.get());
    }
    return values;
  });
  const homologous = targetGenes.filter((gene) =>
    donors.every((values) => values.has(gene.key))
  );
  if (homologous.length === 0) return undefined;

  const jRand = Math.floor(rng.random() * homologous.length);
  let genesChanged = 0;
  for (let i = 0; i < homologous.length; i++) {
    const gene = homologous[i];
    if (!(rng.random() < CR || i === jRand)) continue;
    const value = donors[0].get(gene.key)! +
      F * (donors[1].get(gene.key)! - donors[2].get(gene.key)!);
    if (!Number.isFinite(value)) continue;
    gene.set(value);
    genesChanged++;
  }
  return {
    child: creatureFromExport(exported),
    homologousGenes: homologous.length,
    genesChanged,
  };
}

/** A standard normal draw by Box-Muller, from the harness generator. */
function gaussian(rng: RandomNumberGenerator): number {
  const u1 = Math.max(rng.random(), 1e-12);
  const u2 = rng.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** What {@link refineWeights} found. */
export interface Refinement {
  /** The best candidate, scored, when it beat the parent; else `undefined`. */
  readonly best: Creature | undefined;
  /** Candidates scored. */
  readonly candidatesScored: number;
}

/**
 * Local-refinement stand-in for production backprop training.
 *
 * Builds `candidates` Gaussian weight-and-bias perturbations of `parent`, scores
 * each with `score` (the caller's callback charges the records), and returns
 * the best only if it beats the parent's own score. The parent is not modified.
 *
 * @param score - Returns a higher-is-better score for a candidate.
 */
export function refineWeights(
  parent: Creature,
  candidates: number,
  sigma: number,
  rng: RandomNumberGenerator,
  score: (candidate: Creature) => number,
): Refinement {
  const parentScore = parent.score ?? -Infinity;
  let best: Creature | undefined;
  let bestScore = parentScore;
  for (let i = 0; i < candidates; i++) {
    const exported = parent.exportJSON();
    for (const gene of listGenes(exported)) {
      gene.set(gene.get() + sigma * gaussian(rng));
    }
    const candidate = creatureFromExport(exported);
    const value = score(candidate);
    candidate.score = value;
    if (value > bestScore) {
      best = candidate;
      bestScore = value;
    }
  }
  return { best, candidatesScored: candidates };
}

// ---------------------------------------------------------------------------
// Delayed contraction
// ---------------------------------------------------------------------------

/** Inputs to {@link contractedSize}. */
export interface ContractionInput {
  readonly basePopulationSize: number;
  readonly currentSize: number;
  readonly speciesCount: number;
  /** Best score per generation so far, higher is better. */
  readonly scoreHistory: number[];
  readonly recordsCharged: number;
  readonly recordBudget: number;
  readonly settings: Pick<
    StudySettings,
    | "contractionDelayFraction"
    | "contractionHighDiversityThreshold"
    | "plateauWindow"
    | "plateauMinImprovement"
  >;
}

/**
 * The delayed-contraction rule: the existing adaptive shrink, never growing,
 * and only once `contractionDelayFraction` of the budget has been spent.
 */
export function contractedSize(args: ContractionInput): number {
  const { settings } = args;
  if (
    args.recordsCharged < settings.contractionDelayFraction * args.recordBudget
  ) {
    return args.currentSize;
  }
  const { onPlateau } = detectPlateau(
    args.scoreHistory,
    settings.plateauWindow,
    settings.plateauMinImprovement,
  );
  const proposed = computeAdaptivePopulationSize(
    args.basePopulationSize,
    args.currentSize,
    args.speciesCount,
    onPlateau,
    {
      ...DEFAULT_ADAPTIVE_POPULATION_CONFIG,
      enabled: true,
      highDiversityThreshold: settings.contractionHighDiversityThreshold,
      // The rule's grow branch is checked first and fires below 0.3 species
      // diversity; with a handful of species it would pre-empt every shrink.
      // Growth is discarded by the `Math.min` below anyway, so disabling the
      // branch only lets the shrink branch be reached.
      lowDiversityThreshold: 0,
      minCreaturesPerWorker: 0,
    },
  );
  return Math.min(args.currentSize, proposed);
}

// ---------------------------------------------------------------------------
// Behavioural diversity
// ---------------------------------------------------------------------------

/**
 * Mean pairwise RMS difference of outputs over the probe records. Creatures
 * whose outputs are not finite are left out rather than poisoning the mean.
 * Measurement only: it is never charged and never steers.
 */
export function behaviouralDiversity(
  population: readonly Creature[],
  probe: readonly ABRecord[],
): number {
  const outputs: number[][] = [];
  for (const creature of population) {
    const row = probe.map((record) =>
      creature.activate(record.input, false)[0]
    );
    if (row.every(Number.isFinite)) outputs.push(row);
  }
  if (outputs.length < 2 || probe.length === 0) return 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      let squares = 0;
      for (let r = 0; r < probe.length; r++) {
        const delta = outputs[i][r] - outputs[j][r];
        squares += delta * delta;
      }
      sum += Math.sqrt(squares / probe.length);
      pairs++;
    }
  }
  return sum / pairs;
}

// ---------------------------------------------------------------------------
// Arms
// ---------------------------------------------------------------------------

/** One cell of the experiment. */
export interface StudyArm {
  readonly name: string;
  /** Part of each generation's offspring is DE offspring. */
  readonly de: boolean;
  /** Population contraction is allowed, after the delay. */
  readonly delayedContraction: boolean;
  /** Refined descendants join the next population. */
  readonly refinementReenters: boolean;
}

function makeArms(): readonly StudyArm[] {
  const arms: StudyArm[] = [];
  for (const reenter of [true, false]) {
    const suffix = reenter ? "reenter" : "isolated";
    for (
      const [name, de, delayedContraction] of [
        ["control", false, false],
        ["de", true, false],
        ["contraction", false, true],
        ["de+contraction", true, true],
      ] as const
    ) {
      arms.push(
        Object.freeze({
          name: `${name}@${suffix}`,
          de,
          delayedContraction,
          refinementReenters: reenter,
        }),
      );
    }
  }
  return Object.freeze(arms);
}

/**
 * The 2x2 of DE and delayed contraction, crossed with whether refined
 * descendants re-enter. `control@reenter` is current behaviour.
 */
export const STUDY_ARMS: readonly StudyArm[] = makeArms();

/** One generation of one run. */
export interface TraceEntry {
  readonly generation: number;
  readonly recordsCharged: number;
  readonly bestTrainMse: number;
  /** The target population size the rules asked for this generation. */
  readonly populationSize: number;
  /**
   * The population actually assembled to go into the next generation: elites,
   * any re-entered refinement, DE children and ordinary children. Below
   * `populationSize` only when breeding could not fill every slot (see
   * {@link ArmResult.unfilledSlots}). For the final generation, which breeds
   * nothing, it is the size of the population that was evaluated.
   */
  readonly assembledSize: number;
  readonly speciesCount: number;
  readonly behaviouralDiversity: number;
}

/** What one run produced. */
export interface ArmResult {
  readonly arm: string;
  readonly seed: number;
  /** MSE of the shipped creature on the holdout. Lower is better. */
  readonly finalHoldoutMse: number;
  /** MSE of the shipped creature on the training split. */
  readonly finalTrainMse: number;
  readonly recordsCharged: number;
  /** Training-split scorings charged, population and refinement together. */
  readonly evaluations: number;
  readonly generations: number;
  /** Records charged when best training MSE first reached the target. */
  readonly timeToTargetRecords: number | null;
  readonly contractionEvents: number;
  readonly firstContractionRecords: number | null;
  readonly finalPopulationSize: number;
  /**
   * Offspring slots requested over the run (target size less elites and any
   * re-entered refinement, summed over generations that bred).
   */
  readonly slotsRequested: number;
  /**
   * Slots still empty after DE and the ordinary top-up (which retries up to
   * four times the slots asked for, because `Offspring.breed` can decline). A
   * non-zero value means the population ran below its target size.
   */
  readonly unfilledSlots: number;
  readonly deOffspring: number;
  readonly deFallbacks: number;
  readonly refinementsAccepted: number;
  readonly refinedReentered: number;
  /** Mean over generations 2 onwards; `NaN` when there are none. */
  readonly meanSpeciesCount: number;
  /** Mean over generations 2 onwards; `NaN` when there are none. */
  readonly meanBehaviouralDiversity: number;
  readonly trace: readonly TraceEntry[];
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Run one arm at one seed.
 *
 * @param target - Training MSE the time-to-target is read against, if any.
 */
// deno-lint-ignore require-await
export async function runArm(
  arm: StudyArm,
  settings: StudySettings,
  seed: number,
  splits: StudySplits,
  target?: number,
): Promise<ArmResult> {
  validateSettings(settings);
  // `createNeatConfig` replaces the global generator, so the caller's is
  // captured first and the seed applied after the config exists.
  const previousRng = getRandomNumberGenerator();
  try {
    const config = createNeatConfig({
      populationSize: settings.populationSize,
      elitism: settings.elitism,
      mutationRate: 0.5,
    });
    setRandomNumberGenerator(createSeededRng(seed));
    const rng = createSeededRng(seed + 1_000_003);
    // Synchronous today; the run is `async` so a caller treats it like the
    // other harnesses and nothing changes if a stage becomes asynchronous.
    return runSeededArm(arm, settings, seed, splits, target, config, rng);
  } finally {
    setRandomNumberGenerator(previousRng);
  }
}

/** Finite-scored creatures, best first. */
function byScore(population: Creature[]): void {
  population.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
}

function runSeededArm(
  arm: StudyArm,
  settings: StudySettings,
  seed: number,
  splits: StudySplits,
  target: number | undefined,
  config: ReturnType<typeof createNeatConfig>,
  rng: RandomNumberGenerator,
): ArmResult {
  const { train } = splits;
  const mutator = new Mutator(config);
  let population = seedPopulation(settings, rng);
  let isolatedBest: Creature | undefined;
  let size = settings.populationSize;
  let recordsCharged = 0;
  let evaluations = 0;
  let generation = 0;
  const history: number[] = [];
  const trace: TraceEntry[] = [];
  let timeToTargetRecords: number | null = null;
  let contractionEvents = 0;
  let firstContractionRecords: number | null = null;
  let deOffspring = 0;
  let slotsRequested = 0;
  let unfilledSlots = 0;
  let deFallbacks = 0;
  let refinementsAccepted = 0;
  let refinedReentered = 0;

  const charge = (candidate: Creature): number => {
    const scored = scoreCreature(candidate, train);
    recordsCharged += scored.records;
    evaluations++;
    return scored.score;
  };

  while (recordsCharged < settings.recordBudget) {
    generation++;
    const chargedAtStart = recordsCharged;

    // 1. Evaluate whoever has no score yet, never past the budget.
    let exhausted = false;
    for (const creature of population) {
      if (creature.score !== undefined) continue;
      if (recordsCharged + train.length > settings.recordBudget) {
        exhausted = true;
        break;
      }
      creature.score = charge(creature);
    }
    if (exhausted) {
      population = population.filter((creature) =>
        creature.score !== undefined
      );
    }
    if (population.length === 0) break;

    // 2. Rank and record.
    byScore(population);
    const bestScore = population[0].score ?? -Infinity;
    history.push(bestScore);
    const bestTrainMse = -bestScore;
    if (
      target !== undefined && timeToTargetRecords === null &&
      bestTrainMse <= target
    ) {
      timeToTargetRecords = recordsCharged;
    }

    // 3. Speciate with the production Genus; measure behaviour on the probe.
    const scored = population.filter((creature) =>
      Number.isFinite(creature.score)
    );
    const genus = new Genus();
    for (const creature of scored) genus.addCreature(creature);
    const speciesCount = genus.speciesMap.size;
    const diversity = behaviouralDiversity(scored, splits.probe);

    // 4. Population size for the next generation.
    let nextSize = settings.populationSize;
    if (arm.delayedContraction) {
      nextSize = contractedSize({
        basePopulationSize: settings.populationSize,
        currentSize: size,
        speciesCount,
        scoreHistory: history,
        recordsCharged,
        recordBudget: settings.recordBudget,
        settings,
      });
      if (nextSize < size) {
        contractionEvents++;
        firstContractionRecords ??= recordsCharged;
      }
    }
    size = nextSize;

    trace.push({
      generation,
      recordsCharged,
      bestTrainMse,
      populationSize: size,
      assembledSize: population.length,
      speciesCount,
      behaviouralDiversity: diversity,
    });
    if (exhausted) break;

    // 5. Local refinement of the best creature, charged in every arm.
    let reentered: Creature | undefined;
    const refinementCost = settings.refinementCandidates * train.length;
    if (
      Number.isFinite(bestScore) &&
      recordsCharged + refinementCost <= settings.recordBudget
    ) {
      const refinement = refineWeights(
        population[0],
        settings.refinementCandidates,
        settings.refinementSigma,
        rng,
        charge,
      );
      if (refinement.best !== undefined) {
        refinementsAccepted++;
        if (arm.refinementReenters) {
          reentered = refinement.best;
          refinedReentered++;
        } else if (
          isolatedBest === undefined ||
          (refinement.best.score ?? -Infinity) >
            (isolatedBest.score ?? -Infinity)
        ) {
          isolatedBest = refinement.best;
        }
      }
    }

    // 6. Breed the next population.
    const elites = population.slice(0, settings.elitism);
    const slots = Math.max(
      0,
      size - elites.length - (reentered === undefined ? 0 : 1),
    );
    const nDE = arm.de ? Math.round(settings.deFraction * slots) : 0;
    const deChildren: Creature[] = [];
    let ordinary = slots - nDE;
    for (let i = 0; i < nDE; i++) {
      const parent = population[
        Math.floor(rng.random() * rng.random() * population.length)
      ];
      const child = buildDeChild(parent, genus, settings, rng);
      if (child === undefined) {
        deFallbacks++;
        ordinary++;
      } else {
        deChildren.push(child);
        deOffspring++;
      }
    }
    // `Offspring.breed` can decline a pairing, so top up until the slots are
    // full or four times as many attempts as slots have been made. Without
    // this the non-DE arms ran a smaller population than the DE arms, whose
    // DE slots always fill, and the DE contrast measured population fill.
    const ordinaryChildren: Creature[] = [];
    let attempts = 0;
    const attemptCap = 4 * ordinary;
    while (ordinaryChildren.length < ordinary && attempts < attemptCap) {
      const remaining = ordinary - ordinaryChildren.length;
      attempts += remaining;
      ordinaryChildren.push(
        ...breedOffspring(population, remaining, mutator, config, rng),
      );
    }
    slotsRequested += slots;
    unfilledSlots += ordinary - ordinaryChildren.length;

    // 7. Assemble.
    population = [
      ...elites,
      ...(reentered === undefined ? [] : [reentered]),
      ...deChildren,
      ...ordinaryChildren,
    ];
    trace[trace.length - 1] = {
      ...trace[trace.length - 1],
      assembledSize: population.length,
    };

    // A generation that charged nothing cannot advance the budget.
    if (recordsCharged === chargedAtStart) break;
  }

  // The creature that ships: best on training among the scored population and
  // the isolated refinements. The holdout is read once, here, and nothing
  // above ever saw it.
  const contenders = [
    ...population.filter((creature) => Number.isFinite(creature.score)),
    ...(isolatedBest === undefined ? [] : [isolatedBest]),
  ];
  byScore(contenders);
  const shipped = contenders[0];
  const finalTrainMse = shipped === undefined
    ? Infinity
    : -(shipped.score ?? -Infinity);
  const finalHoldoutMse = shipped === undefined
    ? Infinity
    : -scoreCreature(shipped, splits.holdout).score;

  const later = trace.filter((entry) => entry.generation >= 2);
  return {
    arm: arm.name,
    seed,
    finalHoldoutMse,
    finalTrainMse,
    recordsCharged,
    evaluations,
    generations: trace.length,
    timeToTargetRecords,
    contractionEvents,
    firstContractionRecords,
    finalPopulationSize: size,
    slotsRequested,
    unfilledSlots,
    deOffspring,
    deFallbacks,
    refinementsAccepted,
    refinedReentered,
    meanSpeciesCount: mean(later.map((entry) => entry.speciesCount)),
    meanBehaviouralDiversity: mean(
      later.map((entry) => entry.behaviouralDiversity),
    ),
    trace,
  };
}

/** A DE child of `parent` from three distinct species-mates, or `undefined`. */
function buildDeChild(
  parent: Creature,
  genus: Genus,
  settings: StudySettings,
  rng: RandomNumberGenerator,
): Creature | undefined {
  if (parent.uuid === undefined) return undefined;
  const key = genus.creatureToSpeciesMap.get(parent.uuid);
  const species = key === undefined ? undefined : genus.speciesMap.get(key);
  if (species === undefined) return undefined;
  const pool = species.creatures.filter((creature) =>
    creature !== parent && creature.uuid !== parent.uuid &&
    Number.isFinite(creature.score)
  );
  if (pool.length < 3) return undefined;
  // Partial Fisher-Yates: three distinct donors.
  for (let i = 0; i < 3; i++) {
    const j = i + Math.floor(rng.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return deWeightOffspring(
    parent,
    pool[0],
    pool[1],
    pool[2],
    settings.deF,
    settings.deCR,
    rng,
  )?.child;
}

/**
 * The time-to-target threshold: the median final training MSE of the
 * calibration runs.
 *
 * @throws {Error} On an empty set.
 */
export function calibrateTarget(results: readonly ArmResult[]): number {
  return median(results.map((result) => result.finalTrainMse));
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** A paired comparison of two arms over the same seeds. */
export interface PairedComparison {
  readonly n: number;
  /** Mean of `arm - control`; negative favours the arm (lower MSE). */
  readonly meanDiff: number;
  readonly ci95: readonly [number, number];
  /** Seeds where the arm's value was strictly lower. */
  readonly wins: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * sorted.length)),
  );
  return sorted[index];
}

function pairedLengths(arm: readonly number[], control: readonly number[]) {
  if (arm.length !== control.length) {
    throw new Error(
      `paired samples differ in length: ${arm.length} vs ${control.length}`,
    );
  }
  if (arm.length === 0) throw new Error("paired comparison of zero seeds");
  return arm.length;
}

/**
 * Percentile bootstrap, over seed indices, of the mean paired difference
 * `arm - control`.
 *
 * @throws {Error} On a length mismatch or no seeds.
 */
export function pairedComparison(
  arm: readonly number[],
  control: readonly number[],
  resamples: number,
  seed: number,
): PairedComparison {
  const n = pairedLengths(arm, control);
  const diffs = arm.map((value, i) => value - control[i]);
  const rng = createSeededRng(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += diffs[Math.floor(rng.random() * n)];
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return {
    n,
    meanDiff: mean(diffs),
    ci95: [percentile(means, 0.025), percentile(means, 0.975)],
    wins: diffs.filter((diff) => diff < 0).length,
  };
}

function sampleSd(values: readonly number[]): number {
  if (values.length < 2) return Number.NaN;
  const m = mean(values);
  const ss = values.reduce((sum, value) => sum + (value - m) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

/**
 * Ratio of the arm's sample SD to the control's, with a paired percentile
 * bootstrap interval. Resamples with a zero control SD are discarded.
 *
 * @throws {Error} On a length mismatch or no seeds.
 */
export function sdRatio(
  arm: readonly number[],
  control: readonly number[],
  resamples: number,
  seed: number,
): { ratio: number; ci95: readonly [number, number] } {
  const n = pairedLengths(arm, control);
  const rng = createSeededRng(seed);
  const ratios: number[] = [];
  for (let r = 0; r < resamples; r++) {
    const a: number[] = [];
    const c: number[] = [];
    for (let i = 0; i < n; i++) {
      const index = Math.floor(rng.random() * n);
      a.push(arm[index]);
      c.push(control[index]);
    }
    const ratio = sampleSd(a) / sampleSd(c);
    if (Number.isFinite(ratio)) ratios.push(ratio);
  }
  ratios.sort((x, y) => x - y);
  return {
    ratio: sampleSd(arm) / sampleSd(control),
    ci95: [percentile(ratios, 0.025), percentile(ratios, 0.975)],
  };
}

/** The bar an arm must clear to be called a benefit. Fixed before the run. */
export const SUCCESS_CRITERIA = Object.freeze({
  /** The upper end of the CI on the MSE difference must be below this. */
  maxCiUpper: 0,
  /** Share of seeds on which the arm must beat the control. */
  minWinFraction: 0.6,
  /** Behavioural diversity relative to the control must be at least this. */
  minDiversityRatio: 0.8,
});

/** The shape of {@link SUCCESS_CRITERIA}. */
export type SuccessCriteria = typeof SUCCESS_CRITERIA;

/** The three possible readings of a contrast. */
export type Verdict = "benefit" | "harm" | "no-benefit";

/**
 * Read a paired comparison against the predeclared criteria.
 *
 * `"benefit"` needs the whole interval below zero, enough wins and no diversity
 * collapse; `"harm"` is the whole interval above zero; anything else is
 * `"no-benefit"`.
 */
export function verdict(
  comparison: PairedComparison,
  diversityRatio: number,
  criteria: SuccessCriteria,
): Verdict {
  if (
    comparison.ci95[1] < criteria.maxCiUpper &&
    comparison.wins / comparison.n >= criteria.minWinFraction &&
    diversityRatio >= criteria.minDiversityRatio
  ) {
    return "benefit";
  }
  if (comparison.ci95[0] > 0) return "harm";
  return "no-benefit";
}

/** One predeclared comparison of an arm with its control. */
export interface Contrast {
  readonly arm: string;
  readonly control: string;
}

/** The comparisons the study reports, fixed before any run. */
export const PREDECLARED_CONTRASTS: readonly Contrast[] = Object.freeze([
  ...["reenter", "isolated"].flatMap((suffix) =>
    ["de", "contraction", "de+contraction"].map((name) =>
      Object.freeze({
        arm: `${name}@${suffix}`,
        control: `control@${suffix}`,
      })
    )
  ),
  Object.freeze({ arm: "control@isolated", control: "control@reenter" }),
]);
