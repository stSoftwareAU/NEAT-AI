import { Creature } from "../Creature.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import { Neat, NeatConfig } from "./Neat.ts";

export class DeDuplicator {
  private config: NeatConfig;
  private neat: Neat;
  //   private static readonly MAX_ATTEMPTS = 100; // Constant for max attempts to resolve conflicts

  constructor(neat: Neat) {
    this.config = neat.config;
    this.neat = neat;
  }

  public async perform(creatures: Creature[]) {
    this.logPopulationSize(creatures);

    const uniqueCreatures: Creature[] = [];
    const unique = new Set<string>();
    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
      const key = await CreatureUtil.makeUUID(creature);

      if (uniqueCreatures.length > this.config.elitism) {
        if (!unique.has(key) && !this.previousExperiment(key)) {
          unique.add(key);
          uniqueCreatures.push(creature);
        }
      } else if (!unique.has(key)) {
        unique.add(key);
        uniqueCreatures.push(creature);
      }
    }
    creatures.length = 0;
    for (const creature of uniqueCreatures) {
      creatures.push(creature);
    }
  }

  private logPopulationSize(creatures: Creature[]) {
    if (creatures.length > this.config.populationSize + 1) {
      console.info(
        `Over populated ${creatures.length}, expected ${this.config.populationSize}.`,
      );
    }
  }

  previousExperiment(key: string) {
    if (this.config.experimentStore) {
      const filePath = this.config.experimentStore + "/score/" +
        key.substring(0, 3) + "/" + key.substring(3) + ".txt";
      try {
        Deno.statSync(filePath);

        return true;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          // file or directory does not exist
          return false;
        } else {
          // unexpected error, maybe permissions, pass it along
          throw error;
        }
      }
    } else {
      return false;
    }
  }

  //   private isDuplicate(
  //     unique: Map<string, Creature>,
  //     key: string,
  //   ): boolean {
  //     if (unique.has(key)) return true;

  //     if (unique.size < this.config.elitism) return false;

  //     return this.previousExperiment(key);
  //   }

  //   private async handleDuplicate(
  //     unique: Map<string, Creature>,
  //   ) {
  //     if (unique.size >= this.config.populationSize) {
  //       console.info(
  //         `Culling duplicate creature at ${unique.size}`,
  //       );
  //     } else {
  //       await this.resolveConflict(unique);
  //     }
  //   }

  //   private async resolveConflict(
  //     unique: Map<string, Creature>,
  //   ) {
  //     const child = this.neat.offspring();
  //     if (!child) return;

  //     const key = await CreatureUtil.makeUUID(child);
  //     if (!(this.isDuplicate(unique, key))) {
  //       unique.set(key, child);
  //       return;
  //     }

  //     this.neat.mutate([child]);
  //     const mutatedKey = await CreatureUtil.makeUUID(child);
  //     if (!(this.isDuplicate(unique, mutatedKey))) {
  //       unique.set(mutatedKey, child);
  //       return;
  //     }
  //   }
}
