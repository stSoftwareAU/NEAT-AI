/**
 * Shared parent selection utilities for breeding.
 *
 * Issue #1392: Extracted from Breed.ts and ParallelBreeding.ts to
 * eliminate DRY violation where getDad() and selectParent() were
 * independently defined with identical logic.
 */

import { assert } from "@std/assert";
import { Creature, Selection } from "../../mod.ts";
import type { NeatConfig } from "@config/NeatConfig.ts";
import { BreedExhaustionError } from "@errors/BreedExhaustionError.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import type { Genus } from "@neat/Genus.ts";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { calculateAdaptiveTournamentSize } from "@breed/AdaptiveTournamentSize.ts";
import { createCompatibleFatherFromCreatures } from "@breed/Father.ts";
import type { FatherSelectionCache } from "@breed/FatherSelectionCache.ts";
import { FitnessRanking } from "@breed/FitnessRanking.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";
import {
  computeAdvantageStats,
  computeGroupRelativeAdvantages,
} from "@neat/GroupRelativeAdvantage.ts";

/**
 * Mutable accumulator for breeding loop diagnostics (Issue #2523).
 *
 * Callers (e.g., `Breed`, `ParallelBreeding`) construct one per batch
 * and pass it to {@link findFather}; corrupt-parent skips are recorded
 * here so they can be surfaced in the per-batch throughput summary.
 */
export interface BreedSelectionStats {
  /** Total number of corrupt parent candidates skipped this batch. */
  corruptParentSkips: number;
}

/** Maximum retries when skipping corrupt parents (Issue #2523). */
const CORRUPT_PARENT_RETRY_CAP = 10;

/**
 * Maximum rejection-sampling draws from a cached ranking before falling back
 * to the exact filtered path (Issue #3474). For production-size pools the
 * mother is one member in n, so the first draw almost always yields a valid
 * father; the cap only bites on tiny pools dominated by the mother/skipped
 * candidates, where the fallback below guarantees correctness.
 */
const RANKING_REJECTION_CAP = 16;

/**
 * Resolved candidate pool for father selection (Issue #3474).
 *
 * `pool` is the **full** source array (it may include the mother); `ranking`
 * is the cached raw-fitness ranking of that pool when a cache is supplied.
 * `mumInPool` records whether the mother is a member so the corrupt-parent
 * retry cap can be sized against the eligible (mother-excluded) count.
 */
interface FatherPool {
  pool: Creature[];
  ranking: FitnessRanking | undefined;
  mumInPool: boolean;
}

/**
 * Resolves the candidate pool for father selection, mirroring the historical
 * fallback order (global population → mother's species → closest species →
 * global population) without copying the mother-excluded array on the hot
 * paths (Issue #3474). Returns `undefined` when no eligible father exists.
 *
 * @param mum - The mother creature (its UUID must be set).
 * @param genus - The genus containing the population.
 * @param config - NEAT configuration (drives the global-breeding roll).
 * @param cache - Optional per-generation ranking cache.
 * @returns The resolved pool, or `undefined` when no father is available.
 */
function resolveFatherPool(
  mum: Creature,
  genus: Genus,
  config: NeatConfig,
  cache?: FatherSelectionCache,
): FatherPool | undefined {
  const population = genus.population;

  // Global-breeding path: always consume the roll (matches legacy RNG use),
  // then take the whole population when it holds a father besides the mother.
  if (
    config.globalBreedingRate > getRandomNumberGenerator().random() &&
    population.length > 1
  ) {
    return {
      pool: population,
      ranking: cache?.populationRanking(),
      mumInPool: true,
    };
  }

  // Within-species path.
  const species = genus.findSpeciesByCreatureUUID(mum.uuid!);
  if (species.creatures.length > 1) {
    return {
      pool: species.creatures,
      ranking: cache?.speciesRanking(species.speciesKey, species.creatures),
      mumInPool: true,
    };
  }

  // Closest matching species (a different species, so the mother is absent).
  const closestSpecies = genus.findClosestMatchingSpecies(mum);
  if (closestSpecies) {
    if (closestSpecies.creatures.length > 0) {
      return {
        pool: closestSpecies.creatures,
        ranking: cache?.speciesRanking(
          closestSpecies.speciesKey,
          closestSpecies.creatures,
        ),
        mumInPool: false,
      };
    }
    // Empty closest species: fall back to the global population.
    if (population.length > 1) {
      return {
        pool: population,
        ranking: cache?.populationRanking(),
        mumInPool: true,
      };
    }
  }

  return undefined;
}

