import { assert } from "@std/assert";
import { format } from "@std/fmt/duration";
import type { Breed } from "@breed/Breed.ts";
import { Creature } from "@creature";
import type { Mutator } from "@neat/Mutator.ts";
import { BloomFilter } from "@utils/BloomFilter.ts";
import { getLogger } from "@utils/Logger.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

/**
 * Maximum number of replacement breeding retries per duplicate (Issue #2286).
 * After this many attempts, accept the best mutated candidate rather than
 * continuing the loop. A warning is logged when this cap is reached.
 * Set to 16 as a balance between finding unique replacements and avoiding
 * excessive looping (previously unbounded up to 48+ attempts).
 */
const DEFAULT_MAX_REPLACEMENT_RETRIES = 16;

/**
 * DeDuplicator - Removes duplicate creatures from a population.
 *
 * Uses a Bloom filter (Issue #1292) as a fast first-pass check for duplicates,
 * reducing overhead in the duplicate detection phase. The Bloom filter provides:
 *
 * 1. **Fast rejection**: If mayContain() returns false, the UUID is definitely
 *    not a duplicate - skip the Set.has() call entirely
 * 2. **Probabilistic matching**: If mayContain() returns true, do the exact
 *    Set.has() check to confirm
 *
 * Performance benefit: When most creatures in a population are unique (the
 * common case in healthy evolution), the Bloom filter quickly rejects non-duplicates
 * without needing to hash and probe the Set's internal data structure.
 *
 * Issue #2286: previousExperiment() uses async file I/O with per-generation
 * caching, and replacement breeding retries are capped.
 *
 * The filter is cleared each generation to maintain optimal performance.
 */
export class DeDuplicator {
  private breed: Breed;
  private mutator: Mutator;

  /**
   * Bloom filter for fast duplicate pre-filtering (Issue #1292).
   * Provides O(k) rejection where k is the number of hash functions,
   * avoiding Set.has() overhead for definitely-unique UUIDs.
   */
  private bloomFilter: BloomFilter;

  /**
   * Per-generation cache for previousExperiment() results (Issue #2286).
   * Avoids redundant filesystem lookups within the same deduplication pass.
   */
  private previousExperimentCache: Map<string, boolean>;

  /**
   * Maximum replacement breeding retries per duplicate (Issue #2286).
   * Configurable to allow tuning for different population sizes.
   */
  private maxReplacementRetries: number;

  constructor(
    breed: Breed,
    mutator: Mutator,
    maxReplacementRetries: number = DEFAULT_MAX_REPLACEMENT_RETRIES,
  ) {
    this.breed = breed;
    this.mutator = mutator;
    this.maxReplacementRetries = maxReplacementRetries;
    this.previousExperimentCache = new Map();

    // Create Bloom filter sized for expected population with <1% false positive rate
    // Using population size * 1.5 to account for temporary over-population
    const expectedItems = Math.max(
      100,
      (this.breed.options.populationSize ?? 100) * 1.5,
    );
    this.bloomFilter = BloomFilter.create(expectedItems, 0.01);
  }

