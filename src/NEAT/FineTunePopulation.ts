import { assert } from "@std/assert";
import { type Creature, CreatureUtil } from "../../mod.ts";
import type { Genus } from "./Genus.ts";
import { fineTuneImprovement } from "../architecture/FineTune.ts";
import { Species } from "./Species.ts";
import type { Neat } from "./Neat.ts";
import { logApproach } from "./LogApproach.ts";

export class FindTunePopulation {
  private neat: Neat;
  constructor(neat: Neat) {
    this.neat = neat;
  }

  make(
    fittest: Creature,
    previousFittest: Creature | undefined,
    genus: Genus,
  ) {
    assert(fittest, "Fittest creature mandatory");
    const fittestUUID = CreatureUtil.makeUUID(fittest);

    const uniqueUUID = new Set<string>([fittestUUID]);

    const tmpFineTunePopulation = [];

    let tmpPreviousFittest: Creature | undefined = undefined;
    // Add previousFittest first if it's different from fittest and not null
    if (
      previousFittest
    ) {
      const previousUUID = CreatureUtil.makeUUID(previousFittest);
      if (!uniqueUUID.has(previousUUID)) {
        if (previousFittest.score && fittest.score) {
          if (previousFittest.score < fittest.score) {
            tmpPreviousFittest = previousFittest;
            tmpFineTunePopulation.push(previousFittest);
          } else if (previousFittest.score > fittest.score) {
            throw new Error(
              `Previous fittest has a higher score than fittest, this should not happen`,
            );
          }
        } else {
          throw new Error(
            "Previous fittest has no score, excluded from fine tune population",
          );
        }

        uniqueUUID.add(previousUUID);
      }
    }

    // Add remaining creatures from the population excluding fittest and previousFittest
    for (const creature of this.neat.population) {
      const creatureUUID = CreatureUtil.makeUUID(creature);
      if (!uniqueUUID.has(creatureUUID)) {
        if (creature.score && fittest.score) {
          if (creature.score < fittest.score) {
            if (!tmpPreviousFittest) {
              tmpPreviousFittest = creature;
            }
            tmpFineTunePopulation.push(creature);
          } else if (creature.score > fittest.score) {
            throw new Error(
              `Previous fittest has a higher score than fittest, this should not happen`,
            );
          }
        } else {
          throw new Error(
            `Creature ${creatureUUID} has invalid score`,
          );
        }

        uniqueUUID.add(creatureUUID);
      }
    }

    let fineTunedPopulation: Creature[] = [];
    if (!tmpPreviousFittest) {
      console.warn(
        "Failed to find previous fittest creature, all the same score as fittest. Skipping fine tuning.",
      );
    } else {
      /** 20% of population or those that just died, leave one for the extended */
      const fineTunePopSize = Math.max(
        Math.ceil(
          this.neat.config.populationSize / 5,
        ),
        this.neat.config.populationSize - this.neat.population.length -
          this.neat.config.elitism -
          this.neat.trainingComplete.length,
      );

      const tunedUUID = new Set<string>();

      tunedUUID.add(fittestUUID);
      assert(tmpPreviousFittest.uuid, "tmpPreviousFittest UUID is undefined");
      tunedUUID.add(tmpPreviousFittest.uuid);
      if (fittestUUID !== tmpPreviousFittest.uuid) {
        fineTunedPopulation = fineTuneImprovement(
          fittest,
          tmpPreviousFittest,
          fineTunePopSize - 1,
        );
        logApproach(fittest, tmpPreviousFittest);
      }

      for (let attempts = 0; attempts < 12; attempts++) {
        /**
         * Now, after we do the fine tuning of the fittest versus the previous fittest,
         * I want to find another creature from the same species of the fittest creature ( but not the fittest or previous fittest creatures)
         * and perform the fine tuning comparing the fittest creature to another within the species.
         *
         * We should favor the highest score creatures in that species.
         */

        const speciesFineTunePopSize = fineTunePopSize -
          fineTunedPopulation.length;

        if (speciesFineTunePopSize < 1) break;

        const speciesKey = Species.calculateKey(fittest);
        const species = genus.speciesMap.get(speciesKey);

        if (species) {
          if (species.creatures.length > 0) { // Ensure there's more than one to choose from
            let eligibleCreatures = species.creatures.filter((creature) =>
              !tunedUUID.has((creature as { uuid: string }).uuid)
            );

            /** If there is no eligible creatures try find the closest species. */
            if (eligibleCreatures.length == 0) {
              const closestSpecies = genus.findClosestMatchingSpecies(fittest);
              if (closestSpecies) {
                if (closestSpecies && closestSpecies.creatures.length > 0) {
                  eligibleCreatures = closestSpecies.creatures.filter(
                    (creature) =>
                      !tunedUUID.has((creature as { uuid: string }).uuid),
                  );
                }
              }
            }

            if (eligibleCreatures.length > 0) {
              // Introduce random selection, weighted towards higher score creatures
              const nextBestCreature = this.weightedRandomSelect(
                eligibleCreatures,
              );

              assert(nextBestCreature.uuid, "Creature UUID is undefined");
              tunedUUID.add(nextBestCreature.uuid);
              const extendedTunedPopulation = fineTuneImprovement(
                fittest,
                nextBestCreature,
                speciesFineTunePopSize,
              );

              fineTunedPopulation.push(...extendedTunedPopulation);
            }
          }
        } else {
          throw new Error(`No species found for key ${speciesKey}`);
        }

        const extendedFineTunePopSize = fineTunePopSize -
          fineTunedPopulation.length;
        if (extendedFineTunePopSize > 0 && tmpFineTunePopulation.length > 0) {
          /* Choose a creature from near the top of the list. */
          const location = Math.floor(
            tmpFineTunePopulation.length * Math.random() * Math.random(),
          );

          const extendedPreviousFittest = tmpFineTunePopulation[location];
          if (!extendedPreviousFittest) {
            throw new Error(
              `No creature found at location ${location} in tmpFineTunePopulation.`,
            );
          }
          assert(extendedPreviousFittest.uuid, "Creature UUID is undefined");
          tunedUUID.add(extendedPreviousFittest.uuid);
          const extendedTunedPopulation = fineTuneImprovement(
            fittest,
            extendedPreviousFittest,
            extendedFineTunePopSize,
          );

          fineTunedPopulation.push(...extendedTunedPopulation);

          /* Remove the chosen creature from the array */
          tmpFineTunePopulation.splice(location, 1);
        } else {
          break;
        }
      }
    }

    for (const creature of fineTunedPopulation) {
      genus.addCreature(creature);
    }

    return fineTunedPopulation;
  }

  /* Assuming weightedRandomSelect selects based on score, weighting higher scores more heavily.*/

  weightedRandomSelect(creatures: Creature[]) {
    const totalWeight = creatures.reduce(
      (sum, creature) => sum + 1 / (creatures.indexOf(creature) + 1),
      0,
    );
    let random = Math.random() * totalWeight;

    for (const creature of creatures) {
      random -= 1 / (creatures.indexOf(creature) + 1);
      if (random <= 0) {
        return creature;
      }
    }
    return creatures[0]; // Fallback to the first creature if no selection occurs
  }
}