/**
 * Issue #2453: Compute per-creature adjusted fitness for NEAT fitness
 * sharing. Each creature's adjusted fitness is `rawScore / speciesSize`,
 * so a lone member of a small species ranks higher than one of nine in
 * a populous species, even when their raw scores are equal.
 *
 * Creatures whose UUID is not registered in the genus (e.g., creatures
 * with non-finite scores excluded from speciation) are skipped — they
 * fall back to raw fitness in the resulting ranking.
 *
 * @param genus - The genus containing the population
 * @returns A map from creature UUID to adjusted fitness
 */
export function buildAdjustedFitnessMap(
  genus: Genus,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const creature of genus.population) {
    if (!creature.uuid) continue;
    const score = creature.score;
    if (score === undefined || score === null || !Number.isFinite(score)) {
      continue;
    }
    const speciesKey = genus.creatureToSpeciesMap.get(creature.uuid);
    if (!speciesKey) continue;
    const species = genus.speciesMap.get(speciesKey);
    if (!species) continue;
    // Prefer the cached size populated by Species.computeStatistics; fall
    // back to the live creatures array if statistics have not run yet.
    const size = species.size > 0 ? species.size : species.creatures.length;
    if (size <= 0) continue;
    map.set(creature.uuid, score / size);
  }
  return map;
}

/**
 * Issue #2527: Build a UUID → group-relative advantage map for parent
 * selection. For each species, the advantage of every member is the
 * z-score of its raw fitness against the species cohort. When a species
 * has fewer than `minCohortSize` members, the whole-generation cohort is
 * used as a fallback so a lone-member species does not collapse to a
 * zero-signal `0` advantage.
 *
 * Creatures whose score is non-finite are skipped — they fall back to
 * raw fitness in the resulting ranking. The map is intended to feed
 * `FitnessRanking(population, advantages)` exactly like the existing
 * adjusted-fitness map, so no FitnessRanking change is required.
 *
 * @param genus - The genus containing the population
 * @param options - `minCohortSize`, `eps`, `clip` overrides
 * @returns A map from creature UUID to group-relative advantage
 */
export function buildGroupRelativeAdvantageMap(
  genus: Genus,
  options: { minCohortSize?: number; eps?: number; clip?: number } = {},
): Map<string, number> {
  const minCohortSize = options.minCohortSize ?? 4;

  // Pre-compute the generation-wide cohort once for the small-species
  // fallback. Creatures with non-finite scores are skipped.
  const generationScores: number[] = [];
  const generationOrder: string[] = [];
  for (const c of genus.population) {
    if (!c.uuid) continue;
    const score = c.score;
    if (score === undefined || score === null || !Number.isFinite(score)) {
      continue;
    }
    generationOrder.push(c.uuid);
    generationScores.push(score);
  }
  const generationAdvantages = computeGroupRelativeAdvantages(
    generationScores,
    { eps: options.eps, clip: options.clip },
  );
  const generationAdvantageByUuid = new Map<string, number>();
  for (let i = 0; i < generationOrder.length; i++) {
    generationAdvantageByUuid.set(generationOrder[i], generationAdvantages[i]);
  }

  const out = new Map<string, number>();
  for (const species of genus.speciesMap.values()) {
    const speciesUuids: string[] = [];
    const speciesScores: number[] = [];
    for (const c of species.creatures) {
      if (!c.uuid) continue;
      const score = c.score;
      if (score === undefined || score === null || !Number.isFinite(score)) {
        continue;
      }
      speciesUuids.push(c.uuid);
      speciesScores.push(score);
    }

    if (speciesScores.length < minCohortSize) {
      // Small cohort: borrow the generation-wide advantage so the
      // single-species curve does not flatten the signal to zero.
      for (const uuid of speciesUuids) {
        const adv = generationAdvantageByUuid.get(uuid);
        if (adv !== undefined) out.set(uuid, adv);
      }
      continue;
    }

    const advantages = computeGroupRelativeAdvantages(speciesScores, {
      eps: options.eps,
      clip: options.clip,
    });
    for (let i = 0; i < speciesUuids.length; i++) {
      out.set(speciesUuids[i], advantages[i]);
    }
  }
  return out;
}

/**
 * Issue #2527: Build a UUID → cohort std map for the M-H acceptance
 * signal in `groupRelative` mode. The std measures variation in
 * **fitness** across the species cohort and is used to normalise the
 * raw cost delta before feeding it to M-H. When the species has fewer
 * than `minCohortSize` finite-scored members, the entry is omitted so
 * the caller's generation-wide fallback std is used.
 *
 * @param genus - The genus containing the population
 * @param minCohortSize - Minimum species size for per-species std
 * @returns A map from creature UUID to species cohort std, plus the
 *   generation-wide fallback std
 */