  public async perform(creatures: Creature[]) {
    const start = Date.now();
    let previousExperimentMS = 0;
    this.logPopulationSize(creatures);

    // Issue #1292: Clear Bloom filter for this generation
    this.bloomFilter.clear();

    // Issue #2286: Clear per-generation cache
    this.previousExperimentCache.clear();

    // First pass: compute UUIDs and add to genus
    for (const creature of creatures) {
      CreatureUtil.makeUUID(creature);
      this.breed.genus.addCreature(creature);
    }

    // Second pass: Detect and handle duplicates
    // Issue #2286: Batch async previousExperiment() checks for candidates
    const unique = new Set<string>();
    const toRemove: number[] = [];

    // Collect candidates that need previousExperiment() checks
    const candidateIndices: number[] = [];
    const candidateUUIDs: string[] = [];

    for (let indx = 0; indx < creatures.length; indx++) {
      const creature = creatures[indx];
      const UUID = creature.uuid;
      assert(UUID, "No creature UUID");

      // Issue #1292: Use Bloom filter as fast pre-check
      let duplicate = false;
      if (this.bloomFilter.mayContain(UUID)) {
        duplicate = unique.has(UUID);
      }

      this.bloomFilter.add(UUID);

      if (!duplicate) {
        if (indx > this.breed.options.elitism!) {
          // Queue for batched async check instead of synchronous per-item
          candidateIndices.push(indx);
          candidateUUIDs.push(UUID);
        }
        unique.add(UUID);
      }

      if (duplicate) {
        if (
          creatures.length - toRemove.length >
            this.breed.options.populationSize!
        ) {
          if (this.breed.options.debug || this.breed.options.verbose) {
            getLogger().debug(
              `Culling duplicate creature at ${indx - toRemove.length} of ${
                creatures.length - toRemove.length
              }`,
            );
          }
          toRemove.push(indx);
        } else {
          this.replaceDuplicateCreature(creatures, indx, unique);
        }
      }
    }

    // Issue #2286: Batch async previousExperiment() checks
    if (candidateUUIDs.length > 0) {
      const startPreviousExperiment = Date.now();
      const results = await this.batchPreviousExperiment(candidateUUIDs);
      previousExperimentMS = Date.now() - startPreviousExperiment;

      for (let i = 0; i < candidateIndices.length; i++) {
        if (results[i]) {
          const indx = candidateIndices[i];
          // This UUID was seen in a previous experiment - it's a duplicate
          if (
            creatures.length - toRemove.length >
              this.breed.options.populationSize!
          ) {
            if (this.breed.options.debug || this.breed.options.verbose) {
              getLogger().debug(
                `Culling previous-experiment duplicate at ${
                  indx - toRemove.length
                } of ${creatures.length - toRemove.length}`,
              );
            }
            toRemove.push(indx);
          } else {
            this.replaceDuplicateCreature(creatures, indx, unique);
          }
        }
      }
    }

    // Third pass: Remove duplicates using in-place filter (Issue #1477)
    // Uses a Set of indices for O(n) removal instead of O(n*d) splice loop
    if (toRemove.length > 0) {
      const removeSet = new Set(toRemove);
      let writeIndex = 0;
      for (let readIndex = 0; readIndex < creatures.length; readIndex++) {
        if (!removeSet.has(readIndex)) {
          creatures[writeIndex++] = creatures[readIndex];
        }
      }
      creatures.length = writeIndex;

      const end = Date.now();
      const difference = format(end - start, {
        ignoreZero: true,
      });
      getLogger().info(
        `DeDuplication of ${toRemove.length} creatures to ${creatures.length} in ${difference} (previous experiment ${
          format(
            previousExperimentMS,
            { ignoreZero: true },
          )
        })`,
      );
    }
  }

  /**
   * Batch check multiple UUIDs against previous experiments using async I/O
   * (Issue #2286). Uses Promise.allSettled() for concurrent file stat checks
   * and caches results to avoid redundant lookups.
   */
  private async batchPreviousExperiment(
    keys: string[],
  ): Promise<boolean[]> {
    if (!this.breed.options.experimentStore) {
      return new Array(keys.length).fill(false);
    }

    const results: boolean[] = new Array(keys.length);
    const uncachedIndices: number[] = [];
    const uncachedPromises: Promise<boolean>[] = [];

    // Check cache first
    for (let i = 0; i < keys.length; i++) {
      const cached = this.previousExperimentCache.get(keys[i]);
      if (cached !== undefined) {
        results[i] = cached;
      } else {
        uncachedIndices.push(i);
        uncachedPromises.push(this.asyncPreviousExperiment(keys[i]));
      }
    }

    // Batch async checks for uncached keys
    if (uncachedPromises.length > 0) {
      const settled = await Promise.allSettled(uncachedPromises);
      for (let j = 0; j < settled.length; j++) {
        const result = settled[j];
        const found = result.status === "fulfilled" ? result.value : false;
        const idx = uncachedIndices[j];
        results[idx] = found;
        this.previousExperimentCache.set(keys[idx], found);
      }
    }

    return results;
  }

