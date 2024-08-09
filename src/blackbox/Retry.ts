import { assert } from "@std/assert";
import type { Creature } from "../../mod.ts";
import { fineTuneImprovement } from "./FineTune.ts";
import { restoreSource } from "./RestoreSource.ts";
import { addTag } from "@stsoftware/tags";
import type { Approach } from "../NEAT/LogApproach.ts";

export function retry(population: Creature[]): Creature[] {
  const possibleRetryPopulation = population.filter((creature) => {
    if (creature.memetic) {
      assert(creature.score);
      if (creature.score > creature.memetic.score) {
        return true;
      }
    } else {
      return false;
    }
  });

  if (possibleRetryPopulation.length) {
    const randomIndx = Math.floor(
      possibleRetryPopulation.length * Math.random(),
    );

    const fittest = possibleRetryPopulation[randomIndx];

    const previous = restoreSource(fittest);
    assert(previous);
    const retryPopulation = fineTuneImprovement(
      fittest,
      previous,
      2,
    );

    retryPopulation.forEach((creature) => {
      addTag(creature, "approach", "retry" as Approach);
    });
    return retryPopulation;
  } else {
    return [];
  }
}