export function buildCohortStdContext(
  genus: Genus,
  minCohortSize = 4,
): { stdByUuid: Map<string, number>; fallbackStd: number } {
  const stdByUuid = new Map<string, number>();

  // Generation-wide fallback std.
  const generationScores: number[] = [];
  for (const c of genus.population) {
    if (!c.uuid) continue;
    const score = c.score;
    if (score === undefined || score === null || !Number.isFinite(score)) {
      continue;
    }
    generationScores.push(score);
  }
  const fallbackStd = computeAdvantageStats(generationScores).std;

  for (const species of genus.speciesMap.values()) {
    const speciesUuids: string[] = [];
    const speciesScores: number[] = [];
    for (const c of species.creatures) {
      if (!c.uuid) continue;
      const score = c.score;
      if (score === undefined || score === null || !Number.isFinite(score)) {
        continue;
      }
      speciesUuids.push(c.uuid);
      speciesScores.push(score);
    }
    if (speciesScores.length < minCohortSize) continue;
    const std = computeAdvantageStats(speciesScores).std;
    if (!Number.isFinite(std) || std <= 0) continue;
    for (const uuid of speciesUuids) stdByUuid.set(uuid, std);
  }

  return { stdByUuid, fallbackStd };
}

/**
 * Selects a parent from a pre-computed fitness ranking based on the selection strategy.
 *
 * Uses the pre-computed FitnessRanking for O(1) or O(k) selection instead of
 * recalculating fitness metrics on every selection.
 *
 * @param ranking - Pre-computed fitness ranking
 * @param config - NEAT configuration
 * @returns The selected parent creature
 * @throws {Error} When selection fails or unknown selection strategy
 */
export function selectParent(
  ranking: FitnessRanking,
  config: NeatConfig,
): Creature {
  // Issue #2929: selection-pressure knobs now come from config instead of
  // the hardcoded Selection singletons. Defaults reproduce prior behaviour.
  const sp = config.selectionPressure;
  switch (config.selection) {
    case Selection.POWER: {
      return ranking.selectPower(sp.power);
    }
    case Selection.FITNESS_PROPORTIONATE: {
      return ranking.selectFitnessProportionate();
    }
    case Selection.TOURNAMENT: {
      // Issue #1019: Use adaptive tournament size that scales with population
      // instead of a fixed size. This improves selection pressure for large
      // populations and reduces variance for small populations. Issue #2929:
      // the bounds (and the adaptive toggle / fixed size) are configurable.
      const size = sp.adaptiveTournament
        ? calculateAdaptiveTournamentSize(ranking.sortedPopulation.length, {
          minSize: sp.adaptiveTournamentMinSize,
          sqrtExponent: sp.adaptiveTournamentSqrtExponent,
          capFraction: sp.adaptiveTournamentCapFraction,
        })
        : sp.tournamentSize;

      return ranking.selectTournament(size, sp.tournamentProbability);
    }
    default: {
      throw new ValidationError(
        `Unknown selection: ${config.selection}`,
        "OTHER",
      );
    }
  }
}

/**
 * Selects a father for breeding with the given mother.
 *
 * Creates a FitnessRanking for the filtered father population to enable
 * efficient parent selection. Falls back through species-based selection,
 * closest species, and global population as needed.
 *
 * Issue #2523: Wraps the per-candidate `Creature.fromJSON(...)` call in a
 * `try/catch (TopologyError)` so a single corrupt parent is skipped, the
 * loop tries the next-best candidate, and the run continues. After
 * `min(CORRUPT_PARENT_RETRY_CAP, possibleFathers.length)` skips a
 * recoverable {@link BreedExhaustionError} is raised. Setting
 * `config.tolerateCorruptParents = false` restores legacy fail-fast.
 * Non-`TopologyError` exceptions are always re-thrown unchanged.
 *
 * Issue #3474: An optional {@link FatherSelectionCache} lets a batch reuse
 * one raw-fitness ranking per generation (whole-population and per-species)
 * instead of rebuilding a {@link FitnessRanking} on every call. The cached
 * rankings include the mother; she — and any skipped candidates — are excluded
 * by rejection sampling, with an exact filtered fallback that guarantees the
 * mother is never returned. When no cache is supplied the behaviour is
 * identical to before.
 *
 * @param mum - The mother creature
 * @param genus - The genus containing the population
 * @param config - NEAT configuration
 * @param stats - Optional accumulator for `corruptParentSkips`
 * @param cache - Optional per-generation ranking cache (Issue #3474)
 * @returns A compatible father creature, or undefined if none found
 */
