import { assert } from "@std/assert";
import type { Creature } from "../../mod.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { discover } from "@blackbox/Discover.ts";
import type { NeatConfig } from "@config/NeatConfig.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { BreedExhaustionError } from "@errors/BreedExhaustionError.ts";
import type { Genus } from "@neat/Genus.ts";
import { FitnessRanking } from "@breed/FitnessRanking.ts";
import { onPolicyDistillationBreed } from "@breed/OnPolicyDistillationBreed.ts";
import {
  type BreedSelectionStats,
  buildAdjustedFitnessMap,
  buildGroupRelativeAdvantageMap,
  findFather,
  selectParent,
} from "@breed/ParentSelection.ts";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";

/**
 * Handles breeding operations between creatures in a NEAT population.
 *
 * This class manages the breeding process by selecting parents based on
 * fitness scores and genetic compatibility, then creating offspring through
 * crossover and mutation operations.
 *
 * Key features:
 * - Parent selection using various selection strategies
 * - Genetic compatibility checking
 * - Offspring creation with discovery integration
 * - Species-based breeding constraints
 * - Per-generation caching of NeatConfig and FitnessRanking (Issue #1538)
 *
 * @example
 * ```ts
 * const breed = new Breed(genus, config);
 * const offspring = breed.breed();
 * if (offspring) {
 *   getLogger().info("New offspring created");
 * }
 * ```
 */
export class Breed {
  /** The genus containing the population to breed from */
  readonly genus: Genus;

  /**
   * Mutable options for DeDuplicator's globalBreedingRate override.
   * The DeDuplicator temporarily sets globalBreedingRate = 1 on retry.
   */
  readonly options: NeatOptions;

  /**
   * Cached NeatConfig created once at construction time (Issue #1538).
   * Used directly in breed() instead of re-creating via createNeatConfig()
   * on every call.
   */
  private readonly cachedConfig: NeatConfig;

  /**
   * Issue #2523: Number of corrupt parent candidates skipped during the
   * most recent `breed()` call.
   */
  lastCorruptParentSkips = 0;

  /**
   * Creates a new Breed instance.
   *
   * @param genus - The genus containing the population
   * @param config - NEAT configuration options (used directly, no re-parsing)
   */
  constructor(genus: Genus, config: NeatConfig) {
    this.genus = genus;
    this.options = { ...config };
    this.cachedConfig = config;
  }

  /**
   * Returns the effective config, handling the DeDuplicator's
   * globalBreedingRate override. When the mutable options diverge
   * from the cached config, a lightweight override object is returned.
   */
  private getEffectiveConfig(): NeatConfig {
    if (
      this.options.globalBreedingRate !== this.cachedConfig.globalBreedingRate
    ) {
      // Return a thin override rather than re-running full createNeatConfig().
      // Only globalBreedingRate is ever mutated by DeDuplicator.
      return Object.freeze({
        ...this.cachedConfig,
        globalBreedingRate: this.options.globalBreedingRate!,
      });
    }
    return this.cachedConfig;
  }

  /**
   * Breeds two parents into an offspring.
   *
   * This method selects a mother and father from the population based on
   * fitness scores and genetic compatibility, then creates an offspring
   * through crossover and mutation. The population must be sorted by fitness.
   *
   * Issue #1538: Accepts an optional pre-computed FitnessRanking to avoid
   * reconstructing it on every call within the same generation.
   *
   * @param populationRanking - Optional pre-computed FitnessRanking.
   *   When omitted, a new ranking is created from the current population.
   * @returns A new offspring creature, or undefined if breeding fails
   * @throws {Error} When mother selection fails or father compatibility issues occur
   */
  breed(populationRanking?: FitnessRanking): Creature | undefined {
    const config = this.getEffectiveConfig();

    // Issue #2453: When fitness sharing is enabled, rank the population by
    // adjusted fitness (raw / speciesSize) so small species are not starved
    // by larger ones during mother selection.
    // Issue #2527: When `mcmcAdvantageMode === "groupRelative"`, replace
    // the raw-fitness ranking with the GRPO group-relative advantage so a
    // creature that is merely above its species mean is preferred over a
    // creature that is merely below an absolutely-higher species mean.
    let scoreOverride: ReadonlyMap<string, number> | undefined;
    if (config.mcmc.mcmcAdvantageMode === "groupRelative") {
      scoreOverride = buildGroupRelativeAdvantageMap(this.genus, {
        minCohortSize: config.mcmc.minCohortSize,
        eps: config.mcmc.advantageEps,
        clip: config.mcmc.advantageClip,
      });
    } else if (config.fitnessSharing.enabled) {
      scoreOverride = buildAdjustedFitnessMap(this.genus);
    }

    const ranking = populationRanking ??
      new FitnessRanking(this.genus.population, scoreOverride);

    // Issue #2528: On-Policy Distillation (OPD) breeding operator.
    // When `opd.breedRate > 0` and the dice roll succeeds, distil the
    // top-K elites into a fresh student instead of running standard
    // crossover. The operator skips itself silently when the elite
    // pool is empty so the rest of the breeding loop is unaffected.
    if (config.opd.breedRate > 0) {
      const rng = getRandomNumberGenerator();
      if (rng.random() < config.opd.breedRate) {
        const opdChild = this.tryOnPolicyDistillationBreed(ranking, config);
        if (opdChild) return opdChild;
      }
    }

    const mum = selectParent(ranking, config);

    assert(mum, "Mother is undefined");

    // Issue #2523: track corrupt-parent skips so the throughput summary
    // (and consumers calling this directly) can see producer corruption.
    const stats: BreedSelectionStats = { corruptParentSkips: 0 };
    let dad: Creature | undefined;
    try {
      dad = findFather(mum, this.genus, config, stats);
    } catch (error) {
      this.lastCorruptParentSkips = stats.corruptParentSkips;
      if (error instanceof BreedExhaustionError) {
        getLogger().warn(
          `[breed-skip-corrupt-parent] batch_exhausted skips=${error.corruptParentSkips} reason=${error.reason}`,
        );
        return;
      }
      throw error;
    }
    this.lastCorruptParentSkips = stats.corruptParentSkips;
    if (!dad) {
      getLogger().warn(
        "No father found",
      );

      return;
    }

    const child = Offspring.breed(
      mum,
      dad,
      {
        geneticCompatibilityThreshold: config.geneticCompatibilityThreshold,
        interSpeciesCrossoverThreshold: config.interSpeciesCrossoverThreshold,
        forwardOnly: config.feedbackLoop !== true,
        hyperparameterEvolution: config.hyperparameterEvolution,
      },
    );

    if (child && !child.memetic) {
      discover(mum, child);
    }

    return child;
  }

  /**
   * Attempt an On-Policy Distillation breed (Issue #2528).
   *
   * Selects the top-K elites from the fitness ranking and delegates to
   * {@link onPolicyDistillationBreed}. Returns the offspring on success,
   * or `undefined` when the elite pool is too small or distillation
   * fails — the caller falls back to standard crossover in either case.
   */
  private tryOnPolicyDistillationBreed(
    ranking: FitnessRanking,
    config: NeatConfig,
  ): Creature | undefined {
    const k = Math.max(1, config.opd.teacherCount);
    const elites = ranking.sortedPopulation.slice(0, k) as Creature[];
    if (elites.length === 0) return undefined;
    const result = onPolicyDistillationBreed(elites, config.opd);
    if (!result) return undefined;
    return result.offspring;
  }
}
