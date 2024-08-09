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
      return creature.score > creature.memetic.score;
    }
    return false;
  });

  if (possibleRetryPopulation.length > 0) {
    possibleRetryPopulation.sort((a, b) => b.score! - a.score!);

    // Get the index by multiplying two random numbers (favoring the top, but can be anywhere)
    const randomIndx = Math.floor(
      possibleRetryPopulation.length * Math.random() * Math.random(),
    );
    const fittest = possibleRetryPopulation[randomIndx];

    const previous = restoreSource(fittest);
    assert(previous);

    const retryPopulation = fineTuneImprovement(fittest, previous, 2);

    retryPopulation.forEach((creature) => {
      addTag(creature, "approach", "retry" as Approach);
    });

    return retryPopulation;
  } else {
    return [];
  }
}
