/**
 * Neighbour-only island exchange against global champion broadcast — Issue
 * #4159.
 *
 * This is a **hypothesis test, not an established improvement**. Nothing here
 * says a ring is better than a broadcast; the harness exists so the claim is
 * either supported or refuted on pre-declared terms ({@link PREDECLARED})
 * rather than argued from intuition. A result of `no-benefit` or `worse` is a
 * perfectly good outcome.
 *
 * Three arms run from identical starting islands under an identical evaluation
 * budget:
 *
 * - `none` — isolated islands, no exchange at all.
 * - `ring` — each island sends topology-diverse Pareto members to its
 *   neighbour `i -> (i + 1) mod islands`, calibrated to the same number of
 *   transfers per round as the broadcast.
 * - `broadcast` — the existing behaviour and the control: the global champion
 *   by train score is copied to every other island.
 *
 * ## What is real and what is a stand-in
 *
 * Real: the creatures, the crossover (`Offspring.breed`, reached through
 * `breedOffspring`), the {@link Mutator}, and {@link geneticCompatibility}.
 * Stand-in: the corpus is the synthetic regression of `preSelectionAB`
 * (`buildCorpus` / `scoreCreature`). Cost is counted in **records scored**,
 * which is what the real corpus charges for. Transport is the creature JSON
 * export/import round-trip that the fleet's file exchange moves, measured in
 * bytes.
 *
 * ## What it cannot tell you
 *
 * How production-size creatures (thousands of neurons) behave, and how real
 * transport over the private fleet repository behaves (latency, staleness,
 * partial pulls). It measures the exchange policy, not the network.
 *
 * Everything is synchronous so the global generator seeded by
 * {@link runArmSeed} is never restored part-way through a run.
 *
 * A measurement harness, not a production code path: nothing under `src/`
 * imports it.
 *
 * @module islandExchangeStudy
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Mutator } from "@neat/Mutator.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
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

/**
 * Run `fn` with `crypto.randomUUID` replaced by a seeded RFC-4122 v4-shaped
 * generator, restoring the original afterwards (also when `fn` throws).
 *
 * Harness-only; production code is untouched. It exists because neuron UUIDs
 * are drawn from `crypto.randomUUID` and the canonical orderings make a run's
 * search depend on them, so without it two runs of one seed differ.
 */
export function withSeededUuids<T>(seed: number, fn: () => T): T {
  const rng = createSeededRng(seed);
  const hex = (n: number) => Math.floor(rng.random() * n).toString(16);
  const generate = (): `${string}-${string}-${string}-${string}-${string}` => {
    let out = "";
    for (let i = 0; i < 32; i++) {
      if (i === 12) out += "4";
      else if (i === 16) out += (8 + Math.floor(rng.random() * 4)).toString(16);
      else out += hex(16);
    }
    return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${
      out.slice(16, 20)
    }-${out.slice(20)}`;
  };
  const previous = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", {
    value: generate,
    configurable: true,
    writable: true,
  });
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete (crypto as unknown as Record<string, unknown>).randomUUID;
    } else Object.defineProperty(crypto, "randomUUID", previous);
  }
}

/** The exchange policies compared. */
export type ExchangeArm = "none" | "ring" | "broadcast";

/** Every arm, in report order. */
export const EXCHANGE_ARMS: readonly ExchangeArm[] = Object.freeze([
  "none",
  "ring",
  "broadcast",
] as ExchangeArm[]);

/** The existing behaviour is the control every arm is compared against. */
export const CONTROL_ARM_NAME: ExchangeArm = "broadcast";

/** How one seed of the study is set up. */
export interface IslandStudySettings {
  /** Seed for every random draw and the synthetic corpus. */
  readonly seed: number;
  /** Number of islands (at least 2). */
  readonly islands: number;
  /** Creatures per island, constant throughout. */
  readonly islandPopulation: number;
  /** Creatures carried unchanged into the next generation, per island. */
  readonly elitism: number;
  /** Generations each island runs. */
  readonly generations: number;
  /** An exchange round happens every this many generations. */
  readonly cadence: number;
  /** Global champions the broadcast copies per round (the comm budget). */
  readonly champions: number;
  /** Records in the train split — what selection scores against. */
  readonly trainRecords: number;
  /** Records in the calibration split — picks the creature to report. */
  readonly calibrationRecords: number;
  /** Records in the holdout split — reported, never consulted. */
  readonly holdoutRecords: number;
  /** Final inter-island distance below this counts as a collapse. */
  readonly collapseThreshold: number;
}

/** Defaults for the full study. */
export const DEFAULT_ISLAND_SETTINGS: IslandStudySettings = Object.freeze({
  seed: 4159,
  islands: 6,
  islandPopulation: 10,
  elitism: 2,
  generations: 24,
  cadence: 4,
  champions: 1,
  trainRecords: 300,
  calibrationRecords: 150,
  holdoutRecords: 300,
  collapseThreshold: 0.05,
});

function requireInteger(name: string, value: number, minimum: number): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}, got ${value}`);
  }
}

