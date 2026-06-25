/**
 * @module
 *
 * Elitism helpers for the evolutionary loop. {@link makeElitists} selects the
 * fittest creatures of a population to carry forward unchanged into the next
 * generation, guarding the best-known solutions from being lost to mutation or
 * breeding, and reports the population's average score alongside the elites.
 */
import { assert } from "@std/assert";
import { blue, bold, green, red, white, yellow } from "@std/fmt/colors";
import { addTag, getTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import type { Approach } from "@neat/LogApproach.ts";
import { getLogger } from "@utils/Logger.ts";

interface ElitistsResults {
  elitists: Creature[];
  averageScore: number;
}
export function makeElitists(
  creatures: Creature[],
  size = 1,
  verbose = false,
): ElitistsResults {
  assert(creatures.length > 0, "Population must have creatures");

  assert(size > 0);
  assert(Number.isInteger(size));

  const result: ElitistsResults = {
    elitists: [],
    averageScore: computeAverageScore(creatures),
  };
  if (verbose) {
    logVerbose(creatures);
  }

  const elitism = Math.min(size, creatures.length);

  const elitists = creatures.slice(0, elitism);
  result.elitists = elitists;
  return result;
}

export function sortCreaturesByScore(creatures: Creature[]): Creature[] {
  creatures.sort((a, b) => {
    return b.score! - a.score!;
  });

  return creatures;
}

/**
 * Computes the mean of `creature.score` across the population. This is always
 * available to telemetry (e.g. the `generation_complete` event's
 * `averageFitness`) regardless of the `verbose` flag, which now only controls
 * the per-creature training log emitted by {@link logVerbose}.
 */
export function computeAverageScore(creatures: Creature[]): number {
  assert(creatures.length > 0, "Population must have creatures");

  let totalScore = 0;
  for (const creature of creatures) {
    const score = creature.score;
    assert(score !== undefined, "Creature must have a score");
    totalScore += score;
  }

  return totalScore / creatures.length;
}

export function logVerbose(creatures: Creature[]): number {
  let totalScore = 0;

  for (const creature of creatures) {
    const score = creature.score;
    assert(score !== undefined, "Creature must have a score");
    totalScore += score;

    const error = getTag(creature, "error");
    assert(error, "Creature must have an error");
    const notified = getTag(creature, "notified");
    if (notified === "Yes") {
      continue;
    }
    const trainID = getTag(creature, "trainID");
    if (trainID) {
      addTag(creature, "notified", "Yes");

      const approach = getTag(creature, "approach") as Approach;
      const trainVariant = getTag(creature, "trainVariant");
      const untrainedError = getTag(creature, "untrained-error") ?? "99999";

      const diff = Number.parseFloat(untrainedError) -
        Number.parseFloat(error);
      const tmpApproach = approach ?? "unknown";
      const approachName = `${
        tmpApproach.substring(0, 1).toUpperCase() + tmpApproach.substring(1)
      }`;

      let trainMsg = `${approachName} ${blue(trainID)} Score: ${
        yellow(score.toString())
      }, Error: ${yellow(untrainedError)} -> ${yellow(error)}, `;

      const diffAmount = diff.toPrecision(3);
      if (diff > 0) {
        trainMsg += "👌 " + bold(green(diffAmount));
      } else if (diff < 0) {
        trainMsg += "👿 " + red(diffAmount);
      } else {
        trainMsg += white(" 🫥");
      }
      if (trainVariant) {
        trainMsg += `, Variant: ${trainVariant}`;
      }
      getLogger().info(trainMsg);
      addTag(creature, "trainMsg", trainMsg);
    }
    const sourceUUID = getTag(creature, "CRISPR-SOURCE");
    if (sourceUUID) {
      addTag(creature, "notified", "Yes");
      const sourceCreature = creatures.find((c) => c.uuid === sourceUUID);

      if (sourceCreature) {
        const sourceError = getTag(sourceCreature, "error");
        assert(sourceError, "Creature must have an error");
        const diff = Number.parseFloat(sourceError) -
          Number.parseFloat(error);
        const dnaID = getTag(creature, "CRISPR-DNA");

        getLogger().info(
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
