/**
 * Offspring admission versus durable lineage contribution — Issue #4163.
 *
 * An opt-in research harness. In a small mutation-only (mu + lambda)
 * evolutionary loop it observes, for every offspring, whether it was initially
 * admitted into the population and whether it (or its descendants) is still
 * there 10, 100 and 1000 generations later. It then compares uniform parent
 * selection with a calibrated, capped 2:1 odds bias toward parents that score
 * well on the calibration split.
 *
 * Nothing under `src/` imports this and no production behaviour changes.
 *
 * ## What is real and what is a stand-in
 *
 * Real: the creatures, the {@link Mutator} operators and repair step (through
 * `breedPair`) and the {@link Genus} speciation. Every individual records its
 * species key ({@link Species.calculateKey}, the key `Genus` groups by) at
 * birth, and persistence is broken down by that species as well as by founder
 * clade.
 *
 * Stand-ins: the corpus is the small synthetic regression of
 * `lineageTargetingStudy.ts`. Cost is counted in records scored. The harness
 * measures the **mechanism**, not how a production-scale run behaves.
 *
 * ## Leakage policy
 *
 * Survivor selection reads the train split. The calibrated parent bias reads
 * the calibration split. The holdout split is evaluated once, at the final
 * generation, for reporting only; it is never charged and never read by any
 * mutation, selection or parent-weighting decision.
 *
 * ## Causality caveat
 *
 * Lineage and admission associations are predictive correlations, not causal
 * value: an offspring that persists may simply descend from a good founder.
 *
 * @module admissionPersistenceStudy
 */

import type { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Genus } from "@neat/Genus.ts";
import { Species } from "@neat/Species.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import {
  behaviouralDiversity,
  breedPair,
  createBreedContext,
  DEFAULT_STUDY_SETTINGS,
  mean,
  type Split,
  type StratumErrors,
  stratumErrors,
  type StudyRecord,
  type StudySettings,
} from "./lineageTargetingStudy.ts";
import { seedPopulation } from "./preSelectionAB.ts";

/** How many calibration records form the behavioural-diversity probe. */
export const PROBE_RECORDS = 64;

/** The sample size fixed in advance: the CLI defaults `--seeds` to this. */
export const PREDECLARED_SEEDS = 20;

/** The first seed of the predeclared range. */
export const PREDECLARED_FIRST_SEED = 4163;

/** How one run is set up. */
export interface AdmissionSettings {
  readonly seed: number;
  /** Records in each of the three splits. */
  readonly recordsPerSplit: number;
  /** N: individuals kept each generation. */
  readonly populationSize: number;
  /** lambda: offspring bred each generation. */
  readonly offspringPerGeneration: number;
  /** G: generations run after the seeded generation 0. */
  readonly generations: number;
  /** Generations after birth at which persistence is read. */
  readonly horizons: readonly number[];
  /** Largest best-to-worst parent odds in the biased arm. */
  readonly oddsCap: number;
  /** Measure diversity every this many generations (and at the last). */
  readonly diversityEvery: number;
}

export const DEFAULT_ADMISSION_SETTINGS: AdmissionSettings = Object.freeze({
  seed: PREDECLARED_FIRST_SEED,
  recordsPerSplit: 100,
  populationSize: 12,
  offspringPerGeneration: 12,
  generations: 1100,
  horizons: Object.freeze([10, 100, 1000]) as readonly number[],
  oddsCap: 2,
  diversityEvery: 50,
});

