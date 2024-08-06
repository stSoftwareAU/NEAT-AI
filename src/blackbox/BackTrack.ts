import { assert } from "@std/assert";
import type { Creature } from "../../mod.ts";
import { fineTuneImprovement } from "./FineTune.ts";
import { restoreSource } from "./RestoreSource.ts";
import { addTag } from "@stsoftware/tags";
import type { Approach } from "../NEAT/LogApproach.ts";

export function backtrack(population: Creature[]): Creature[] {
  const possibleBacktrackPopulation = population.filter((creature) => {
    if (creature.memetic) {
      assert(creature.score);
      if (creature.score < creature.memetic.score) {
        return true;
      }
    } else {
      return false;
    }
  });

  if (possibleBacktrackPopulation.length) {
    const randomIndx = Math.floor(
      possibleBacktrackPopulation.length * Math.random(),
    );

    const previous = possibleBacktrackPopulation[randomIndx];

    const fittest = restoreSource(previous);
    assert(fittest);
    const backtrackPopulation = fineTuneImprovement(
      fittest,
      previous,
      2,
    );

    backtrackPopulation.forEach((creature) => {
      addTag(creature, "approach", "backtracked" as Approach);
    });
    return backtrackPopulation;
  } else {
    return [];
  }
}
