import { assert } from "@std/assert";
import { type Creature, CreatureUtil } from "../../mod.ts";
import type { Genus } from "./Genus.ts";
import { fineTuneImprovement } from "../architecture/FineTune.ts";
import { Species } from "./Species.ts";
import type { Neat } from "./Neat.ts";

export class FindTunePopulation {
  private neat: Neat;
  constructor(neat: Neat) {
    this.neat = neat;
  }

  async make(
    fittest: Creature,
    previousFittest: Creature | undefined,
    genus: Genus,
  ) {
    assert(fittest, "Fittest creature mandatory");
    const fittestUUID = await CreatureUtil.makeUUID(fittest);

    const uniqueUUID = new Set<string>([fittestUUID]);

    const tmpFineTunePopulation = [];

    // Add previousFittest first if it's different from fittest and not null
    if (
      previousFittest
    ) {
      const previousUUID = await CreatureUtil.makeUUID(previousFittest);
      if (!uniqueUUID.has(previousUUID)) {
        tmpFineTunePopulation.push(previousFittest);
        uniqueUUID.add(previousUUID);
      }
    }

    // Add remaining creatures from the population excluding fittest and previousFittest
    for (const creature of this.neat.population) {
      const creatureUUID = await CreatureUtil.makeUUID(creature);
      if (!uniqueUUID.has(creatureUUID)) {
        tmpFineTunePopulation.push(creature);
        uniqueUUID.add(creatureUUID);
      }
    }

    const tmpPreviousFittest = tmpFineTunePopulation.shift();

    let fineTunedPopulation: Creature[] = [];
    if (!tmpPreviousFittest) {
      console.warn("Failed to find previous fittest creature");
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

      tunedUUID.add(tmpPreviousFittest.uuid ?? "UNKNOWN");
      fineTunedPopulation = await fineTuneImprovement(
        fittest,
        tmpPreviousFittest,
        fineTunePopSize - 1,
        this.neat.config.verbose,
      );

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

        const speciesKey = await Species.calculateKey(fittest);
        const species = genus.speciesMap.get(speciesKey);

        if (species) {
          if (species.creatures.length > 0) { // Ensure there's more than one to choose from
            let eligibleCreatures = species.creatures.filter((creature) =>
              !tunedUUID.has(creature.uuid ?? "UNKNOWN")
            );

            /** If there is no eligible creatures try find the closest species. */
            if (eligibleCreatures.length == 0) {
              const closestSpecies = genus.findClosestMatchingSpecies(fittest);
              if (closestSpecies) {
                if (closestSpecies && closestSpecies.creatures.length > 0) {
                  eligibleCreatures = closestSpecies.creatures.filter(
                    (creature) => !tunedUUID.has(creature.uuid ?? "UNKNOWN"),
                  );
                }
              }
            }

            if (eligibleCreatures.length > 0) {
              // Introduce random selection, weighted towards higher score creatures
              const nextBestCreature = this.weightedRandomSelect(
                eligibleCreatures,
              );

              tunedUUID.add(nextBestCreature.uuid ?? "UNKNOWN");
              const extendedTunedPopulation = await fineTuneImprovement(
                fittest,
                nextBestCreature,
                speciesFineTunePopSize,
                false,
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
          tunedUUID.add(extendedPreviousFittest.uuid ?? "UNKNOWN");
          const extendedTunedPopulation = await fineTuneImprovement(
            fittest,
            extendedPreviousFittest,
            extendedFineTunePopSize,
            false,
          );

          fineTunedPopulation.push(...extendedTunedPopulation);

          /* Remove the chosen creature from the array */
          tmpFineTunePopulation.splice(location, 1);
        } else {
          break;
        }
      }
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