/** Throw a descriptive error when settings cannot describe a valid run. */
export function validateSettings(settings: AdmissionSettings): void {
  const positiveInt = (name: keyof AdmissionSettings) => {
    const v = settings[name] as number;
    if (!Number.isInteger(v) || v <= 0) {
      throw new Error(`${name} must be a positive integer, got ${v}`);
    }
  };
  positiveInt("recordsPerSplit");
  positiveInt("populationSize");
  positiveInt("offspringPerGeneration");
  positiveInt("generations");
  positiveInt("diversityEvery");
  const { horizons } = settings;
  if (horizons.length === 0) {
    throw new Error("horizons must not be empty");
  }
  horizons.forEach((h, i) => {
    if (!Number.isInteger(h) || h <= 0) {
      throw new Error(`horizons must be positive integers, got ${h}`);
    }
    if (i > 0 && h <= horizons[i - 1]) {
      throw new Error(
        `horizons must be strictly increasing, got ${horizons.join(", ")}`,
      );
    }
  });
  if (!Number.isFinite(settings.oddsCap) || settings.oddsCap < 1) {
    throw new Error(
      `oddsCap must be a finite number >= 1, got ${settings.oddsCap}`,
    );
  }
}

export type AdmissionArm = "uniform" | "biased";

export const ADMISSION_ARMS: readonly AdmissionArm[] = ["uniform", "biased"];

/** What is known about one individual over the run. */
export interface IndividualRecord {
  id: number;
  /** Parent's id; `null` for a generation-0 seed. */
  parent: number | null;
  /** Id of the generation-0 seed this individual descends from. */
  founder: number;
  /** {@link Genus} species key ({@link Species.calculateKey}) at birth. */
  species: string;
  /** Generation of birth; 0 for seeds. */
  birth: number;
  /** 0 for seeds, parent depth + 1 otherwise. */
  depth: number;
  /** Survived the birth selection into the population. */
  admitted: boolean;
  /** 0-based rank among the N survivors at birth selection. */
  admissionRank: number | null;
  /** First generation at which it is no longer in the population. */
  removed: number | null;
  /** In the population at `birth + h`; `null` when censored. */
  survival: Record<number, boolean | null>;
  /** Members at `birth + h` that are it or descend from it; `null` censored. */
  descendants: Record<number, number | null>;
}

/** Product-limit estimate of the probability of surviving beyond each `at`. */
export function kaplanMeier(
  lifetimes: readonly { time: number; event: boolean }[],
  at: readonly number[],
): number[] {
  const eventTimes = [
    ...new Set(lifetimes.filter((l) => l.event).map((l) => l.time)),
  ].sort((a, b) => a - b);
  return at.map((t) => {
    let survival = 1;
    for (const u of eventTimes) {
      if (u > t) break;
      const atRisk = lifetimes.filter((l) => l.time >= u).length;
      const events = lifetimes.filter((l) => l.event && l.time === u).length;
      survival *= 1 - events / atRisk;
    }
    return survival;
  });
}

/** Persistence of the offspring at one horizon. */
export interface HorizonPersistence {
  horizon: number;
  /** Offspring old enough to be read at this horizon. */
  eligible: number;
  /** Offspring too young (born after G - horizon), not counted. */
  censored: number;
  admittedEligible: number;
  survived: number;
  survivedAdmitted: number;
  contributors: number;
  contributorsAdmitted: number;
  survivalRate: number | null;
  survivalRateGivenAdmitted: number | null;
  kmSurvivalGivenAdmitted: number | null;
  contributionRate: number | null;
  contributionRateGivenAdmitted: number | null;
  /** Mean of descendants / N over admitted eligible offspring. */
  meanDescendantShare: number | null;
  byAdmissionQuartile: {
    quartile: number;
    eligible: number;
    contributionRate: number | null;
  }[];
  byFounder: {
    founder: number;
    offspring: number;
    admitted: number;
    contributors: number;
  }[];
  /** Eligible offspring grouped by their Genus species at birth. */
  bySpecies: SpeciesPersistence[];
}

/** Persistence at one horizon of the eligible offspring of one species. */
export interface SpeciesPersistence {
  /** {@link Genus} species key at birth; the same key in every seed and arm. */
  species: string;
  offspring: number;
  admitted: number;
  survived: number;
  survivedAdmitted: number;
  contributors: number;
  contributorsAdmitted: number;
  survivalRateGivenAdmitted: number | null;
  contributionRateGivenAdmitted: number | null;
}

/**
 * Persistence counts of `eligible` grouped by species at birth, sorted by
 * offspring count (descending) then key.
 */