export function findFather(
  mum: Creature,
  genus: Genus,
  config: NeatConfig,
  stats?: BreedSelectionStats,
  cache?: FatherSelectionCache,
): Creature | undefined {
  assert(mum.uuid, "Mother UUID is undefined");

  const resolved = resolveFatherPool(mum, genus, config, cache);
  if (!resolved) {
    return undefined;
  }
  const { pool, ranking, mumInPool } = resolved;

  const tolerate = config.tolerateCorruptParents !== false;
  const eligibleCount = pool.length - (mumInPool ? 1 : 0);
  const retryCap = Math.min(CORRUPT_PARENT_RETRY_CAP, eligibleCount);
  let skips = 0;
  // Track candidates we've already rejected as corrupt so later draws
  // can avoid them. Identity by reference is enough — the candidate
  // pool is stable for the duration of this call.
  const skipped = new Set<Creature>();

  for (let attempt = 0; attempt <= retryCap; attempt++) {
    // Issue #2173: Diversity-driven breeding. When diversityBreedingRate
    // triggers, select the most genetically distant father instead of a
    // fitness-biased one. Issue #3474: on the fitness path a cached ranking
    // is reused (rejection-sampling the mother/skipped out); the exact
    // filtered path is the fallback and the no-cache behaviour.
    const father = selectFatherFromPool(mum, pool, ranking, config, skipped);
    if (father === undefined) break;

    // Issue #1034: Avoid JSON exports in parent selection compatibility check.
    // Uses optimised function that works directly with Creature objects.
    // Issue #2614: pass through the configured synthetic-UUID alignment
    // threshold so genetically incompatible parents can pick up real
    // crossover anchor points via location-based synthetic UUIDs.
    const fatherExport = createCompatibleFatherFromCreatures(
      mum,
      father,
      config.syntheticAlignmentThreshold,
    );
    try {
      return Creature.fromJSON(fatherExport);
    } catch (e) {
      if (e instanceof TopologyError && tolerate) {
        skips++;
        if (stats) stats.corruptParentSkips++;
        skipped.add(father);
        const hash = (father as unknown as { hash?: string }).hash ??
          father.uuid ?? "<unknown>";
        getLogger().warn(
          `[breed-skip-corrupt-parent] hash=${hash} reason=${e.reason} source=findFather`,
        );
        if (skips >= retryCap) {
          throw new BreedExhaustionError(
            `[breed-skip-corrupt-parent] retry cap reached (${skips} skips) for mother uuid=${mum.uuid}`,
            "RETRY_CAP_EXHAUSTED",
            skips,
          );
        }
        continue;
      }

      // Legacy fail-fast path or non-TopologyError: persist diagnostics
      // and re-throw unchanged.
      try {
        Deno.writeTextFileSync(
          "./.source_mother.json",
          JSON.stringify(mum.exportJSON(), null, 1),
        );
        Deno.writeTextFileSync(
          "./.source_father.json",
          JSON.stringify(father.exportJSON(), null, 1),
        );
        Deno.writeTextFileSync(
          "./.invalid_father.json",
          JSON.stringify(fatherExport, null, 1),
        );
      } catch {
        // Diagnostics are best-effort; never let a write failure mask
        // the original error.
      }
      throw e;
    }
  }

  // Every candidate skipped without hitting the cap (small pools).
  throw new BreedExhaustionError(
    `[breed-skip-corrupt-parent] all ${skips} candidates corrupt for mother uuid=${mum.uuid}`,
    "ALL_CANDIDATES_CORRUPT",
    skips,
  );
}

/**
 * Selects a father from a candidate pool, optionally using diversity-driven
 * selection (Issue #2173) and a reused per-generation ranking (Issue #3474).
 *
 * The `pool` is the full source array and may include the mother. The mother
 * and any `skipped` (corrupt) candidates are always excluded from the result:
 *
 * - **Fitness path with a cached `ranking`** — rejection-samples the ranking,
 *   skipping the mother and skipped candidates, avoiding both a per-call
 *   candidate copy and a per-call `FitnessRanking` rebuild. Falls through to
 *   the exact filtered path if the tiny-pool rejection cap is hit.
 * - **Diversity path / no cache / rejection fallback** — materialises the
 *   eligible (mother- and skip-excluded) candidates and selects from them,
 *   exactly as before Issue #3474.
 *
 * @param mum - The mother creature
 * @param pool - Full candidate source array (may include the mother)
 * @param ranking - Cached raw-fitness ranking of `pool`, or `undefined`
 * @param config - NEAT configuration
 * @param skipped - Candidates already rejected as corrupt this call
 * @returns The selected father, or `undefined` when no eligible candidate remains
 */
