import { assert } from "@std/assert";
import type { Creature } from "../../mod.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { discover } from "@blackbox/Discover.ts";
import type { NeatConfig } from "@config/NeatConfig.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { BreedExhaustionError } from "@errors/BreedExhaustionError.ts";
import type { Genus } from "@neat/Genus.ts";
import { FitnessRanking } from "@breed/FitnessRanking.ts";
import {
  type BreedSelectionStats,
  buildAdjustedFitnessMap,
  findFather,
  selectParent,
} from "@breed/ParentSelection.ts";
import { getLogger } from "@utils/Logger.ts";

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
    const adjustedScores = config.fitnessSharing.enabled
      ? buildAdjustedFitnessMap(this.genus)
      : undefined;
    const ranking = populationRanking ??
      new FitnessRanking(this.genus.population, adjustedScores);

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
}
