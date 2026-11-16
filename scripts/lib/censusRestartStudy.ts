/**
 * Offspring-census restarts against stagnation restarts — the research harness
 * for Issue #4157.
 *
 * The question: is a restart that fires when the population has stopped
 * producing genomes it has not seen before (an offspring census, read with a
 * Good-Turing estimate) better than a restart that fires when the best training
 * score has stopped improving (the conventional stagnation trigger), or than no
 * restart at all? Both restart arms take the identical action
 * ({@link partialReseed}); only the trigger differs.
 *
 * ## What is real and what is a stand-in
 *
 * Real: the creatures, crossover and mutation, speciation with a real
 * {@link Genus}, and the plateau detector. Stand-ins, as in
 * {@link ./preSelectionAB.ts}: the corpus is a small deterministic regression
 * scored in-process (cost is counted in records charged), and behavioural
 * diversity is the mean pairwise RMS output difference over a small probe set,
 * measured and never charged.
 *
 * Every decision is made on the training split. The holdout split is read each
 * generation for measurement only and never influences anything.
 *
 * The arXiv paper named in the issue was not fetched; the method is this
 * repository's reading of the issue. The Good-Turing unseen estimate assumes
 * stationary, equal offspring probabilities, which evolution violates, so it is
 * a trigger heuristic and not an accurate estimate of unseen genomes.
 *
 * A measurement harness, not a production code path: nothing under `src/`
 * imports it.
 *
 * @module censusRestartStudy
 */

import type { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Mutator } from "@neat/Mutator.ts";
import { Genus } from "@neat/Genus.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
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
export const VALIDATION_BASE_SEED = 4157;
/** How many validation seeds the study runs. */
export const VALIDATION_SEED_COUNT = 30;
/** First calibration seed — a range disjoint from the validation seeds. */
export const CALIBRATION_BASE_SEED = 94157;
/** How many calibration seeds tune the census setting and set the target. */
export const CALIBRATION_SEED_COUNT = 5;
/** Seed of the one corpus every run scores against. */
export const CORPUS_SEED = 4157;
/** Bootstrap resamples for every confidence interval. */
export const BOOTSTRAP_RESAMPLES = 10_000;
/** Seed of the bootstrap's own generator. */
export const BOOTSTRAP_SEED = 4157;

/** What fires a restart. */
export type RestartTrigger = "none" | "stagnation" | "census";

/** Everything one run is set up with. Explicit so a run is reproducible. */
export interface StudySettings {
  /** Records in the training split — the cost of one evaluation. */
  readonly trainRecords: number;
  /** Records in the holdout split; measurement only. */
  readonly holdoutRecords: number;
  /** Leading training records the behavioural-diversity probe activates. */
  readonly diversityProbeRecords: number;
  /** Population size. */
  readonly populationSize: number;
  /** Creatures carried into the next generation unchanged. */
  readonly elitism: number;
  /** Records charged in total. */
  readonly recordBudget: number;
  /** Fraction of the population replaced by fresh creatures on a restart. */
  readonly reseedFraction: number;
  /** No second restart within this many generations of the last one. */
  readonly restartCooldownGenerations: number;
  /** Plateau window, in generations. */
  readonly plateauWindow: number;
  /** Improvement rate under which the window counts as a plateau. */
  readonly plateauMinImprovement: number;
  /** Weight step of the census key. */
  readonly censusQuantisation: number;
  /** Census window length, in generations. */
  readonly censusWindowGenerations: number;
  /** The census trigger fires when the unseen estimate drops below this. */
  readonly censusUnseenThreshold: number;
}