function selectFatherFromPool(
  mum: Creature,
  pool: Creature[],
  ranking: FitnessRanking | undefined,
  config: NeatConfig,
  skipped: Set<Creature>,
): Creature | undefined {
  const diversity = config.diversityBreedingRate > 0 &&
    config.diversityBreedingRate > getRandomNumberGenerator().random();

  // Fast path: fitness-biased selection reusing the cached ranking.
  if (!diversity && ranking) {
    for (let i = 0; i < RANKING_REJECTION_CAP; i++) {
      const candidate = selectParent(ranking, config);
      if (candidate.uuid === mum.uuid) continue;
      if (skipped.size > 0 && skipped.has(candidate)) continue;
      return candidate;
    }
    // Rejection exhausted on a tiny pool — fall through to the exact path.
  }

  // Materialise the eligible candidates (mother- and skip-excluded). When
  // `skipped` is empty this is the only copy, and it is skipped entirely on
  // the fast path above (Issue #3474 acceptance: no full-population copy on
  // the happy path).
  const candidates = pool.filter(
    (c) => c.uuid !== mum.uuid && !skipped.has(c),
  );
  if (candidates.length === 0) return undefined;

  if (diversity) {
    // Issue #2455: Apply the soft compatibility gate when enabled. The
    // soft gate keeps cross-species exploration possible while
    // concentrating most pairings on compatible parents — a hard
    // "always pick lowest compat" filter empirically produces weak
    // hybrids. Disabling the gate (or `power: 0`) reverts to the
    // legacy lowest-compatibility pick exactly as before this issue.
    const gate = config.compatibilityGating;
    if (gate.enabled && gate.power > 0) {
      return softCompatibilityGate(mum, candidates, gate.power, gate.maxDraws);
    }
    return selectMostDiverseFather(mum, candidates);
  }

  const fatherRanking = new FitnessRanking(candidates);
  return selectParent(fatherRanking, config);
}

/**
 * Soft compatibility-gated father selection (Issue #2455).
 *
 * Samples up to `maxDraws` candidates uniformly at random and accepts
 * each with probability `compatibility ^ power`. Compatibility is in
 * [0, 1], so higher powers concentrate selection on similar
 * architectures while leaving a small probability mass for exploratory
 * cross-species pairings. After `maxDraws` rejections the gate falls
 * back to the lowest-compatibility candidate (the prior behaviour) so
 * the call always returns a father.
 *
 * @param mum - The mother creature
 * @param candidates - Array of potential father creatures
 * @param power - Exponent applied to compatibility for acceptance probability
 * @param maxDraws - Maximum number of probabilistic draws before fallback
 * @returns The selected father creature
 */
export function softCompatibilityGate(
  mum: Creature,
  candidates: Creature[],
  power: number,
  maxDraws: number,
): Creature {
  const rng = getRandomNumberGenerator();
  for (let i = 0; i < maxDraws; i++) {
    const idx = Math.floor(rng.random() * candidates.length);
    const candidate = candidates[idx];
    const compatibility = geneticCompatibility(mum, candidate);
    const acceptance = Math.pow(compatibility, power);
    if (rng.random() < acceptance) {
      return candidate;
    }
  }
  // Bounded fallback: return the lowest-compatibility (most diverse)
  // candidate. This preserves the historical exploratory pick while
  // ensuring the loop always terminates.
  return selectMostDiverseFather(mum, candidates);
}

/**
 * Selects the most genetically distant creature from the mother (Issue #2173).
 *
 * Iterates through all candidates and picks the one with the lowest genetic
 * compatibility score (i.e., maximum genetic distance). This ensures
 * newcomers from isolated populations breed with established creatures.
 *
 * @param mum - The mother creature
 * @param candidates - Array of potential father creatures
 * @returns The most genetically distant creature from the mother
 */
export function selectMostDiverseFather(
  mum: Creature,
  candidates: Creature[],
): Creature {
  let mostDiverse = candidates[0];
  let lowestCompatibility = 1;

  for (const candidate of candidates) {
    const compatibility = geneticCompatibility(mum, candidate);
    if (compatibility < lowestCompatibility) {
      lowestCompatibility = compatibility;
      mostDiverse = candidate;
    }
  }

  return mostDiverse;
}