export function speciesPersistence(
  eligible: readonly IndividualRecord[],
  horizon: number,
): SpeciesPersistence[] {
  const groups = new Map<string, IndividualRecord[]>();
  for (const r of eligible) {
    const own = groups.get(r.species);
    if (own === undefined) groups.set(r.species, [r]);
    else own.push(r);
  }
  return [...groups.entries()].map(([species, own]) => {
    const admitted = own.filter((r) => r.admitted);
    const survives = (r: IndividualRecord) => r.survival[horizon] === true;
    const contributes = (r: IndividualRecord) =>
      (r.descendants[horizon] ?? 0) > 0;
    const survivedAdmitted = admitted.filter(survives).length;
    const contributorsAdmitted = admitted.filter(contributes).length;
    return {
      species,
      offspring: own.length,
      admitted: admitted.length,
      survived: own.filter(survives).length,
      survivedAdmitted,
      contributors: own.filter(contributes).length,
      contributorsAdmitted,
      survivalRateGivenAdmitted: ratio(survivedAdmitted, admitted.length),
      contributionRateGivenAdmitted: ratio(
        contributorsAdmitted,
        admitted.length,
      ),
    };
  }).sort((a, b) =>
    b.offspring - a.offspring ||
    (a.species < b.species ? -1 : a.species > b.species ? 1 : 0)
  );
}

export interface PersistenceSummary {
  offspring: number;
  admitted: number;
  admissionRate: number | null;
  horizons: HorizonPersistence[];
}

const ratio = (n: number, d: number): number | null => d === 0 ? null : n / d;

/** Summarise admission and persistence from the individual records. */
export function persistenceSummary(
  records: readonly IndividualRecord[],
  settings: Pick<
    AdmissionSettings,
    "generations" | "populationSize" | "horizons"
  >,
): PersistenceSummary {
  const offspring = records.filter((r) => r.birth >= 1);
  const admittedOffspring = offspring.filter((r) => r.admitted);
  const horizons = settings.horizons.map((horizon): HorizonPersistence => {
    const eligible = offspring.filter((r) => r.survival[horizon] !== null);
    const admittedEligible = eligible.filter((r) => r.admitted);
    const survived = eligible.filter((r) => r.survival[horizon] === true);
    const survivedAdmitted = admittedEligible.filter((r) =>
      r.survival[horizon] === true
    );
    const contributes = (r: IndividualRecord) =>
      (r.descendants[horizon] ?? 0) > 0;
    const contributors = eligible.filter(contributes);
    const contributorsAdmitted = admittedEligible.filter(contributes);
    const lifetimes = admittedOffspring.map((r) => ({
      time: (r.removed ?? settings.generations) - r.birth,
      event: r.removed !== null,
    }));
    const quartiles = [0, 1, 2, 3].map((quartile) => {
      const inQuartile = admittedEligible.filter((r) =>
        Math.floor((r.admissionRank! * 4) / settings.populationSize) ===
          quartile
      );
      return {
        quartile,
        eligible: inQuartile.length,
        contributionRate: ratio(
          inQuartile.filter(contributes).length,
          inQuartile.length,
        ),
      };
    });
    const founders = [...new Set(eligible.map((r) => r.founder))].sort((a, b) =>
      a - b
    );
    return {
      horizon,
      eligible: eligible.length,
      censored: offspring.length - eligible.length,
      admittedEligible: admittedEligible.length,
      survived: survived.length,
      survivedAdmitted: survivedAdmitted.length,
      contributors: contributors.length,
      contributorsAdmitted: contributorsAdmitted.length,
      survivalRate: ratio(survived.length, eligible.length),
      survivalRateGivenAdmitted: ratio(
        survivedAdmitted.length,
        admittedEligible.length,
      ),
      kmSurvivalGivenAdmitted: lifetimes.length === 0
        ? null
        : kaplanMeier(lifetimes, [horizon])[0],
      contributionRate: ratio(contributors.length, eligible.length),
      contributionRateGivenAdmitted: ratio(
        contributorsAdmitted.length,
        admittedEligible.length,
      ),
      meanDescendantShare: admittedEligible.length === 0 ? null : mean(
        admittedEligible.map((r) =>
          (r.descendants[horizon] ?? 0) / settings.populationSize
        ),
      ),
      byAdmissionQuartile: quartiles,
      byFounder: founders.map((founder) => {
        const own = eligible.filter((r) => r.founder === founder);
        return {
          founder,
          offspring: own.length,
          admitted: own.filter((r) => r.admitted).length,
          contributors: own.filter(contributes).length,
        };
      }),
      bySpecies: speciesPersistence(eligible, horizon),
    };
  });
  return {
    offspring: offspring.length,
    admitted: admittedOffspring.length,
    admissionRate: ratio(admittedOffspring.length, offspring.length),
    horizons,
  };
}

