import { Creature } from "../Creature.ts";
import { NeatConfig } from "../config/NeatConfig.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import { Neat } from "./Neat.ts";

export class DeDuplicator {
  private config: NeatConfig;
  private neat: Neat;

  constructor(neat: Neat) {
    this.config = neat.config;
    this.neat = neat;
  }

  public async perform(creatures: Creature[]) {
    this.logPopulationSize(creatures);

    const unique = new Set<string>();
    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
      const key = await CreatureUtil.makeUUID(creature);

      let duplicate = unique.has(key);
      if (!duplicate && i > this.config.elitism) {
        duplicate = this.previousExperiment(key);
      }

      if (duplicate) {
        if (creatures.length > this.config.populationSize) {
          console.info(
            `Culling duplicate creature at ${i} of ${creatures.length}`,
          );
          creatures.splice(i, 1);
          i--;
        } else {
          for (let attempts = 0; true; attempts++) {
            const child = this.neat.offspring();

            if (child) {
              const key2 = await CreatureUtil.makeUUID(child);
              let duplicate2 = unique.has(key);
              if (!duplicate2 && i > this.config.elitism) {
                duplicate2 = this.previousExperiment(key2);
              }
              if (!duplicate2) {
                unique.add(key2);
                creatures[i] = child;
                break;
              }
            }
            this.neat.mutate([creature]);
            const key3 = await CreatureUtil.makeUUID(creature);
            let duplicate3 = unique.has(key3);
            if (!duplicate3 && i > this.config.elitism) {
              duplicate3 = this.previousExperiment(key3);
            }
            if (!duplicate3) {
              unique.add(key3);
              break;
            } else if (attempts > 12) {
              console.error(
                `Can't deDuplicate creature at ${i} of ${creatures.length}`,
              );
              creatures.splice(i, 1);
              i--;
              break;
            }
          }
        }
      }
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
}
