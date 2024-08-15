import { blue, bold, green, red, white, yellow } from "@std/fmt/colors";
import { addTag, getTag } from "@stsoftware/tags";
import type { Creature } from "../Creature.ts";
import type { Approach } from "../NEAT/LogApproach.ts";
import { assert } from "@std/assert";

interface ElitistsResults {
  elitists: Creature[];
  averageScore: number;
}
export function makeElitists(
  creatures: Creature[],
  size = 1,
  verbose = false,
): ElitistsResults {
  if (creatures.length == 0) throw new Error(`Whole population is extinct`);
  assert(size > 0);
  assert(Number.isInteger(size));

  const result: ElitistsResults = {
    elitists: [],
    averageScore: NaN,
  };
  if (verbose) {
    result.averageScore = logVerbose(creatures);
  }

  const elitism = Math.min(size, creatures.length);

  const elitists = creatures.slice(0, elitism);
  result.elitists = elitists;
  return result;
}

export function sortCreaturesByScore(creatures: Creature[]): Creature[] {
  creatures.sort((a, b) => {
    if (Number.isFinite(a.score)) {
      if (Number.isFinite(b.score)) {
        return (b.score as number) - (a.score as number);
      } else {
        return -1;
      }
    } else if (Number.isFinite(b.score)) {
      return 1;
    } else {
      return 0;
    }
  });

  return creatures;
}

export function logVerbose(creatures: Creature[]): number {
  let totalScore = 0;

  for (let indx = 0; indx < creatures.length; indx++) {
    const creature = creatures[indx];
    const score = creature.score;
    assert(score !== undefined, "Creature must have a score");
    totalScore += score;

    const error = getTag(creature, "error") ?? "99999";
    const notified = getTag(creature, "notified");
    if (notified === "Yes") {
      continue;
    }
    const trainID = getTag(creature, "trainID");
    if (trainID) {
      addTag(creature, "notified", "Yes");

      const approach = getTag(creature, "approach") as Approach;
      const untrainedError = getTag(creature, "untrained-error") ?? "99999";

      const diff = Number.parseFloat(untrainedError) -
        Number.parseFloat(error);
      console.info(
        `${approach} ${blue(trainID)} Score: ${
          yellow(score.toString())
        }, Error: ${yellow(untrainedError)} -> ${yellow(error)}` + (diff > 0
          ? ` ${"improved " + bold(green(diff.toString()))}`
          : diff < 0
          ? ` ${"regression " + red(diff.toString())}`
          : white(" neutral")),
      );
    }
    const sourceUUID = getTag(creature, "CRISPR-SOURCE");
    if (sourceUUID) {
      addTag(creature, "notified", "Yes");
      const sourceCreature = creatures.find((c) => c.uuid === sourceUUID);

      if (sourceCreature) {
        const sourceError = getTag(sourceCreature, "error") ?? "99999";
        const diff = Number.parseFloat(sourceError) -
          Number.parseFloat(error);
        const dnaID = getTag(creature, "CRISPR-DNA");

        console.info(
          `CRISPR ${blue(dnaID ?? "unknown")} Score: ${
            yellow(score.toString())
          }, Error: ${yellow(sourceError)} -> ${yellow(error)}` + (diff > 0
            ? ` ${"improved " + bold(green(diff.toString()))}`
            : diff < 0
            ? ` ${"regression " + red(diff.toString())}`
            : white(" neutral")),
        );
      }
    }
  }

  return totalScore / creatures.length;
}