/**
 * Parent-selection weights, one per population member.
 *
 * Uniform: all 1. Biased: members are ranked by calibration MSE ascending
 * (ties share the mean rank); with `r` in `[0, 1]` the rank scaled by `n - 1`,
 * the weight is `oddsCap ** (1 - r)`, so the best-to-worst odds are exactly
 * `oddsCap` and never more. Reads only calibration error.
 */
export function parentWeights(
  arm: AdmissionArm,
  calibrationMse: readonly number[],
  oddsCap: number,
): number[] {
  if (!Number.isFinite(oddsCap) || oddsCap < 1) {
    throw new Error(`oddsCap must be a finite number >= 1, got ${oddsCap}`);
  }
  const n = calibrationMse.length;
  if (arm === "uniform") return new Array<number>(n).fill(1);
  const order = calibrationMse.map((v, i) => ({ v, i })).sort((a, b) =>
    a.v === b.v ? a.i - b.i : a.v < b.v ? -1 : 1
  );
  const ranks = new Array<number>(n).fill(0);
  let start = 0;
  while (start < n) {
    let end = start;
    while (end + 1 < n && order[end + 1].v === order[start].v) end++;
    const shared = (start + end) / 2;
    for (let k = start; k <= end; k++) ranks[order[k].i] = shared;
    start = end + 1;
  }
  return ranks.map((rank) => {
    const r = n === 1 ? 0 : rank / (n - 1);
    return oddsCap ** (1 - r);
  });
}

/** One measured generation. */
export interface AdmissionTrace {
  generation: number;
  bestTrainMse: number;
  turnover: number;
  meanDepth: number;
  behaviouralDiversity: number;
  speciesCount: number;
  founderCladesAlive: number;
}

/** What one arm produced for one seed. */
export interface AdmissionArmResult {
  arm: AdmissionArm;
  seed: number;
  generations: number;
  finalTrainMse: number;
  /** Holdout MSE of the best-by-train creature. Reporting only. */
  finalHoldoutMse: number;
  /** Mean holdout MSE of the whole final population. Reporting only. */
  populationHoldoutMse: number;
  /** Train + calibration records of every evaluation; excludes holdout. */
  recordsScored: number;
  holdoutRecords: number;
  /** Diversity-probe activations; measurement only, never charged. */
  diagnosticRecords: number;
  evaluations: number;
  offspring: number;
  admitted: number;
  failures: number;
  firstFailure: string | null;
  meanTurnover: number;
  finalMeanDepth: number;
  maxDepth: number;
  founderCladesAlive: number;
  /** Mean over measured generations >= 1. */
  meanBehaviouralDiversity: number;
  finalBehaviouralDiversity: number;
  finalSpeciesCount: number;
  /** Present so the result fits `pairedComparison`. */
  toTarget: null;
  trace: AdmissionTrace[];
  persistence: PersistenceSummary;
  /** Only with `keepIndividuals`. */
  individuals?: IndividualRecord[];
  /** Only with `keepIndividuals`: parents whose export changed while breeding. */
  modifiedParents?: number;
}

interface Member {
  record: IndividualRecord;
  creature: Creature;
  train: StratumErrors;
  calibration: StratumErrors;
}

