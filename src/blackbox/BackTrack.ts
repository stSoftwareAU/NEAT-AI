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
      return creature.score < creature.memetic.score;
    }
    return false;
  });

  if (possibleBacktrackPopulation.length > 0) {
    const randomIndx = Math.floor(
      possibleBacktrackPopulation.length * Math.random(),
    );

    const selectedCreature = possibleBacktrackPopulation[randomIndx];

    const fittest = restoreSource(selectedCreature);
    assert(fittest);

    const backtrackPopulation = fineTuneImprovement(
      fittest,
      selectedCreature,
      2,
      true, // Indicating that this is a backtrack operation
    );

    backtrackPopulation.forEach((creature) => {
      addTag(creature, "approach", "backtrack" as Approach);
    });

    return backtrackPopulation;
  } else {
    return [];
  }
}