  /**
   * Async file stat check for a single UUID (Issue #2286).
   * Replaces synchronous Deno.statSync() with async Deno.stat().
   */
  private async asyncPreviousExperiment(key: string): Promise<boolean> {
    const filePath = `${this.breed.options.experimentStore}/score/${
      key.substring(0, 3)
    }/${key.substring(3)}.txt`;
    try {
      await Deno.stat(filePath);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      } else {
        throw error;
      }
    }
  }

  private replaceDuplicateCreature(
    creatures: Creature[],
    index: number,
    unique: Set<string>,
  ) {
    const globalBreedingRate = this.breed.options.globalBreedingRate;
    try {
      for (let attempts = 0; true; attempts++) {
        // Boost breeding rate at half the retry cap to increase diversity
        if (attempts === Math.floor(this.maxReplacementRetries / 2)) {
          this.breed.options.globalBreedingRate = 1;
        }

        // Issue #2286: Cap replacement retries to avoid excessive looping
        if (attempts >= this.maxReplacementRetries) {
          getLogger().warn(
            `Replacement retry cap (${this.maxReplacementRetries}) reached ` +
              `for creature at index ${index} of ${creatures.length}. ` +
              `Accepting mutated duplicate to avoid excessive dedup pressure.`,
          );
          // Accept the last mutated creature rather than continuing
          const fallback = Creature.fromJSON(
            creatures[index].exportJSON(),
          );
          this.mutator.mutate([fallback]);
          const fallbackKey = CreatureUtil.makeUUID(fallback);
          this.breed.genus.addCreature(fallback);
          creatures[index] = fallback;
          unique.add(fallbackKey);
          this.bloomFilter.add(fallbackKey);
          return;
        }
        const child = this.breed.breed();

        if (child) {
          const key2 = CreatureUtil.makeUUID(child);

          // Issue #1292: Use Bloom filter as fast pre-check
          const mayBeDuplicate2 = this.bloomFilter.mayContain(key2);
          let duplicate2 = mayBeDuplicate2 ? unique.has(key2) : false;

          if (!duplicate2 && index > this.breed.options.elitism!) {
            duplicate2 = this.previousExperiment(key2);
          }
          if (!duplicate2) {
            unique.add(key2);
            this.bloomFilter.add(key2);
            creatures[index] = child;
            this.breed.genus.addCreature(child);
            return;
          }
        }
        const tmpCreature = Creature.fromJSON(
          creatures[index].exportJSON(),
        );
        this.mutator.mutate([tmpCreature]);
        const key3 = CreatureUtil.makeUUID(tmpCreature);

        // Issue #1292: Use Bloom filter as fast pre-check
        const mayBeDuplicate3 = this.bloomFilter.mayContain(key3);
        let duplicate3 = mayBeDuplicate3 ? unique.has(key3) : false;

        if (!duplicate3 && index > this.breed.options.elitism!) {
          duplicate3 = this.previousExperiment(key3);
        }
        if (!duplicate3) {
          this.breed.genus.addCreature(tmpCreature);
          creatures[index] = tmpCreature;
          unique.add(key3);
          this.bloomFilter.add(key3);
          return;
        }
      }
    } finally {
      this.breed.options.globalBreedingRate = globalBreedingRate;
    }
  }

  private logPopulationSize(creatures: Creature[]) {
    if (creatures.length > this.breed.options.populationSize! + 1) {
      if (this.breed.options.debug || this.breed.options.verbose) {
        getLogger().debug(
          `Over populated ${creatures.length}, expected ${this.breed.options
            .populationSize!}.`,
        );
      }
    }
  }

  /**
   * Synchronous previousExperiment check with per-generation caching
   * (Issue #2286). Used in replacement breeding where async is not feasible.
   * The cache is shared with the async batch path to avoid redundant lookups.
   */
  previousExperiment(key: string): boolean {
    // Check cache first (Issue #2286)
    const cached = this.previousExperimentCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    if (this.breed.options.experimentStore) {
      const filePath = `${this.breed.options.experimentStore}/score/${
        key.substring(0, 3)
      }/${key.substring(3)}.txt`;
      try {
        Deno.statSync(filePath);
        this.previousExperimentCache.set(key, true);
        return true;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          this.previousExperimentCache.set(key, false);
          return false;
        } else {
          throw error;
        }
      }
    } else {
      return false;
    }
  }
}