/** The settings the full study runs with. */
export const DEFAULT_STUDY_SETTINGS: StudySettings = Object.freeze({
  trainRecords: 400,
  holdoutRecords: 400,
  diversityProbeRecords: 64,
  populationSize: 24,
  elitism: 2,
  recordBudget: 240_000,
  reseedFraction: 0.5,
  restartCooldownGenerations: 5,
  plateauWindow: 5,
  plateauMinImprovement: 0.01,
  censusQuantisation: 0.05,
  censusWindowGenerations: 4,
  censusUnseenThreshold: 0.5,
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
    "restartCooldownGenerations",
    "plateauWindow",
    "censusWindowGenerations",
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
  if (!(s.reseedFraction > 0 && s.reseedFraction <= 1)) {
    throw new Error(
      `reseedFraction must be in (0, 1], got ${s.reseedFraction}`,
    );
  }
  if (!Number.isFinite(s.plateauMinImprovement)) {
    throw new Error(
      `plateauMinImprovement must be finite, got ${s.plateauMinImprovement}`,
    );
  }
  if (!(s.censusQuantisation > 0) || !Number.isFinite(s.censusQuantisation)) {
    throw new Error(
      `censusQuantisation must be a positive number, got ${s.censusQuantisation}`,
    );
  }
  if (!(s.censusUnseenThreshold > 0 && s.censusUnseenThreshold < 1)) {
    throw new Error(
      `censusUnseenThreshold must be in (0, 1), got ${s.censusUnseenThreshold}`,
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

/** The views of the corpus a run uses. */
export interface StudySplits {
  /** Every decision is made on this. */
  readonly train: readonly ABRecord[];
  /** Read each generation for measurement only; never guides anything. */
  readonly holdout: readonly ABRecord[];
  /** Leading training records; behavioural diversity is measured on these. */
  readonly probe: readonly ABRecord[];
}

/** Build the splits. The same corpus serves every run seed. */
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
// Census
// ---------------------------------------------------------------------------

/**
 * The census identity of a creature: its topology hash joined with every
 * non-input bias and every synapse weight, each quantised to a step of `q`.
 *
 * Two creatures whose weights differ by less than `q / 2` everywhere (and who
 * do not straddle a rounding boundary) share a key; a different topology never
 * does. The creature is not modified.
 */
export function censusKey(creature: Creature, q: number): string {
  const exported = creature.exportJSON();
  const step = (value: number) => Math.round(value / q);
  const biases = exported.neurons
    .filter((neuron) => neuron.uuid !== undefined)
    .map((neuron) => `${neuron.uuid}=${step(neuron.bias)}`)
    .sort();
  const weights = exported.synapses
    .map((synapse) =>
      `${synapse.fromUUID},${synapse.toUUID},${synapse.type ?? ""}=${
        step(synapse.weight)
      }`
    )
    .sort();
  return `${CreatureUtil.getTopologyHash(creature)}|${biases.join(";")}|${
    weights.join(";")
  }`;
}

/** What {@link CensusWindow.estimate} reports. */
export interface CensusEstimate {
  /** Offspring in the window. */
  readonly n: number;
  /** Distinct (species, key) identities among them. */
  readonly distinct: number;
  /** Identities seen exactly once. */
  readonly singletons: number;
  /** Good-Turing: singletons / n; 1 when the window is empty. */
  readonly unseen: number;
  /** (n - distinct) / n; 0 when the window is empty. */
  readonly collisionRate: number;
}

/**
 * A rolling species window of offspring identities. The identity of an
 * offspring is the pair (species key, census key).
 */
export class CensusWindow {
  readonly #entries: { generation: number; identity: string }[] = [];

  constructor(readonly windowGenerations: number) {}

  /** Record one offspring bred in `generation`, then drop entries too old. */
  record(generation: number, speciesKey: string, key: string): void {
    this.#entries.push({ generation, identity: `${speciesKey}\u0000${key}` });
    this.expire(generation);
  }

  /** Drop entries older than the window as of `generation`. */
  expire(generation: number): void {
    const oldest = generation - this.windowGenerations + 1;
    let keep = 0;
    for (const entry of this.#entries) {
      if (entry.generation >= oldest) this.#entries[keep++] = entry;
    }
    this.#entries.length = keep;
  }

  /** Number of distinct generations with at least one entry in the window. */
  spannedGenerations(): number {
    return new Set(this.#entries.map((entry) => entry.generation)).size;
  }

  /** Forget everything (after a restart). */
  clear(): void {
    this.#entries.length = 0;
  }

  estimate(): CensusEstimate {
    const counts = new Map<string, number>();
    for (const entry of this.#entries) {
      counts.set(entry.identity, (counts.get(entry.identity) ?? 0) + 1);
    }
    const n = this.#entries.length;
    if (n === 0) {
      return { n: 0, distinct: 0, singletons: 0, unseen: 1, collisionRate: 0 };
    }
    let singletons = 0;
    for (const count of counts.values()) if (count === 1) singletons++;
    return {
      n,
      distinct: counts.size,
      singletons,
      unseen: singletons / n,
      collisionRate: (n - counts.size) / n,
    };
  }
}

// ---------------------------------------------------------------------------
// Restart action
// ---------------------------------------------------------------------------

/**
 * Partial reseed, the action both restart arms share.
 *
 * Keeps the champion (best score), the most structurally novel other creature
 * (rarest topology hash in `population`; ties go to the better score), then the
 * next best until `(1 - reseedFraction) * size` are kept; the rest of `size`
 * is filled with fresh creatures from {@link seedPopulation}. Kept creatures
 * are the same objects, never modified. `population` is not modified.
 */
export function partialReseed(
  population: readonly Creature[],
  size: number,
  reseedFraction: number,
  rng: RandomNumberGenerator,
): Creature[] {
  const ranked = [...population].sort((a, b) =>
    (b.score ?? -Infinity) - (a.score ?? -Infinity)
  );
  const keepCount = Math.min(
    ranked.length,
    Math.max(Math.min(2, size), Math.round((1 - reseedFraction) * size)),
  );
  const kept: Creature[] = [];
  if (ranked.length > 0) kept.push(ranked[0]);
  if (ranked.length >= 2 && keepCount >= 2) {
    const counts = new Map<string, number>();
    for (const creature of ranked) {
      const hash = CreatureUtil.getTopologyHash(creature);
      counts.set(hash, (counts.get(hash) ?? 0) + 1);
    }
    let novel: Creature | undefined;
    for (const creature of ranked.slice(1)) {
      if (
        novel === undefined ||
        counts.get(CreatureUtil.getTopologyHash(creature))! <
          counts.get(CreatureUtil.getTopologyHash(novel))!
      ) {
        novel = creature;
      }
    }
    if (novel !== undefined) kept.push(novel);
  }
  for (const creature of ranked) {
    if (kept.length >= keepCount) break;
    if (!kept.includes(creature)) kept.push(creature);
  }
  const fresh = Math.max(0, size - kept.length);
  return [...kept, ...seedPopulation({ populationSize: fresh }, rng)];
}

// ---------------------------------------------------------------------------
// Behavioural diversity
// ---------------------------------------------------------------------------

/**
 * Mean pairwise RMS difference of outputs over the probe records. Creatures
 * whose outputs are not finite are left out. Measurement only.
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
  readonly name: RestartTrigger;
  readonly restartTrigger: RestartTrigger;
}

/** The three arms. `none` is current behaviour. */
export const STUDY_ARMS: readonly StudyArm[] = Object.freeze(
  (["none", "stagnation", "census"] as const).map((name) =>
    Object.freeze({ name, restartTrigger: name })
  ),
);

/** One generation of one run. */
export interface TraceEntry {
  readonly generation: number;
  readonly recordsCharged: number;
  readonly bestTrainMse: number;
  /** The generation champion's holdout MSE; measurement only. */
  readonly holdoutMse: number;
  readonly species: number;
  readonly diversity: number;
  /** Census unseen estimate after this generation's offspring were recorded. */
  readonly unseen: number;
  readonly collisionRate: number;
  /** A restart was applied in place of breeding this generation. */
  readonly restarted: boolean;
}

/** What one run produced. */
export interface ArmResult {
  readonly arm: string;
  readonly seed: number;
  /** MSE of the champion at the end on the holdout. Lower is better. */
  readonly finalHoldoutMse: number;
  readonly finalTrainMse: number;
  readonly recordsCharged: number;
  readonly evaluations: number;
  readonly generations: number;
  readonly restarts: number;
  readonly firstRestartRecords: number | null;
  /** Records charged when `detectPlateau` first reported a plateau (any arm). */
  readonly firstStagnationSignalRecords: number | null;
  /** `firstRestartRecords - firstStagnationSignalRecords`, if both exist. */
  readonly restartDelayRecords: number | null;
  /** Records charged when a generation champion first met the holdout target. */
  readonly recordsToHoldoutTarget: number | null;
  /** Mean over generations 2 onwards; `NaN` when there are none. */
  readonly meanSpeciesCount: number;
  readonly meanBehaviouralDiversity: number;
  readonly meanUnseenEstimate: number;
  readonly meanCollisionRate: number;
  /** Offspring slots breeding could not fill. */
  readonly unfilledSlots: number;
  readonly wallMs: number;
  readonly trace: readonly TraceEntry[];
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Run one arm at one seed.
 *
 * @param holdoutTarget - Holdout MSE the records-to-target is read against.
 */
// deno-lint-ignore require-await
export async function runArm(
  arm: StudyArm,
  settings: StudySettings,
  seed: number,
  splits: StudySplits,
  holdoutTarget?: number,
): Promise<ArmResult> {
  validateSettings(settings);
  const started = performance.now();
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
    const result = runSeededArm(
      arm,
      settings,
      seed,
      splits,
      holdoutTarget,
      config,
      rng,
    );
    return { ...result, wallMs: performance.now() - started };
  } finally {
    setRandomNumberGenerator(previousRng);
  }
}

function byScore(population: Creature[]): void {
  population.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
}

function runSeededArm(
  arm: StudyArm,
  settings: StudySettings,
  seed: number,
  splits: StudySplits,
  holdoutTarget: number | undefined,
  config: ReturnType<typeof createNeatConfig>,
  rng: RandomNumberGenerator,
): ArmResult {
  const { train } = splits;
  const mutator = new Mutator(config);
  const census = new CensusWindow(settings.censusWindowGenerations);
  let population = seedPopulation(settings, rng);
  let recordsCharged = 0;
  let evaluations = 0;
  let generation = 0;
  const history: number[] = [];
  let historyStart = 0;
  const trace: TraceEntry[] = [];
  let restarts = 0;
  let lastRestartGeneration = -Infinity;
  let firstRestartRecords: number | null = null;
  let firstStagnationSignalRecords: number | null = null;
  let recordsToHoldoutTarget: number | null = null;
  let unfilledSlots = 0;
  let idleGenerations = 0;
  let champion: Creature | undefined;
  let championHoldoutMse = Infinity;

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
      const scored = scoreCreature(creature, train);
      recordsCharged += scored.records;
      evaluations++;
      creature.score = scored.score;
    }
    if (exhausted) {
      population = population.filter((creature) =>
        creature.score !== undefined
      );
    }
    if (population.length === 0) break;

    // 2. Rank and record. The holdout is read for measurement only.
    byScore(population);
    champion = population[0];
    const bestScore = champion.score ?? -Infinity;
    history.push(bestScore);
    championHoldoutMse = -scoreCreature(champion, splits.holdout).score;
    if (
      holdoutTarget !== undefined && recordsToHoldoutTarget === null &&
      championHoldoutMse <= holdoutTarget
    ) {
      recordsToHoldoutTarget = recordsCharged;
    }
    const signal = detectPlateau(
      history,
      settings.plateauWindow,
      settings.plateauMinImprovement,
    ).onPlateau;
    if (signal) firstStagnationSignalRecords ??= recordsCharged;

    // 3. Speciate with the production Genus; measure behaviour on the probe.
    const scored = population.filter((creature) =>
      Number.isFinite(creature.score)
    );
    const genus = new Genus();
    for (const creature of scored) genus.addCreature(creature);
    const species = genus.speciesMap.size;
    const diversity = behaviouralDiversity(scored, splits.probe);

    const entry = {
      generation,
      recordsCharged,
      bestTrainMse: -bestScore,
      holdoutMse: championHoldoutMse,
      species,
      diversity,
      unseen: census.estimate().unseen,
      collisionRate: census.estimate().collisionRate,
      restarted: false,
    };
    if (exhausted) {
      trace.push(entry);
      break;
    }

    // 4. Restart decision. Only the trigger differs between restart arms.
    const cooledDown =
      generation - lastRestartGeneration >= settings.restartCooldownGenerations;
    // Offspring older than the window are stale even when nothing was bred.
    census.expire(generation - 1);
    let restart = false;
    if (cooledDown && Number.isFinite(bestScore)) {
      if (arm.restartTrigger === "stagnation") {
        restart = detectPlateau(
          history.slice(historyStart),
          settings.plateauWindow,
          settings.plateauMinImprovement,
        ).onPlateau;
      } else if (arm.restartTrigger === "census") {
        restart = census.spannedGenerations() >=
            settings.censusWindowGenerations &&
          census.estimate().unseen < settings.censusUnseenThreshold;
      }
    }

    if (restart) {
      restarts++;
      firstRestartRecords ??= recordsCharged;
      lastRestartGeneration = generation;
      historyStart = history.length;
      census.clear();
      population = partialReseed(
        scored,
        settings.populationSize,
        settings.reseedFraction,
        rng,
      );
      trace.push({ ...entry, restarted: true });
    } else {
      // 5. Breed, topping up because `Offspring.breed` can decline a pairing.
      const elites = population.slice(0, settings.elitism);
      const slots = Math.max(0, settings.populationSize - elites.length);
      const children: Creature[] = [];
      let attempts = 0;
      const attemptCap = 4 * slots;
      while (children.length < slots && attempts < attemptCap) {
        const remaining = slots - children.length;
        attempts += remaining;
        children.push(
          ...breedOffspring(population, remaining, mutator, config, rng),
        );
      }
      unfilledSlots += slots - children.length;
      // Every new offspring is recorded under the species it falls in, in
      // every arm, so collision and unseen are measured everywhere.
      for (const child of children) {
        genus.addCreature(child);
        const speciesKey = genus.creatureToSpeciesMap.get(child.uuid!) ?? "";
        census.record(
          generation,
          speciesKey,
          censusKey(child, settings.censusQuantisation),
        );
      }
      const estimate = census.estimate();
      trace.push({
        ...entry,
        unseen: estimate.unseen,
        collisionRate: estimate.collisionRate,
      });
      population = [...elites, ...children];
    }

    // A generation that charged nothing cannot advance the budget. A restart
    // brings in unscored creatures, so it is progress. A converged population
    // whose breeding is declined can still be rescued by a restart arm once
    // its cooldown ends, so those arms idle for a bounded number of
    // generations; `none` has nothing that can change and stops.
    if (restart || recordsCharged !== chargedAtStart) {
      idleGenerations = 0;
    } else {
      idleGenerations++;
      const patience = settings.restartCooldownGenerations +
        settings.plateauWindow + 1;
      if (arm.restartTrigger === "none" || idleGenerations > patience) break;
    }
  }

  const later = trace.filter((e) => e.generation >= 2);
  return {
    arm: arm.name,
    seed,
    finalHoldoutMse: champion === undefined ? Infinity : championHoldoutMse,
    finalTrainMse: champion === undefined
      ? Infinity
      : -(champion.score ?? -Infinity),
    recordsCharged,
    evaluations,
    generations: trace.length,
    restarts,
    firstRestartRecords,
    firstStagnationSignalRecords,
    restartDelayRecords:
      firstRestartRecords === null || firstStagnationSignalRecords === null
        ? null
        : firstRestartRecords - firstStagnationSignalRecords,
    recordsToHoldoutTarget,
    meanSpeciesCount: mean(later.map((e) => e.species)),
    meanBehaviouralDiversity: mean(later.map((e) => e.diversity)),
    meanUnseenEstimate: mean(later.map((e) => e.unseen)),
    meanCollisionRate: mean(later.map((e) => e.collisionRate)),
    unfilledSlots,
    wallMs: 0,
    trace,
  };
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

/** The census settings the calibration seeds sweep, in tie-break order. */
export const CALIBRATION_SWEEP: readonly {
  readonly q: number;
  readonly w: number;
}[] = Object.freeze(
  [0.01, 0.05, 0.2].flatMap((q) => [3, 6].map((w) => Object.freeze({ q, w }))),
);

/** One row of the collision-sensitivity table. */
export interface CalibrationRow {
  readonly q: number;
  readonly w: number;
  readonly medianFinalTrainMse: number;
  readonly medianRestarts: number;
  /** Median over runs that restarted; `null` when none did. */
  readonly medianFirstRestartRecords: number | null;
  readonly meanCollisionRate: number;
  readonly meanUnseenEstimate: number;
}

/** Summarise the calibration runs of one census setting. */
export function summariseCalibration(
  q: number,
  w: number,
  results: readonly ArmResult[],
): CalibrationRow {
  const firsts = results.flatMap((r) =>
    r.firstRestartRecords === null ? [] : [r.firstRestartRecords]
  );
  return {
    q,
    w,
    medianFinalTrainMse: median(results.map((r) => r.finalTrainMse)),
    medianRestarts: median(results.map((r) => r.restarts)),
    medianFirstRestartRecords: firsts.length === 0 ? null : median(firsts),
    meanCollisionRate: mean(results.map((r) => r.meanCollisionRate)),
    meanUnseenEstimate: mean(results.map((r) => r.meanUnseenEstimate)),
  };
}

/**
 * The census setting with the lowest median final training MSE; ties go to the
 * first in sweep order.
 *
 * @throws {Error} On an empty table.
 */
export function chooseCensusSetting(
  rows: readonly CalibrationRow[],
): CalibrationRow {
  if (rows.length === 0) throw new Error("no calibration rows");
  let best = rows[0];
  for (const row of rows) {
    if (row.medianFinalTrainMse < best.medianFinalTrainMse) best = row;
  }
  return best;
}

/**
 * The holdout target: the median final holdout MSE of the `none` arm on the
 * calibration seeds.
 *
 * @throws {Error} On an empty set.
 */
export function calibrateHoldoutTarget(results: readonly ArmResult[]): number {
  return median(results.map((result) => result.finalHoldoutMse));
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

/** One predeclared comparison of an arm with its baseline. */
export interface Contrast {
  readonly arm: string;
  readonly control: string;
}

/** The comparisons the study reports, fixed before any run. */
export const PREDECLARED_CONTRASTS: readonly Contrast[] = Object.freeze([
  Object.freeze({ arm: "stagnation", control: "none" }),
  Object.freeze({ arm: "census", control: "none" }),
  Object.freeze({ arm: "census", control: "stagnation" }),
]);
