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
 *
 * Issue #2286: previousExperiment() uses async file I/O with batched checks
 * and per-generation caching to avoid blocking the event loop and redundant
 * filesystem lookups. Replacement breeding retries are capped at a configurable
 * maximum (default 16).
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
   * Issue #2286: Per-generation cache for previousExperiment() results.
   * Avoids redundant filesystem lookups for the same UUID within a single
   * de-duplication pass.
   */
  private previousExperimentCache: Map<string, boolean> = new Map();

  constructor(breed: Breed, mutator: Mutator) {
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

    // Issue #2286: Clear previousExperiment cache for this generation
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

    // Issue #2286: Batch async previousExperiment() checks for non-duplicate
    // creatures. Collect candidates first, then check in parallel.
    const candidatesForPreviousExperiment: {
      index: number;
      uuid: string;
    }[] = [];

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
          candidatesForPreviousExperiment.push({ index: indx, uuid: UUID });
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
          // Sequential: modifies shared creatures array and unique set in-place
          // deno-lint-ignore no-await-in-loop
          await this.replaceDuplicateCreature(creatures, indx, unique);
        }
      }
    }

    // Issue #2286: Batch async previousExperiment() checks using Promise.allSettled()
    if (candidatesForPreviousExperiment.length > 0) {
      const startPreviousExperiment = Date.now();
      const results = await Promise.allSettled(
        candidatesForPreviousExperiment.map(async ({ uuid }) => {
          return {
            uuid,
            found: await this.previousExperiment(uuid),
          };
        }),
      );

      previousExperimentMS += Date.now() - startPreviousExperiment;

      // Process results: mark previously-seen creatures as duplicates
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled" && result.value.found) {
          const { index } = candidatesForPreviousExperiment[i];
          if (
            creatures.length - toRemove.length >
              this.breed.options.populationSize!
          ) {
            if (this.breed.options.debug || this.breed.options.verbose) {
              getLogger().debug(
                `Culling previous-experiment creature at ${
                  index - toRemove.length
                } of ${creatures.length - toRemove.length}`,
              );
            }
            toRemove.push(index);
          } else {
            // Sequential: modifies shared creatures array and unique set in-place
            // deno-lint-ignore no-await-in-loop
            await this.replaceDuplicateCreature(creatures, index, unique);
          }
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

  private async replaceDuplicateCreature(
    creatures: Creature[],
    index: number,
    unique: Set<string>,
  ) {
    const globalBreedingRate = this.breed.options.globalBreedingRate;
    // Issue #2286: Cap replacement retries at configurable maximum (default 16)
    const maxRetries = this.breed.options.maxDedupRetries ?? 16;
    try {
      for (let attempts = 0; attempts < maxRetries; attempts++) {
        if (attempts === 12) {
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
            // Sequential: each retry iteration depends on the result
            // deno-lint-ignore no-await-in-loop
            duplicate2 = await this.previousExperiment(key2);
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
          // Sequential: each retry iteration depends on the result
          // deno-lint-ignore no-await-in-loop
          duplicate3 = await this.previousExperiment(key3);
        }
        if (!duplicate3) {
          this.breed.genus.addCreature(tmpCreature);
          creatures[index] = tmpCreature;
          unique.add(key3);
          this.bloomFilter.add(key3);
          return;
        }
      }

      // Issue #2286: Retry cap reached — accept the last mutated creature
      // rather than continuing the expensive loop or splicing the creature out.
      getLogger().warn(
        `De-duplication retry cap (${maxRetries}) reached for creature at index ${index} of ${creatures.length}. Accepting mutated duplicate.`,
      );
      const fallbackCreature = Creature.fromJSON(
        creatures[index].exportJSON(),
      );
      this.mutator.mutate([fallbackCreature]);
      const fallbackKey = CreatureUtil.makeUUID(fallbackCreature);
      this.breed.genus.addCreature(fallbackCreature);
      creatures[index] = fallbackCreature;
      unique.add(fallbackKey);
      this.bloomFilter.add(fallbackKey);
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
   * Check whether a creature with the given UUID key was seen in a
   * previous experiment. Uses async file I/O and per-generation caching
   * (Issue #2286) to avoid blocking the event loop and redundant lookups.
   */
  async previousExperiment(key: string): Promise<boolean> {
    if (this.breed.options.experimentStore) {
      // Issue #2286: Check per-generation cache first
      const cached = this.previousExperimentCache.get(key);
      if (cached !== undefined) {
        return cached;
      }

      const filePath = `${this.breed.options.experimentStore}/score/${
        key.substring(0, 3)
      }/${key.substring(3)}.txt`;
      try {
        // Issue #2286: Use async Deno.stat() instead of synchronous Deno.statSync()
        await Deno.stat(filePath);
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
