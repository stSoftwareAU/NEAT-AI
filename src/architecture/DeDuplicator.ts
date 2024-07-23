import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import type { Breed } from "../NEAT/Breed.ts";
import type { Mutator } from "../NEAT/Mutator.ts";
import { CreatureUtil } from "./CreatureUtils.ts";

export class DeDuplicator {
  private breed: Breed;
  private mutator: Mutator;

  constructor(breed: Breed, mutator: Mutator) {
    this.breed = breed;
    this.mutator = mutator;
  }

  public perform(creatures: Creature[]) {
    const start = performance.now();

    this.logPopulationSize(creatures);

    creatures.map((creature) => {
      CreatureUtil.makeUUID(creature);

      this.breed.genus.addCreature(creature);
    });

    const unique = new Set<string>();
    const toRemove: number[] = [];

    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
      const UUID = creature.uuid;
      assert(UUID, "No creature UUID");
      let duplicate = unique.has(UUID);

      if (!duplicate) {
        if (i > this.breed.config.elitism) {
          duplicate = this.previousExperiment(UUID);
        }
        unique.add(UUID);
      }

      if (duplicate) {
        if (
          creatures.length - toRemove.length > this.breed.config.populationSize
        ) {
          console.info(
            `Culling duplicate creature at ${i}`,
          );
          toRemove.push(i);
        } else {
          this.replaceDuplicateCreature(creatures, i, unique);
        }
      }
    }

    // Second pass to remove duplicates
    for (let i = toRemove.length - 1; i >= 0; i--) {
      creatures.splice(toRemove[i], 1);
    }

    if (toRemove.length > 0) {
      const end = performance.now();
      console.log(
        `DeDuplication of ${toRemove.length} creatures took ${end - start} ms`,
      );
    }
  }

  private replaceDuplicateCreature(
    creatures: Creature[],
    index: number,
    unique: Set<string>,
  ) {
    for (let attempts = 0; true; attempts++) {
      const child = this.breed.breed();

      if (child) {
        const key2 = CreatureUtil.makeUUID(child);
        let duplicate2 = unique.has(key2);
        if (!duplicate2 && index > this.breed.config.elitism) {
          duplicate2 = this.previousExperiment(key2);
        }
        if (!duplicate2) {
          unique.add(key2);
          creatures[index] = child;
          this.breed.genus.addCreature(child);
          return;
        }
      }
      const tmpCreature = creatures[index];
      this.mutator.mutate([tmpCreature]);
      const key3 = CreatureUtil.makeUUID(tmpCreature);
      let duplicate3 = unique.has(key3);
      if (!duplicate3 && index > this.breed.config.elitism) {
        duplicate3 = this.previousExperiment(key3);
      }
      if (!duplicate3) {
        this.breed.genus.addCreature(tmpCreature);
        unique.add(key3);
        return;
      } else if (attempts > 24) {
        console.error(
          `Can't deDuplicate creature at ${index} of ${creatures.length}`,
        );
        creatures.splice(index, 1);
        return;
      }
    }
  }

  private logPopulationSize(creatures: Creature[]) {
    if (creatures.length > this.breed.config.populationSize + 1) {
      console.info(
        `Over populated ${creatures.length}, expected ${this.breed.config.populationSize}.`,
      );
    }
  }

  previousExperiment(key: string): boolean {
    if (this.breed.config.experimentStore) {
      const filePath = `${this.breed.config.experimentStore}/score/${
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
