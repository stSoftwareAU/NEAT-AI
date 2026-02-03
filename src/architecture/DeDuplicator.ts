import { assert } from "@std/assert";
import { format } from "@std/fmt/duration";
import type { Breed } from "../breed/Breed.ts";
import { Creature } from "../Creature.ts";
import type { Mutator } from "../NEAT/Mutator.ts";
import { BloomFilter } from "../utils/BloomFilter.ts";
import { CreatureUtil } from "./CreatureUtils.ts";

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

  constructor(breed: Breed, mutator: Mutator) {
    this.breed = breed;
    this.mutator = mutator;

    // Create Bloom filter sized for expected population with <1% false positive rate
    // Using population size * 1.5 to account for temporary over-population
    const expectedItems = Math.max(
      100,
      (this.breed.options.populationSize ?? 100) * 1.5,
    );
    this.bloomFilter = BloomFilter.create(expectedItems, 0.01);
  }

  public perform(creatures: Creature[]) {
    const start = Date.now();
    let previousExperimentMS = 0;
    this.logPopulationSize(creatures);

    // Issue #1292: Clear Bloom filter for this generation
    this.bloomFilter.clear();

    // First pass: compute UUIDs and add to genus
    for (const creature of creatures) {
      CreatureUtil.makeUUID(creature);
      this.breed.genus.addCreature(creature);
    }

    // Second pass: Detect and handle duplicates
    const unique = new Set<string>();
    const toRemove: number[] = [];

    for (let indx = 0; indx < creatures.length; indx++) {
      const creature = creatures[indx];
      const UUID = creature.uuid;
      assert(UUID, "No creature UUID");

      // Issue #1292: Use Bloom filter as fast pre-check
      // If Bloom filter says "not present", skip Set.has() entirely
      let duplicate = false;
      if (this.bloomFilter.mayContain(UUID)) {
        // Possible duplicate - confirm with exact Set check
        duplicate = unique.has(UUID);
      }

      // Add to Bloom filter AFTER checking (to avoid self-match)
      this.bloomFilter.add(UUID);

      if (!duplicate) {
        if (indx > this.breed.options.elitism!) {
          const startPreviousExperiment = Date.now();
          duplicate = this.previousExperiment(UUID);
          previousExperimentMS += Date.now() - startPreviousExperiment;
        }
        unique.add(UUID);
      }

      if (duplicate) {
        if (
          creatures.length - toRemove.length >
            this.breed.options.populationSize!
        ) {
          if (this.breed.options.debug || this.breed.options.verbose) {
            console.debug(
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

    // Third pass: Remove duplicates
    for (let removeIndx = toRemove.length; removeIndx--;) {
      const indx = toRemove[removeIndx];
      creatures.splice(indx, 1);
    }

    if (toRemove.length > 0) {
      const end = Date.now();
      const difference = format(end - start, {
        ignoreZero: true,
      });
      console.log(
        `DeDuplication of ${toRemove.length} creatures to ${creatures.length} in ${difference} (previous experiment ${
          format(
            previousExperimentMS,
            { ignoreZero: true },
          )
        })`,
      );
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
        if (attempts === 12) {
          this.breed.options.globalBreedingRate = 1;
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
        const tmpCreature = Creature.fromJSON(creatures[index].exportJSON());
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
        } else if (attempts > 48) {
          console.error(
            `Can't deDuplicate creature at ${index} of ${creatures.length}`,
          );
          creatures.splice(index, 1);
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
        console.debug(
          `Over populated ${creatures.length}, expected ${this.breed.options
            .populationSize!}.`,
        );
      }
    }
  }

  previousExperiment(key: string): boolean {
    if (this.breed.options.experimentStore) {
      const filePath = `${this.breed.options.experimentStore}/score/${
        key.substring(0, 3)
      }/${key.substring(3)}.txt`;
      try {
        Deno.statSync(filePath);
        return true;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
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
