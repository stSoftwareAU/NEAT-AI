import {
  blue,
  bold,
  green,
  red,
  white,
  yellow,
} from "https://deno.land/std@0.222.1/fmt/colors.ts";
import { getTag } from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Creature } from "../Creature.ts";

export function makeElitists(
  creatures: Creature[],
  size = 1,
  verbose = false,
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

  if (verbose) {
    for (let indx = 0; indx < creatures.length; indx++) {
      const trainID = getTag(creatures[indx], "trainID");
      if (trainID) {
        const score = creatures[indx].score;

        const approach = getTag(creatures[indx], "approach");
        const untrainedError = getTag(creatures[indx], "untrained-error");
        const error = getTag(creatures[indx], "error");
        const diff = Number.parseFloat(untrainedError ?? "99999") -
          Number.parseFloat(error ?? "99999");
        console.info(
          `${approach} ${blue(trainID)} Score: ${
            yellow(score ? score.toString() : "undefined")
          }, Error: ${yellow(untrainedError ?? "unknown")} -> ${
            yellow(error ?? "unknown")
          }` + (diff > 0
            ? ` ${"improved " + bold(green(diff.toString()))}`
            : diff < 0
            ? ` ${"regression " + red(diff.toString())}`
            : white(" neutral")),
        );
      }
    }
  }

  const elitists = creatures.slice(0, elitism);

  return elitists;
}
