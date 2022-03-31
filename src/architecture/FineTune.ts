import { addTag, getTag } from "../tags/TagsInterface.ts";
import { Network } from "./network.js";
import { NetworkInterface } from "./NetworkInterface.ts";

export function fineTuneImprovement(
  fittest: NetworkInterface,
  previousFittest: (NetworkInterface | null),
  popsize = 10,
) {
  if (previousFittest == null) {
    return [];
  }

  const fScoreTxt = getTag(fittest, "score");
  if (!fScoreTxt) {
    return [];
  }
  const fScore = Number.parseFloat(fScoreTxt);

  const pScoreTxt = getTag(previousFittest, "score");
  if (!pScoreTxt) {
    return [];
  }
  const pScore = Number.parseFloat(pScoreTxt);

  if (fScore <= pScore) {
    return [];
  }

  if (getTag(fittest, "tuned") == "fine") {
    console.info(
      "Fine tuning increased fitness by",
      fScore - pScore,
    );
  }
  const fineTuned: Network[] = [];

  for (let k = 0; true; k++) {
    for (let i = fittest.nodes.length; i--;) {
      const fn = fittest.nodes[i];
      for (let j = previousFittest.nodes.length; j--;) {
        const pn = previousFittest.nodes[j];

        if (isFinite(fn.index) && isFinite(pn.index)) {
          if (fn.index == pn.index) {
            if (fn.bias != pn.bias) {
              const c = cloneIt(fittest);

              const adjust = adjustment(k, fn.bias - pn.bias);
              const bias = fn.bias + adjust;
              console.debug(
                "pos: (" + i + ":" + j + "), index: (" + fn.index + ":" +
                  pn.index + ")",
                "fine tune bias",
                fn.bias,
                "(",
                pn.bias,
                ") by",
                adjust,
                "to",
                bias,
              );
              c.nodes[i].bias = bias;
              fineTuned.push(c);
            }
            break;
          }
        }
      }
      if (fineTuned.length >= popsize) break;
    }
    if (fineTuned.length >= popsize) break;

    for (let i = fittest.connections.length; i--;) {
      const fc = fittest.connections[i];
      for (let j = previousFittest.connections.length; j--;) {
        const pc = previousFittest.connections[j];

        if (fc.from == pc.from && fc.to == pc.to) {
          if (fc.weight != pc.weight) {
            const c = cloneIt(fittest);

            const adjust = adjustment(k, fc.weight - pc.weight);
            const weight = fc.weight + adjust;
            console.debug(
              i,
              "fine tune weight",
              fc.weight,
              "(",
              pc.weight,
              ") by",
              adjust,
              "to",
              weight,
            );
            c.connections[i].weight = weight;

            fineTuned.push(c);
          }
          break;
        }
      }
      if (fineTuned.length >= popsize) break;
    }
    if (fineTuned.length == 0) break; // No viable genes to modify.
    if (fineTuned.length >= popsize) break;
  }

  return fineTuned;
}

function adjustment(loop: number, difference: number) {
  switch (loop % 3) {
    /* Big step forward. */
    case 0: {
      const r = 1 + Math.random();
      const v = difference * r; // Big step forward.
      // console.debug("big step forward", difference, r, v);
      return v;
    }
    /* Little step forward. */
    case 1: {
      const r = Math.random();
      const v = difference * r;
      // console.debug("Little step forward", difference, r, v);
      return v; // Little step forward.
    }
    /* Little step backwards */
    default: {
      const r = Math.random() * -1;
      const v = difference * r;
      // console.debug("Little step backwards", difference, r, v);
      return v;
    }
  }
}

// deno-lint-ignore ban-types
function cloneIt(fittest: { toJSON: Function }) {
  const json = fittest.toJSON();

  const n = Network.fromJSON(json);

  addTag(n, "tuned", "fine");
  return n;
}
