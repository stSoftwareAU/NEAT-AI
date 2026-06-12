/**
 * NoveltySearch.ts - Novelty (behavioural-diversity) selection (Issue
 * #2932).
 *
 * Implements the behaviour descriptor, bounded archive, k-nearest-neighbour
 * novelty score and fitness/novelty blend described by Lehman & Stanley
 * (2011, "Abandoning Objectives: Evolution Through the Search for Novelty
 * Alone"). The mechanism is OFF by default and self-contained behind the
 * {@link RequiredNoveltyConfig} feature flag — see
 * {@link ../config/NoveltyConfig.ts}.
 *
 * The core is pure-numeric and side-effect free so it is cheap to unit test
 * and to drive from a standalone deceptive-task benchmark. The
 * {@link extractBehaviour} / {@link buildNoveltyBlendedScores} helpers bridge
 * to live breeding by reading a per-creature behaviour tag and producing a
 * UUID → blended-score map suitable for `FitnessRanking`'s score override.
 */

import { getTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import type { RequiredNoveltyConfig } from "@config/NoveltyConfig.ts";

/** A behaviour descriptor: a vector of finite numbers. */
export type BehaviourDescriptor = readonly number[];

/**
 * Euclidean distance between two behaviour descriptors. When the
 * descriptors differ in length the shared leading prefix is compared, so a
 * partial descriptor still yields a meaningful distance.
 *
 * @param a - First behaviour descriptor.
 * @param b - Second behaviour descriptor.
 * @returns The Euclidean distance over the shared prefix (0 for empty).
 */
export function behaviourDistance(
  a: BehaviourDescriptor,
  b: BehaviourDescriptor,
): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Mean distance from a target descriptor to its `k` nearest neighbours
 * within `others`. This is the novelty score: a behaviour far from all
 * others scores high.
 *
 * @param target - The descriptor whose novelty is measured.
 * @param others - Candidate neighbour descriptors (population + archive).
 * @param k - Number of nearest neighbours to average over (clamped to the
 *   number available).
 * @returns The mean distance to the `k` nearest neighbours, or `0` when
 *   there are no other descriptors.
 */
export function meanNearestNeighbourDistance(
  target: BehaviourDescriptor,
  others: readonly BehaviourDescriptor[],
  k: number,
): number {
  if (others.length === 0) return 0;
  const distances = others
    .map((o) => behaviourDistance(target, o))
    .sort((x, y) => x - y);
  const kk = Math.min(Math.max(1, Math.floor(k)), distances.length);
  let sum = 0;
  for (let i = 0; i < kk; i++) sum += distances[i];
  return sum / kk;
}

/**
 * A bounded, first-in-first-out archive of behaviour descriptors. Stored
 * copies are defensive so external mutation cannot corrupt the archive.
 */
export class NoveltyArchive {
  readonly #entries: number[][] = [];
  readonly #limit: number;

  /**
   * @param limit - Maximum retained descriptors (minimum 1). When exceeded
   *   the oldest descriptor is evicted.
   */
  constructor(limit: number) {
    this.#limit = Math.max(1, Math.floor(limit));
  }

  /** Number of descriptors currently retained. */
  get size(): number {
    return this.#entries.length;
  }

  /** Read-only view of the retained descriptors (oldest first). */
  get entries(): readonly BehaviourDescriptor[] {
    return this.#entries;
  }

  /**
   * Append a copy of `descriptor`, evicting the oldest entry when the
   * archive is over its limit. Empty descriptors are ignored.
   *
   * @param descriptor - The behaviour descriptor to archive.
   */
  add(descriptor: BehaviourDescriptor): void {
    if (descriptor.length === 0) return;
    this.#entries.push(descriptor.slice());
    while (this.#entries.length > this.#limit) {
      this.#entries.shift();
    }
  }

  /** Remove all archived descriptors. */
  clear(): void {
    this.#entries.length = 0;
  }
}

/**
 * Novelty search engine: holds the persistent archive and computes novelty
 * scores for a generation's behaviour descriptors. One instance lives for
 * the lifetime of a run so the archive accumulates across generations.
 */
export class NoveltySearch {
  readonly config: RequiredNoveltyConfig;
  readonly archive: NoveltyArchive;

  /**
   * @param config - Resolved novelty configuration.
   */
  constructor(config: RequiredNoveltyConfig) {
    this.config = config;
    this.archive = new NoveltyArchive(config.archiveLimit);
  }

  /**
   * Compute the novelty score for each descriptor in `behaviours`. Novelty
   * is the mean distance to the `k` nearest neighbours drawn from the rest
   * of the current population **and** the archive.
   *
   * @param behaviours - This generation's behaviour descriptors, in order.
   * @returns Novelty scores aligned to `behaviours` by index.
   */
  computeNovelty(behaviours: readonly BehaviourDescriptor[]): number[] {
    const archiveEntries = this.archive.entries;
    return behaviours.map((target, i) => {
      const others: BehaviourDescriptor[] = [];
      for (let j = 0; j < behaviours.length; j++) {
        if (j !== i) others.push(behaviours[j]);
      }
      for (const entry of archiveEntries) others.push(entry);
      return meanNearestNeighbourDistance(
        target,
        others,
        this.config.neighbours,
      );
    });
  }

  /**
   * Admit behaviours whose novelty meets `addThreshold` into the archive.
   *
   * @param behaviours - This generation's descriptors.
   * @param novelty - Their novelty scores (from {@link computeNovelty}).
   */
  updateArchive(
    behaviours: readonly BehaviourDescriptor[],
    novelty: readonly number[],
  ): void {
    for (let i = 0; i < behaviours.length; i++) {
      if (novelty[i] >= this.config.addThreshold) {
        this.archive.add(behaviours[i]);
      }
    }
  }
}

/**
 * Min-max normalise `values` into `[0, 1]`. When every value is equal the
 * result is a neutral `0.5` for each, so a flat dimension neither helps nor
 * hurts the blend.
 *
 * @param values - The values to normalise.
 * @returns Normalised values aligned to `values` by index.
 */
export function normalise(values: readonly number[]): number[] {
  if (values.length === 0) return [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range === 0) return values.map(() => 0.5);
  return values.map((v) => (v - min) / range);
}

/**
 * Blend fitness and novelty into a single ranking score per index using
 * `score' = (1 - weight)·fitnessNorm + weight·noveltyNorm`. Both inputs are
 * min-max normalised first so their differing scales do not dominate.
 *
 * @param fitness - Raw fitness per index.
 * @param novelty - Novelty score per index (same length as `fitness`).
 * @param weight - Blend weight in `[0, 1]`.
 * @returns Blended scores in `[0, 1]`, aligned by index.
 */
export function blendScores(
  fitness: readonly number[],
  novelty: readonly number[],
  weight: number,
): number[] {
  const w = Math.min(1, Math.max(0, weight));
  const fitnessNorm = normalise(fitness);
  const noveltyNorm = normalise(novelty);
  return fitness.map((_, i) => (1 - w) * fitnessNorm[i] + w * noveltyNorm[i]);
}

/**
 * Parse a creature's behaviour descriptor from its tag. The tag value is a
 * comma-separated list of finite numbers (for example an output vector on a
 * probe set).
 *
 * @param creature - The creature to read.
 * @param tag - The tag name holding the descriptor.
 * @returns The parsed descriptor, or `undefined` when the tag is absent,
 *   empty, or contains a non-finite value.
 */
export function extractBehaviour(
  creature: Creature,
  tag: string,
): number[] | undefined {
  const txt = getTag(creature, tag);
  if (!txt) return undefined;
  const parts = txt.split(",").map((s) => Number.parseFloat(s.trim()));
  if (parts.length === 0) return undefined;
  for (const p of parts) {
    if (!Number.isFinite(p)) return undefined;
  }
  return parts;
}

/**
 * Build a UUID → blended-score map for live breeding. Reads each creature's
 * behaviour descriptor, computes novelty against the population and the
 * persistent archive, blends it with the supplied base fitness, and updates
 * the archive.
 *
 * Safe by construction: when fewer than two creatures expose a parseable
 * behaviour descriptor there is nothing meaningful to compare, so the
 * function returns `undefined` and the caller leaves ranking untouched.
 *
 * @param population - The current population.
 * @param baseScore - Returns the base fitness for a creature (raw score or
 *   an upstream override such as fitness sharing).
 * @param search - The persistent novelty engine (archive lives here).
 * @returns A UUID → blended-score map, or `undefined` when novelty cannot be
 *   applied (no/too-few behaviour descriptors).
 */
export function buildNoveltyBlendedScores(
  population: readonly Creature[],
  baseScore: (creature: Creature) => number,
  search: NoveltySearch,
): Map<string, number> | undefined {
  const tag = search.config.behaviourTag;
  const behaviours: BehaviourDescriptor[] = [];
  let described = 0;
  for (const creature of population) {
    const b = extractBehaviour(creature, tag);
    if (b) {
      behaviours.push(b);
      described++;
    } else {
      // Absent descriptor → least-novel placeholder so the creature is not
      // rewarded for missing behaviour data.
      behaviours.push([]);
    }
  }
  if (described < 2) return undefined;

  const novelty = search.computeNovelty(behaviours);
  const fitness = population.map((c) => {
    const s = baseScore(c);
    return Number.isFinite(s) ? s : 0;
  });
  const blended = blendScores(fitness, novelty, search.config.weight);

  const map = new Map<string, number>();
  for (let i = 0; i < population.length; i++) {
    const uuid = population[i].uuid;
    if (uuid) map.set(uuid, blended[i]);
  }

  // Archive only the genuinely described behaviours.
  const describedBehaviours: BehaviourDescriptor[] = [];
  const describedNovelty: number[] = [];
  for (let i = 0; i < behaviours.length; i++) {
    if (behaviours[i].length > 0) {
      describedBehaviours.push(behaviours[i]);
      describedNovelty.push(novelty[i]);
    }
  }
  search.updateArchive(describedBehaviours, describedNovelty);

  return map;
}
