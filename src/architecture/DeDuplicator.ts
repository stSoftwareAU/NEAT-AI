import { assert } from "@std/assert";
import { format } from "@std/fmt/duration";
import type { Breed } from "@breed/Breed.ts";
import type { Creature } from "@creature";
import type { Mutator } from "@neat/Mutator.ts";
import { BloomFilter } from "@utils/BloomFilter.ts";
import { getLogger } from "@utils/Logger.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { passesProducerCompileGate } from "@wasm/ProducerCompileGuard.ts";

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
          const replaced = await this.replaceDuplicateCreature(
            creatures,
            indx,
            unique,
          );
          if (!replaced) {
            // Could not find a unique replacement — cull this duplicate
            toRemove.push(indx);
          }
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
            const replaced = await this.replaceDuplicateCreature(
              creatures,
              index,
              unique,
            );
            if (!replaced) {
              // Could not find a unique replacement — cull this duplicate
              toRemove.push(index);
            }
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
  ): Promise<boolean> {
    const globalBreedingRate = this.breed.options.globalBreedingRate;
    // Issue #2286: Cap replacement retries at configurable maximum (default 16)
    const maxRetries = this.breed.options.maxDedupRetries ?? 16;
    try {
      for (let attempts = 0; attempts < maxRetries; attempts++) {
        if (attempts === 12) {
          this.breed.options.globalBreedingRate = 1;
        }

        // Issue #2664: A bred offspring can occasionally fail creatureValidate
        // (e.g. duplicate neuron id surfaced by `Offspring.breed`) and the
        // TopologyError must not abort the whole dedup pass. Treat the failed
        // breed attempt as a no-op and fall through to the mutation fallback.
        let child: Creature | undefined;
        try {
          child = this.breed.breed();
        } catch (error) {
          if (
            error instanceof TopologyError || error instanceof ValidationError
          ) {
            const reason = (error as { reason?: string }).reason ?? "unknown";
            getLogger().warn(
              `[DeDuplicator] dropping invalid bred offspring ` +
                `(attempt ${attempts + 1}/${maxRetries}): ` +
                `${error.name} reason=${reason} - ${error.message}`,
            );
            child = undefined;
          } else {
            throw error;
          }
        }

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
            // Issue #2671: defence-in-depth — even though `Offspring.breed`
            // already runs the producer-compile gate, re-check the bred
            // child at the dedup commit seam so a stray bad topology cannot
            // reach the WASM cache via the replacement path.
            if (!passesProducerCompileGate(child, "DeDuplicator/breed")) {
              continue;
            }
            unique.add(key2);
            this.bloomFilter.add(key2);
            creatures[index] = child;
            this.breed.genus.addCreature(child);
            return true;
          }
        }
        // Issue #2308: Use shallowClone() instead of fromJSON(exportJSON())
        // for a ~19x speed improvement per clone at production scale.
        const tmpCreature = creatures[index].shallowClone();
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
          // Issue #2671: gate the mutate-clone replacement at the commit seam.
          if (!passesProducerCompileGate(tmpCreature, "DeDuplicator/mutate")) {
            continue;
          }
          this.breed.genus.addCreature(tmpCreature);
          creatures[index] = tmpCreature;
          unique.add(key3);
          this.bloomFilter.add(key3);
          return true;
        }
      }

      // All main retries exhausted. Use an extended fallback to guarantee
      // population preservation. With mutationRate < 1, up to 70% of mutate()
      // calls are no-ops (UUID unchanged). 50 fallback attempts give a
      // failure probability of 0.7^50 ≈ 10^-8 per duplicate — negligible.
      // The last attempt force-accepts to ensure population is never reduced.
      const maxFallbackAttempts = 50;
      for (let fb = 0; fb < maxFallbackAttempts; fb++) {
        // Issue #2308: Use shallowClone() for performance.
        const fallbackCreature = creatures[index].shallowClone();
        this.mutator.mutate([fallbackCreature]);
        const fallbackKey = CreatureUtil.makeUUID(fallbackCreature);

        const isUnique = !unique.has(fallbackKey);
        const isLastAttempt = fb === maxFallbackAttempts - 1;

        if (isUnique || isLastAttempt) {
          // Issue #2671: gate the fallback replacement. On gate failure, skip
          // this fallback and try the next one (unless this is the last
          // attempt, in which case we return false so the caller culls the
          // duplicate instead of seeding a broken topology into the
          // population).
          if (
            !passesProducerCompileGate(
              fallbackCreature,
              "DeDuplicator/fallback",
            )
          ) {
            if (isLastAttempt) {
              return false;
            }
            continue;
          }
          if (!isUnique) {
            getLogger().warn(
              `De-duplication: force-accepting non-unique creature after ` +
                `${maxRetries} retries + ${maxFallbackAttempts} fallbacks ` +
                `for creature at index ${index} of ${creatures.length}.`,
            );
          } else {
            getLogger().warn(
              `De-duplication retry cap (${maxRetries}) reached for creature ` +
                `at index ${index} of ${creatures.length}. ` +
                `Accepted unique fallback on attempt ${fb + 1}.`,
            );
          }
          this.breed.genus.addCreature(fallbackCreature);
          creatures[index] = fallbackCreature;
          unique.add(fallbackKey);
          this.bloomFilter.add(fallbackKey);
          return true;
        }
      }

      // Reached when the gate rejects the last fallback (Issue #2671).
      // Caller treats `false` as "cull this duplicate" so a bad topology
      // is not seeded into the population.
      return false;
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