/** Order for survivor selection: train MSE, then the older individual. */
function compareMembers(a: Member, b: Member): number {
  if (a.train.overall !== b.train.overall) {
    const d = a.train.overall - b.train.overall;
    if (!Number.isNaN(d)) return d;
  }
  return a.record.birth - b.record.birth || a.record.id - b.record.id;
}

/**
 * Run one arm for one seed.
 *
 * Seeds the global generator (the mutation operators draw from it) and
 * restores the caller's in `finally`.
 */
export function runArm(
  arm: AdmissionArm,
  settings: AdmissionSettings,
  corpus: Record<Split, StudyRecord[]>,
  options: { keepIndividuals?: boolean } = {},
): AdmissionArmResult {
  validateSettings(settings);
  // `createNeatConfig` installs its own generator, so the caller's generator is
  // captured first and restored in `finally`; the context is built before
  // seeding or the same seed would give a different search on every run.
  const previousRng = getRandomNumberGenerator();
  try {
    const studySettings: StudySettings = {
      ...DEFAULT_STUDY_SETTINGS,
      seed: settings.seed,
      recordsPerSplit: settings.recordsPerSplit,
      populationSize: settings.populationSize,
      elitism: 1,
    };
    const ctx = createBreedContext(studySettings, corpus.calibration);
    setRandomNumberGenerator(createSeededRng(settings.seed));
    return runSeeded(arm, settings, corpus, ctx, options.keepIndividuals);
  } finally {
    setRandomNumberGenerator(previousRng);
  }
}