/**
 * Refuse settings the study cannot run honestly.
 *
 * @throws {Error} Naming the offending field.
 */
export function validateIslandSettings(s: IslandStudySettings): void {
  requireInteger("islands", s.islands, 2);
  requireInteger("islandPopulation", s.islandPopulation, 2);
  requireInteger("elitism", s.elitism, 1);
  if (s.elitism >= s.islandPopulation) {
    throw new Error(
      `elitism must be < islandPopulation, got ${s.elitism} >= ${s.islandPopulation}`,
    );
  }
  requireInteger("generations", s.generations, 1);
  requireInteger("cadence", s.cadence, 1);
  requireInteger("champions", s.champions, 1);
  if (s.champions > s.islandPopulation - s.elitism) {
    throw new Error(
      `champions must be <= islandPopulation - elitism (${
        s.islandPopulation - s.elitism
      }), got ${s.champions}`,
    );
  }
  requireInteger("trainRecords", s.trainRecords, 1);
  requireInteger("calibrationRecords", s.calibrationRecords, 1);
  requireInteger("holdoutRecords", s.holdoutRecords, 1);
  if (
    !Number.isFinite(s.collapseThreshold) || s.collapseThreshold < 0 ||
    s.collapseThreshold > 1
  ) {
    throw new Error(
      `collapseThreshold must be in [0, 1], got ${s.collapseThreshold}`,
    );
  }
}

/** The three disjoint record sets of one seed. */
export interface Splits {
  train: ABRecord[];
  calibration: ABRecord[];
  holdout: ABRecord[];
}

/** One corpus sliced train / calibration / holdout, disjoint by construction. */
export function buildSplits(settings: IslandStudySettings): Splits {
  const all = buildCorpus({
    ...DEFAULT_AB_SETTINGS,
    seed: settings.seed,
    corpusRecords: settings.trainRecords + settings.calibrationRecords +
      settings.holdoutRecords,
  });
  const t = settings.trainRecords;
  const c = t + settings.calibrationRecords;
  return {
    train: all.slice(0, t),
    calibration: all.slice(t, c),
    holdout: all.slice(c),
  };
}

/**
 * Migrants per ring edge `i -> (i + 1) % islands` for one exchange round.
 *
 * Every edge gets `floor(budget / islands)`; the remainder goes one each to
 * consecutive edges starting at `(round * remainder) % islands`, so over
 * `islands` consecutive rounds every edge receives the same total and every
 * round sums to exactly `budget`.
 */
export function ringAllocation(
  islands: number,
  budget: number,
  round: number,
): number[] {
  if (!Number.isInteger(islands) || islands < 2) {
    throw new Error(`islands must be an integer >= 2, got ${islands}`);
  }
  if (!Number.isInteger(budget) || budget < 0) {
    throw new Error(`budget must be a non-negative integer, got ${budget}`);
  }
  if (!Number.isInteger(round) || round < 0) {
    throw new Error(`round must be a non-negative integer, got ${round}`);
  }
  const base = Math.floor(budget / islands);
  const remainder = budget % islands;
  const out = new Array<number>(islands).fill(base);
  const offset = (round * remainder) % islands;
  for (let k = 0; k < remainder; k++) out[(offset + k) % islands]++;
  return out;
}

/** The communication budget: transfers per round the broadcast makes. */
export function broadcastTransfersPerRound(
  settings: IslandStudySettings,
): number {
  return settings.champions * (settings.islands - 1);
}

/** Neurons plus synapses — the size the Pareto front minimises. */
export function creatureSize(c: Creature): number {
  return c.neurons.length + c.synapses.length;
}

function hasScore(c: Creature): boolean {
  return c.score !== undefined && Number.isFinite(c.score);
}

/**
 * Non-dominated members on (score maximised, size minimised), best score
 * first. Creatures without a finite score are excluded.
 */
