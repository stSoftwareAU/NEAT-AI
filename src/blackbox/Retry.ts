import { assert } from "@std/assert";
import type { Creature } from "../../mod.ts";
import { fineTuneImprovement } from "./FineTune.ts";
import { restoreSource } from "./RestoreSource.ts";
import { addTag } from "@stsoftware/tags";
import type { Approach } from "../NEAT/LogApproach.ts";

export type Filter = "NONE" | "FORWARD" | "BACKWARDS";

const PLANK_CONSTANT = 0.000_000_000_001;
export function retry(
  population: Creature[],
  filter: Filter = "NONE",
): Creature[] {
  const possibleRetryPopulation = population.filter((creature) => {
    if (creature.memetic) {
      assert(creature.score);
      const difference = creature.score - creature.memetic.score;
      const absDifference = Math.abs(difference);

      // Check if the absolute difference exceeds the plank constant
      if (absDifference <= PLANK_CONSTANT) {
        return false;
      }

      // Apply the filter logic
      if (filter === "FORWARD" && difference <= 0) {
        return false;
      }
      if (filter === "BACKWARDS" && difference >= 0) {
        return false;
      }

      return true;
    }
    return false;
  });

  if (possibleRetryPopulation.length > 0) {
    // Sort by adjusted score
    possibleRetryPopulation.sort((a, b) => {
      const diffA = a.score! - a.memetic!.score;
      const diffB = b.score! - b.memetic!.score;

      const adjustedScoreA = diffA > 0
        ? a.score! + diffA
        : a.score! + 0.5 * Math.abs(diffA);
      const adjustedScoreB = diffB > 0
        ? b.score! + diffB
        : b.score! + 0.5 * Math.abs(diffB);

      return adjustedScoreB - adjustedScoreA;
    });

    // Get the index by multiplying two random numbers (favoring the top, but can be anywhere)
    const randomIndx = Math.floor(
      possibleRetryPopulation.length * Math.random() * Math.random(),
    );
    const tmpCreature = possibleRetryPopulation[randomIndx];

    const restoredCreature = restoreSource(tmpCreature);
    assert(restoredCreature);

    let fittest: Creature;
    let previous: Creature;
    let approach: Approach;
    if (tmpCreature.score! > restoredCreature.score!) {
      fittest = tmpCreature;
      previous = restoredCreature;
      approach = "retry";
    } else {
      fittest = restoredCreature;
      previous = tmpCreature;
      approach = "backtrack";
    }
    const retryPopulation = fineTuneImprovement(
      fittest,
      previous,
      2,
      approach == "backtrack",
    );

    retryPopulation.forEach((creature) => {
      addTag(creature, "approach", approach);
    });

    return retryPopulation;
  } else {
    return [];
  }
}
