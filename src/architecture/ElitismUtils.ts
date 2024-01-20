import { getTag } from "https://deno.land/x/tags@v1.0.2/src/TagsInterface.ts";
import { Creature } from "../Creature.ts";
import { blue, yellow } from "https://deno.land/std@0.212.0/fmt/colors.ts";

export function makeElitists(
  creatures: Creature[],
  size = 1,
) {
  const elitism = Math.min(Math.max(1, size), creatures.length);

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

  for (let indx = 0; indx < creatures.length; indx++) {
    const trainID = getTag(creatures[indx], "trainID");
    if (trainID) {
      const score = creatures[indx].score;

      const approach = getTag(creatures[indx], "approach");
      const untrainedError = getTag(creatures[indx], "untrained-error");
      const error = getTag(creatures[indx], "error");

      console.info(
        `${approach} ${blue(trainID)} Score: ${
          yellow(score ? score.toString() : "undefined")
        }, Error: ${yellow(untrainedError ? untrainedError : "unknown")} -> ${
          yellow(error ? error : "unknown")
        }`,
      );
    }
  }

  const elitists = creatures.slice(0, elitism);

  return elitists;
}