export function paretoFront(island: readonly Creature[]): Creature[] {
  const scored = island.filter(hasScore);
  const front = scored.filter((b) =>
    !scored.some((a) => {
      if (a === b) return false;
      const as = a.score as number;
      const bs = b.score as number;
      const sa = creatureSize(a);
      const sb = creatureSize(b);
      return as >= bs && sa <= sb && (as > bs || sa < sb);
    })
  );
  return front.sort((a, b) =>
    (b.score as number) - (a.score as number) ||
    creatureSize(a) - creatureSize(b)
  );
}

/** Topology distance in `[0, 1]`: `1 - geneticCompatibility`. */
export function topologyDistance(a: Creature, b: Creature): number {
  return 1 - geneticCompatibility(a, b);
}

function byScoreDesc(a: Creature, b: Creature): number {
  return (b.score ?? -Infinity) - (a.score ?? -Infinity);
}

/**
 * Choose up to `count` members of `source` to send to `destination`.
 *
 * Pareto-front members come first, each pick maximising its minimum topology
 * distance to the destination plus what is already picked (ties to the higher
 * score); the rest of the source follows in score order only once the front is
 * exhausted. A candidate whose `uuid` the destination already holds is never
 * sent. Mutates nothing.
 */
export function pickDiverseMigrants(
  source: readonly Creature[],
  destination: readonly Creature[],
  count: number,
): Creature[] {
  const held = new Set<string>();
  for (const d of destination) if (d.uuid !== undefined) held.add(d.uuid);
  const front = paretoFront(source);
  const inFront = new Set(front);
  const rest = source.filter((c) => !inFront.has(c)).sort(byScoreDesc);
  const usable = (c: Creature) => c.uuid === undefined || !held.has(c.uuid);
  const frontPool = front.filter(usable);
  const restPool = rest.filter(usable);
  const picked: Creature[] = [];

  const take = (c: Creature) => {
    picked.push(c);
    if (c.uuid !== undefined) held.add(c.uuid);
  };

  while (picked.length < count && frontPool.length > 0) {
    let bestIndex = -1;
    let bestDistance = -Infinity;
    for (let i = 0; i < frontPool.length; i++) {
      const candidate = frontPool[i];
      if (
        candidate.uuid !== undefined &&
        picked.some((p) => p.uuid === candidate.uuid)
      ) {
        continue;
      }
      let minimum = Infinity;
      for (const other of destination) {
        minimum = Math.min(minimum, topologyDistance(candidate, other));
      }
      for (const other of picked) {
        minimum = Math.min(minimum, topologyDistance(candidate, other));
      }
      // Frontier is score-descending, so a strict > keeps the higher score on ties.
      if (minimum > bestDistance) {
        bestDistance = minimum;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    take(frontPool[bestIndex]);
    frontPool.splice(bestIndex, 1);
  }
  for (const c of restPool) {
    if (picked.length >= count) break;
    if (c.uuid !== undefined && picked.some((p) => p.uuid === c.uuid)) continue;
    take(c);
  }
  return picked;
}

/**
 * Move a creature the way the fleet's file exchange does: through its JSON
 * export and back. The source is never changed.
 */
export function transport(
  creature: Creature,
): { copy: Creature; bytes: number } {
  const json = JSON.stringify(creature.exportJSON());
  const copy = Creature.fromJSON(JSON.parse(json));
  copy.score = creature.score;
  // loadFrom discards the creature-level uuid (AGENTS.md, "Creature UUID"), so
  // it is recomputed from the content that actually arrived.
  CreatureUtil.makeUUID(copy);
  return { copy, bytes: new TextEncoder().encode(json).length };
}

/** What one exchange round did. */
export interface ExchangeOutcome {
  islands: Creature[][];
  transfers: number;
  bytes: number;
  transportMs: number;
}

/**
 * Run one exchange round over islands that are each sorted by score descending.
 *
 * Every migrant is planned from the snapshot first and applied afterwards, so
 * the exchange is synchronous: nothing received this round is forwarded this
 * round. Incoming copies replace the destination's worst members; the size is
 * constant and only copies actually applied are counted.
 */
export function exchange(
  arm: ExchangeArm,
  islands: readonly Creature[][],
  settings: IslandStudySettings,
  round: number,
  clock: () => number,
): ExchangeOutcome {
  const n = islands.length;
  const plan: Creature[][] = islands.map(() => []);

  if (arm === "broadcast") {
    const all = islands.flatMap((members, index) =>
      members.map((creature) => ({ creature, index }))
    ).filter((e) => hasScore(e.creature));
    all.sort((a, b) => byScoreDesc(a.creature, b.creature));
    const champions: typeof all = [];
    const seen = new Set<string>();
    for (const entry of all) {
      if (champions.length >= settings.champions) break;
      const uuid = entry.creature.uuid;
      if (uuid !== undefined) {
        if (seen.has(uuid)) continue;
        seen.add(uuid);
      }
      champions.push(entry);
    }
    for (const { creature, index } of champions) {
      for (let d = 0; d < n; d++) {
        if (d === index) continue;
        if (
          islands[d].some((m) =>
            m.uuid !== undefined && m.uuid === creature.uuid
          )
        ) continue;
        plan[d].push(creature);
      }
    }
  } else if (arm === "ring") {
    const allocation = ringAllocation(
      n,
      broadcastTransfersPerRound(settings),
      round,
    );
    for (let i = 0; i < n; i++) {
      if (allocation[i] <= 0) continue;
      const d = (i + 1) % n;
      plan[d].push(
        ...pickDiverseMigrants(islands[i], islands[d], allocation[i]),
      );
    }
  }

  let transfers = 0;
  let bytes = 0;
  let transportMs = 0;
  const result = islands.map((members, d) => {
    const room = Math.max(0, members.length - settings.elitism);
    const incoming = plan[d].slice(0, room);
    if (incoming.length === 0) return [...members];
    const copies: Creature[] = [];
    for (const migrant of incoming) {
      const started = clock();
      const moved = transport(migrant);
      transportMs += clock() - started;
      copies.push(moved.copy);
      bytes += moved.bytes;
      transfers++;
    }
    const kept = members.slice(0, members.length - copies.length);
    return [...kept, ...copies].sort(byScoreDesc);
  });
  return { islands: result, transfers, bytes, transportMs };
}

/**
 * Extra crossover attempts to fill a generation when crossover refuses some
 * pairs. Slots still empty afterwards are filled with mutation-only copies and
 * counted as `mutationFills`, so the evaluation budget is exactly equal.
 */
const MAX_BREED_ATTEMPTS = 3;

/** Mutation draws tried before a fill is declared unable to differ. */
const MAX_FILL_ATTEMPTS = 50;

/**
 * A mutation-only fill that is guaranteed to be a new creature.
 *
 * `Mutator.mutate` only touches a creature with probability `mutationRate`, and
 * an operator can also find nothing to change, so one pass may hand back an
 * exact copy of the parent. That copy would take the parent's content uuid,
 * lose its score and be evaluated again for a result the island already holds.
 * The fill is therefore redrawn until its content uuid differs from the
 * parent's, and `redraws` reports how many draws that took. `mutator` should
 * have a mutation rate of 1; if no draw changes the parent within
 * {@link MAX_FILL_ATTEMPTS} the call throws rather than hand back a clone.
 */
export function makeMutantFill(
  parent: Creature,
  mutator: Mutator,
): { fill: Creature; redraws: number } {
  const parentUuid = CreatureUtil.makeUUID(parent);
  for (let attempt = 0; attempt < MAX_FILL_ATTEMPTS; attempt++) {
    const fill = Creature.fromJSON(
      JSON.parse(JSON.stringify(parent.exportJSON())),
    );
    delete fill.score;
    mutator.mutate([fill]);
    delete fill.score;
    delete fill.uuid;
    if (CreatureUtil.makeUUID(fill) !== parentUuid) {
      return { fill, redraws: attempt };
    }
  }
  throw new Error(
    `no mutation changed the parent in ${MAX_FILL_ATTEMPTS} draws; ` +
      "refusing to hand back an unmutated clone",
  );
}

/** One generation of one run. */
export interface GenerationTrace {
  generation: number;
  meanBestTrainScore: number;
  interIslandDistance: number;
  transfers: number;
}

/** Everything one arm produced for one seed. */
export interface ArmSeedResult {
  arm: ExchangeArm;
  seed: number;
  holdoutMse: number;
  calibrationMse: number;
  reportedUuid: string;
  recordsCharged: number;
  trainRecordsCharged: number;
  calibrationRecordsCharged: number;
  evaluationMs: number;
  transfers: number;
  bytes: number;
  transportMs: number;
  finalInterIslandDistance: number;
  meanInterIslandDistance: number;
  withinIslandDistance: number;
  collapsed: boolean;
  mutationFills: number;
  /** Mutation draws rejected because they left the parent's content unchanged. */
  fillRedraws: number;
  generations: GenerationTrace[];
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function meanPairwise(creatures: readonly Creature[]): number {
  if (creatures.length < 2) return 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < creatures.length; i++) {
    for (let j = i + 1; j < creatures.length; j++) {
      sum += topologyDistance(creatures[i], creatures[j]);
      pairs++;
    }
  }
  return sum / pairs;
}

function loadIslands(initial: readonly CreatureExport[][]): Creature[][] {
  return initial.map((island) =>
    island.map((json) => {
      const c = Creature.fromJSON(JSON.parse(JSON.stringify(json)));
      CreatureUtil.makeUUID(c);
      return c;
    })
  );
}

/** Calibration-select among finalists, then read the holdout once. */
function selectAndReport(
  finalists: readonly Creature[],
  splits: Splits,
  clock: () => number,
) {
  let calibrationRecords = 0;
  let evaluationMs = 0;
  let best: Creature | undefined;
  let bestScore = -Infinity;
  for (const finalist of finalists) {
    const started = clock();
    const scored = scoreCreature(finalist, splits.calibration);
    evaluationMs += clock() - started;
    calibrationRecords += scored.records;
    if (best === undefined || scored.score > bestScore) {
      best = finalist;
      bestScore = scored.score;
    }
  }
  if (best === undefined) throw new Error("no finalists to report");
  // Not charged and never consulted by any decision.
  const holdoutMse = -scoreCreature(best, splits.holdout).score;
  return {
    reported: best,
    calibrationMse: -bestScore,
    holdoutMse,
    calibrationRecords,
    evaluationMs,
  };
}

/** The body of {@link runArmSeed}, with the uuid generator already seeded. */
function runArmSeedBody(
  arm: ExchangeArm,
  settings: IslandStudySettings,
  splits: Splits,
  initialIslands: readonly CreatureExport[][],
  clock: () => number,
): ArmSeedResult {
  validateIslandSettings(settings);
  // Crossover and mutation draw from the global generator; seed it so the arms
  // run the same search, and restore it whatever happens.
  const previousRng = getRandomNumberGenerator();
  setRandomNumberGenerator(createSeededRng(settings.seed));
  try {
    const rng = createSeededRng(settings.seed + 1);
    const config = createNeatConfig({
      populationSize: settings.islandPopulation,
      elitism: settings.elitism,
      mutationRate: 0.5,
      // createNeatConfig installs its own global generator (unseeded unless
      // told otherwise), silently replacing the one set above.
      rng: createSeededRng(settings.seed),
    });
    const mutator = new Mutator(config);
    // Fills are always mutated: a fill that kept its parent's content would be
    // an exact clone scored again for nothing (see makeMutantFill).
    const fillMutator = new Mutator({ ...config, mutationRate: 1 });
    let islands = loadIslands(initialIslands);
    let trainRecordsCharged = 0;
    let evaluationMs = 0;
    let transfers = 0;
    let bytes = 0;
    let transportMs = 0;
    let mutationFills = 0;
    let fillRedraws = 0;
    const traces: GenerationTrace[] = [];
    const slots = settings.islandPopulation - settings.elitism;

    for (let g = 1; g <= settings.generations; g++) {
      // Migrants keep their train score (same train split), so receiving one
      // costs no evaluation.
      for (const island of islands) {
        for (const creature of island) {
          if (creature.score !== undefined) continue;
          const started = clock();
          const scored = scoreCreature(creature, splits.train);
          evaluationMs += clock() - started;
          creature.score = scored.score;
          trainRecordsCharged += scored.records;
        }
        island.sort(byScoreDesc);
      }

      let roundTransfers = 0;
      if (
        arm !== "none" && g % settings.cadence === 0 && g < settings.generations
      ) {
        const outcome = exchange(
          arm,
          islands,
          settings,
          g / settings.cadence - 1,
          clock,
        );
        islands = outcome.islands;
        roundTransfers = outcome.transfers;
        transfers += outcome.transfers;
        bytes += outcome.bytes;
        transportMs += outcome.transportMs;
      }

      traces.push({
        generation: g,
        meanBestTrainScore: mean(islands.map((i) => i[0].score ?? -Infinity)),
        interIslandDistance: meanPairwise(islands.map((i) => i[0])),
        transfers: roundTransfers,
      });

      if (g < settings.generations) {
        islands = islands.map((island) => {
          const elites = island.slice(0, settings.elitism);
          const offspring = breedOffspring(island, slots, mutator, config, rng);
          for (
            let attempt = 0;
            attempt < MAX_BREED_ATTEMPTS && offspring.length < slots;
            attempt++
          ) {
            offspring.push(
              ...breedOffspring(
                island,
                slots - offspring.length,
                mutator,
                config,
                rng,
              ),
            );
          }
          const missing = slots - offspring.length;
          if (missing > 0) {
            // Crossover refused these pairs (a collapsed island of clones
            // cannot cross). Fill with mutation-only copies so every arm
            // spends exactly the same evaluation budget.
            const fills: Creature[] = [];
            for (let f = 0; f < missing; f++) {
              const parent = island[
                Math.floor(rng.random() * rng.random() * island.length)
              ];
              const made = makeMutantFill(parent, fillMutator);
              fillRedraws += made.redraws;
              fills.push(made.fill);
            }
            offspring.push(...fills);
            mutationFills += missing;
          }
          return [...elites, ...offspring];
        });
      }
    }

    const report = selectAndReport(islands.map((i) => i[0]), splits, clock);
    evaluationMs += report.evaluationMs;
    const finalInter = traces[traces.length - 1].interIslandDistance;
    return {
      arm,
      seed: settings.seed,
      holdoutMse: report.holdoutMse,
      calibrationMse: report.calibrationMse,
      reportedUuid: CreatureUtil.makeUUID(report.reported),
      recordsCharged: trainRecordsCharged + report.calibrationRecords,
      trainRecordsCharged,
      calibrationRecordsCharged: report.calibrationRecords,
      evaluationMs,
      transfers,
      bytes,
      transportMs,
      finalInterIslandDistance: finalInter,
      meanInterIslandDistance: mean(traces.map((t) => t.interIslandDistance)),
      withinIslandDistance: mean(islands.map((i) => meanPairwise(i))),
      collapsed: finalInter < settings.collapseThreshold,
      mutationFills,
      fillRedraws,
      generations: traces,
    };
  } finally {
    setRandomNumberGenerator(previousRng);
  }
}

/** Run one arm for one seed from shared starting islands. */
export function runArmSeed(
  arm: ExchangeArm,
  settings: IslandStudySettings,
  splits: Splits,
  initialIslands: readonly CreatureExport[][],
  clock: () => number,
): ArmSeedResult {
  // The same seed for every arm, so the arms are paired.
  return withSeededUuids(
    settings.seed * 7919 + 1,
    () => runArmSeedBody(arm, settings, splits, initialIslands, clock),
  );
}

/** Starting islands for one seed, shared by every arm so they are paired. */
export function buildInitialIslands(
  settings: IslandStudySettings,
): CreatureExport[][] {
  // The Creature constructor also draws from the global generator, so seed it
  // too and restore it afterwards.
  const previousRng = getRandomNumberGenerator();
  setRandomNumberGenerator(createSeededRng(settings.seed * 7919 + 2));
  try {
    return withSeededUuids(
      settings.seed * 7919,
      () => buildIslandsBody(settings),
    );
  } finally {
    setRandomNumberGenerator(previousRng);
  }
}

function buildIslandsBody(settings: IslandStudySettings): CreatureExport[][] {
  const out: CreatureExport[][] = [];
  for (let k = 0; k < settings.islands; k++) {
    const population = seedPopulation(
      { ...DEFAULT_AB_SETTINGS, populationSize: settings.islandPopulation },
      createSeededRng(settings.seed * 100 + k),
    );
    out.push(population.map((c) => c.exportJSON()));
  }
  return out;
}

/** A percentile bootstrap interval of a mean. */
export interface BootstrapInterval {
  mean: number;
  lower: number;
  upper: number;
  resamples: number;
}

/** 95% percentile bootstrap of the mean of paired differences. */
export function pairedBootstrap(
  diffs: readonly number[],
  resamples: number,
  seed: number,
): BootstrapInterval {
  if (diffs.length === 0) {
    throw new Error("pairedBootstrap needs at least one difference");
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
  means.sort((a, b) => a - b);
  return {
    mean: mean(diffs),
    lower: means[Math.floor(0.025 * resamples)],
    upper: means[Math.min(resamples - 1, Math.ceil(0.975 * resamples) - 1)],
    resamples,
  };
}

/** Outcome of a pre-declared comparison. */
export type ComparisonVerdict =
  | "better"
  | "worse"
  | "no-benefit"
  | "insufficient-data";

/**
 * Apply the pre-declared decision rules to paired holdout differences.
 *
 * - fewer than `minimumSeeds` pairs: `insufficient-data`;
 * - the 95% interval lies wholly below zero AND the arm's collapse rate is no
 *   higher than the control's AND (`bytesRatio <= 1.25` or `ignoreTransport`):
 *   `better`;
 * - the interval lies wholly above zero: `worse`;
 * - anything else, including an improvement that costs more than 25% extra
 *   bytes or collapses more often: `no-benefit`.
 *
 * `diffs` are arm holdout MSE minus control holdout MSE, so negative is better.
 */
export function comparisonVerdict(input: {
  diffs: number[];
  armCollapseRate: number;
  controlCollapseRate: number;
  bytesRatio: number;
  minimumSeeds?: number;
  resamples?: number;
  seed?: number;
  ignoreTransport?: boolean;
}): {
  verdict: ComparisonVerdict;
  interval?: BootstrapInterval;
  wins: number;
  n: number;
} {
  const n = input.diffs.length;
  const wins = input.diffs.filter((d) => d < 0).length;
  if (n < (input.minimumSeeds ?? 5)) {
    return { verdict: "insufficient-data", wins, n };
  }
  const interval = pairedBootstrap(
    input.diffs,
    input.resamples ?? 2000,
    input.seed ?? 4159,
  );
  const transportOk = input.ignoreTransport === true ||
    input.bytesRatio <= 1.25;
  if (
    interval.upper < 0 && input.armCollapseRate <= input.controlCollapseRate &&
    transportOk
  ) {
    return { verdict: "better", interval, wins, n };
  }
  if (interval.lower > 0) return { verdict: "worse", interval, wins, n };
  return { verdict: "no-benefit", interval, wins, n };
}

/** The study's terms, fixed before any run. */
export const PREDECLARED = Object.freeze({
  issue: 4159,
  control: CONTROL_ARM_NAME,
  primaryMetric: "paired held-out MSE difference, arm - broadcast",
  successCriterion:
    "The 95% bootstrap interval of the mean paired difference lies wholly " +
    "below zero, the arm's collapse rate is no higher than the broadcast's, " +
    "and (for the ring) bytes sent are at most 1.25x the broadcast's.",
  failureCriterion:
    "The interval lies wholly above zero (worse), or fails the success " +
    "criterion without that (no-benefit). Fewer than 5 paired seeds is " +
    "insufficient-data, not a result.",
  sampleSize: 20,
  seeds: Object.freeze(Array.from({ length: 20 }, (_, i) => 4159 + i)),
  computeLimits: Object.freeze({
    settings: DEFAULT_ISLAND_SETTINGS,
    recordsPerArmPerSeed:
      "islands * islandPopulation + islands * (islandPopulation - elitism) * " +
      "(generations - 1) train-record evaluations, plus islands calibration " +
      "evaluations; identical across arms because migrants keep their score",
  }),
  roles: Object.freeze({
    train: "selection inside the run; migrants are ranked on it",
    calibration: "picks which island champion is reported",
    holdout: "reported only; never consulted by any decision and not charged",
  }),
});

/** One recorded failure. */
export interface StudyFailure {
  seed: number;
  arm: ExchangeArm;
  message: string;
}

/** Per-arm means across completed seeds. */
export interface ArmSummary {
  arm: ExchangeArm;
  seeds: number;
  holdoutMse: number;
  improvement: number;
  improvementPerEvaluationHour: number;
  improvementPerMillionRecords: number;
  finalInterIslandDistance: number;
  withinIslandDistance: number;
  collapseRate: number;
  transfers: number;
  bytes: number;
  transportMs: number;
  recordsCharged: number;
  mutationFills: number;
  fillRedraws: number;
}

/** A comparison of one arm against the control. */
export interface ArmComparison {
  arm: ExchangeArm;
  control: ExchangeArm;
  seeds: number[];
  diffs: number[];
  verdict: ComparisonVerdict;
  interval?: BootstrapInterval;
  wins: number;
  n: number;
  armCollapseRate: number;
  controlCollapseRate: number;
  bytesRatio: number;
}

/** Everything a study run produces. */
export interface StudyResult {
  settings: IslandStudySettings;
  seeds: number[];
  results: ArmSeedResult[];
  baselines: { seed: number; holdoutMse: number; preparationRecords: number }[];
  summary: ArmSummary[];
  comparisons: {
    ringVsBroadcast: ArmComparison;
    noneVsBroadcast: ArmComparison;
  };
  failures: StudyFailure[];
  coverage: { plannedRuns: number; completedRuns: number };
  predeclared: typeof PREDECLARED;
}

/** Run every arm for every seed and summarise. */
export function runStudy(
  settings: IslandStudySettings,
  seeds: readonly number[],
  clock: () => number,
): StudyResult {
  validateIslandSettings(settings);
  const results: ArmSeedResult[] = [];
  const failures: StudyFailure[] = [];
  const baselines: StudyResult["baselines"] = [];

  for (const seed of seeds) {
    const s = { ...settings, seed };
    const splits = buildSplits(s);
    const initial = buildInitialIslands(s);

    // Baseline: the same select-on-calibration rule applied to the starting
    // islands, so "improvement" has a common zero. Not charged to any arm.
    const starting = loadIslands(initial);
    let preparationRecords = 0;
    for (const island of starting) {
      for (const creature of island) {
        const scored = scoreCreature(creature, splits.train);
        creature.score = scored.score;
        preparationRecords += scored.records;
      }
      island.sort(byScoreDesc);
    }
    const base = selectAndReport(starting.map((i) => i[0]), splits, clock);
    preparationRecords += base.calibrationRecords;
    baselines.push({ seed, holdoutMse: base.holdoutMse, preparationRecords });

    for (const arm of EXCHANGE_ARMS) {
      try {
        results.push(runArmSeed(arm, s, splits, initial, clock));
      } catch (error) {
        failures.push({
          seed,
          arm,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const baselineFor = (seed: number) =>
    baselines.find((b) => b.seed === seed)!.holdoutMse;

  const summary: ArmSummary[] = EXCHANGE_ARMS.map((arm) => {
    const rows = results.filter((r) => r.arm === arm);
    const improvement = mean(
      rows.map((r) => baselineFor(r.seed) - r.holdoutMse),
    );
    const evaluationMs = mean(rows.map((r) => r.evaluationMs));
    const records = mean(rows.map((r) => r.recordsCharged));
    return {
      arm,
      seeds: rows.length,
      holdoutMse: mean(rows.map((r) => r.holdoutMse)),
      improvement,
      improvementPerEvaluationHour: improvement / (evaluationMs / 3_600_000),
      improvementPerMillionRecords: improvement / (records / 1_000_000),
      finalInterIslandDistance: mean(
        rows.map((r) => r.finalInterIslandDistance),
      ),
      withinIslandDistance: mean(rows.map((r) => r.withinIslandDistance)),
      collapseRate: mean(rows.map((r) => (r.collapsed ? 1 : 0))),
      transfers: mean(rows.map((r) => r.transfers)),
      bytes: mean(rows.map((r) => r.bytes)),
      transportMs: mean(rows.map((r) => r.transportMs)),
      recordsCharged: records,
      mutationFills: mean(rows.map((r) => r.mutationFills)),
      fillRedraws: mean(rows.map((r) => r.fillRedraws)),
    };
  });

  const compare = (
    arm: ExchangeArm,
    ignoreTransport: boolean,
  ): ArmComparison => {
    const paired: { seed: number; a: ArmSeedResult; c: ArmSeedResult }[] = [];
    for (const seed of seeds) {
      const a = results.find((r) => r.seed === seed && r.arm === arm);
      const c = results.find((r) =>
        r.seed === seed && r.arm === CONTROL_ARM_NAME
      );
      if (a !== undefined && c !== undefined) paired.push({ seed, a, c });
    }
    const diffs = paired.map((p) => p.a.holdoutMse - p.c.holdoutMse);
    const armCollapseRate = mean(paired.map((p) => (p.a.collapsed ? 1 : 0)));
    const controlCollapseRate = mean(
      paired.map((p) => (p.c.collapsed ? 1 : 0)),
    );
    const controlBytes = paired.reduce((sum, p) => sum + p.c.bytes, 0);
    const armBytes = paired.reduce((sum, p) => sum + p.a.bytes, 0);
    const bytesRatio = controlBytes === 0
      ? Number.NaN
      : armBytes / controlBytes;
    const verdict = comparisonVerdict({
      diffs,
      armCollapseRate,
      controlCollapseRate,
      bytesRatio,
      ignoreTransport,
    });
    return {
      arm,
      control: CONTROL_ARM_NAME,
      seeds: paired.map((p) => p.seed),
      diffs,
      armCollapseRate,
      controlCollapseRate,
      bytesRatio,
      ...verdict,
    };
  };

  return {
    settings,
    seeds: [...seeds],
    results,
    baselines,
    summary,
    comparisons: {
      ringVsBroadcast: compare("ring", false),
      noneVsBroadcast: compare("none", true),
    },
    failures,
    coverage: {
      plannedRuns: seeds.length * EXCHANGE_ARMS.length,
      completedRuns: results.length,
    },
    predeclared: PREDECLARED,
  };
}