function runSeeded(
  arm: AdmissionArm,
  settings: AdmissionSettings,
  corpus: Record<Split, StudyRecord[]>,
  ctx: ReturnType<typeof createBreedContext>,
  keepIndividuals = false,
): AdmissionArmResult {
  const rng = createSeededRng(settings.seed);
  const { generations: G, populationSize: N, horizons } = settings;
  const probe = corpus.calibration.slice(0, PROBE_RECORDS);
  const records: IndividualRecord[] = [];
  let evalRecords = 0;
  let evaluations = 0;
  let diagnosticRecords = 0;
  let offspring = 0;
  let admittedCount = 0;
  let failures = 0;
  let firstFailure: string | null = null;
  let modifiedParents = 0;
  const trace: AdmissionTrace[] = [];
  const turnovers: number[] = [];

  const newRecord = (
    creature: Creature,
    parent: IndividualRecord | null,
    birth: number,
  ): IndividualRecord => {
    const id = records.length;
    const record: IndividualRecord = {
      id,
      parent: parent?.id ?? null,
      founder: parent?.founder ?? id,
      species: Species.calculateKey(creature),
      birth,
      depth: parent === null ? 0 : parent.depth + 1,
      admitted: parent === null,
      admissionRank: null,
      removed: null,
      survival: {},
      descendants: {},
    };
    for (const h of horizons) {
      const open = birth + h <= G;
      record.survival[h] = open ? false : null;
      record.descendants[h] = open ? 0 : null;
    }
    records.push(record);
    return record;
  };

  const evaluate = (creature: Creature, record: IndividualRecord): Member => {
    const train = stratumErrors(creature, corpus.train);
    const calibration = stratumErrors(creature, corpus.calibration);
    creature.score = -train.overall;
    evalRecords += train.records + calibration.records;
    evaluations++;
    return { record, creature, train, calibration };
  };

  const measure = (generation: number, population: Member[], turn: number) => {
    const creatures = population.map((m) => m.creature);
    const genus = new Genus();
    for (const creature of creatures) {
      if (!Number.isFinite(creature.score)) continue;
      if (creature.uuid === undefined) CreatureUtil.makeUUID(creature);
      genus.addCreature(creature);
    }
    diagnosticRecords += creatures.length * probe.length;
    trace.push({
      generation,
      bestTrainMse: Math.min(...population.map((m) => m.train.overall)),
      turnover: turn,
      meanDepth: mean(population.map((m) => m.record.depth)),
      behaviouralDiversity: behaviouralDiversity(creatures, probe),
      speciesCount: genus.speciesMap.size,
      founderCladesAlive: new Set(population.map((m) => m.record.founder))
        .size,
    });
  };

  let population: Member[] = seedPopulation(settings, rng).map((creature) =>
    evaluate(creature, newRecord(creature, null, 0))
  );
  measure(0, population, 0);

  for (let g = 1; g <= G; g++) {
    const weights = parentWeights(
      arm,
      population.map((m) => m.calibration.overall),
      settings.oddsCap,
    );
    const total = weights.reduce((s, w) => s + w, 0);
    const children: Member[] = [];
    for (let k = 0; k < settings.offspringPerGeneration; k++) {
      let pick = rng.random() * total;
      let index = 0;
      while (index < weights.length - 1 && pick >= weights[index]) {
        pick -= weights[index];
        index++;
      }
      const parent = population[index];
      try {
        const before = keepIndividuals
          ? JSON.stringify(parent.creature.exportJSON())
          : "";
        const bred = breedPair(
          "ordinary",
          parent.creature,
          parent,
          ctx,
          g,
          1,
        )[0];
        if (
          keepIndividuals &&
          before !== JSON.stringify(parent.creature.exportJSON())
        ) modifiedParents++;
        children.push(
          evaluate(bred.child, newRecord(bred.child, parent.record, g)),
        );
        offspring++;
      } catch (error) {
        failures++;
        firstFailure ??= error instanceof Error ? error.message : String(error);
      }
    }

    const pool = [...population, ...children].sort(compareMembers);
    const survivors = pool.slice(0, N);
    const kept = new Set(survivors);
    survivors.forEach((m, rank) => {
      if (m.record.birth === g) {
        m.record.admitted = true;
        m.record.admissionRank = rank;
        admittedCount++;
      }
    });
    for (const m of pool) {
      if (!kept.has(m)) m.record.removed = g;
    }
    population = survivors;

    for (const member of population) {
      let cursor: IndividualRecord | null = member.record;
      while (cursor !== null) {
        const h = g - cursor.birth;
        if (horizons.includes(h)) {
          cursor.descendants[h] = (cursor.descendants[h] ?? 0) + 1;
          if (cursor === member.record) cursor.survival[h] = true;
        }
        cursor = cursor.parent === null ? null : records[cursor.parent];
      }
    }

    const turn = survivors.filter((m) => m.record.birth === g).length / N;
    turnovers.push(turn);
    if (g % settings.diversityEvery === 0 || g === G) {
      measure(g, population, turn);
    }
  }

  const best = population[0];
  const holdouts = population.map((m) =>
    stratumErrors(m.creature, corpus.holdout)
  );
  const holdoutRecords = holdouts.reduce((s, h) => s + h.records, 0);
  const last = trace[trace.length - 1];
  const result: AdmissionArmResult = {
    arm,
    seed: settings.seed,
    generations: G,
    finalTrainMse: best.train.overall,
    finalHoldoutMse: holdouts[0].overall,
    populationHoldoutMse: mean(holdouts.map((h) => h.overall)),
    recordsScored: evalRecords,
    holdoutRecords,
    diagnosticRecords,
    evaluations,
    offspring,
    admitted: admittedCount,
    failures,
    firstFailure,
    meanTurnover: mean(turnovers),
    finalMeanDepth: last.meanDepth,
    maxDepth: Math.max(...records.map((r) => r.depth)),
    founderCladesAlive: last.founderCladesAlive,
    meanBehaviouralDiversity: mean(
      trace.filter((t) => t.generation >= 1).map((t) => t.behaviouralDiversity),
    ),
    finalBehaviouralDiversity: last.behaviouralDiversity,
    finalSpeciesCount: last.speciesCount,
    toTarget: null,
    trace,
    persistence: persistenceSummary(records, settings),
  };
  if (keepIndividuals) {
    result.individuals = records;
    result.modifiedParents = modifiedParents;
  }
  return result;
}
