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
      "to",
      fScore,
      "adjusted", 
      getTag(fittest, "adjusted"),
      "step",
      getTag(fittest, "step"),
    );
  }
  const fineTuned: Network[] = [];
  const previousJSON = previousFittest.toJSON();
  let targetJSON = fittest.toJSON();
  for (let k = 0; true; k++) {

    for (let i = targetJSON.nodes.length; i--;) {
      const fn = targetJSON.nodes[i];

      if (i < previousJSON.nodes.length) {
        const pn = previousJSON.nodes[i];

        if (fn.squash == pn.squash) {
          if (fn.bias != pn.bias) {
            const adjust = adjustment(k, fn.bias - pn.bias);
            const bias = fn.bias + adjust;
            // console.debug(
            //   "Index: " + i,
            //   "bias",
            //   fn.bias,
            //   "(",
            //   pn.bias,
            //   ") by",
            //   adjust,
            //   "to",
            //   bias,
            // );
            fn.bias = bias;
            const n = Network.fromJSON(targetJSON);
            addTag(n, "tuned", "fine");
            addTag(n, "adjusted", "bias");
            addTag(n, "step", k % 3==0?"large":k%3==1?"small":"back");
            fineTuned.push(n);
            if (fineTuned.length >= popsize) break;
            targetJSON = fittest.toJSON();            
          }
        }
      }
      if (fineTuned.length >= popsize) break;
    }
    if (fineTuned.length >= popsize) break;

    for (let i = targetJSON.connections.length; i--;) {
      const fc = targetJSON.connections[i];
      for (let j = previousJSON.connections.length; j--;) {
        const pc = previousJSON.connections[j];

        if (fc.from == pc.from && fc.to == pc.to) {
          if (fc.gater == pc.gater) {
            if (fc.weight != pc.weight) {
              const adjust = adjustment(k, fc.weight - pc.weight);
              const weight = fc.weight + adjust;
              // console.debug(
              //   "from",
              //   fc.from,
              //   "to",
              //   pc.to,
              //   "weight",
              //   fc.weight,
              //   "(",
              //   pc.weight,
              //   ") by",
              //   adjust,
              //   "to",
              //   weight,
              // );
              fc.weight = weight;
              const n = Network.fromJSON(targetJSON);
              addTag(n, "tuned", "fine");
              addTag(n, "adjusted", "weight");
              addTag(n, "step", k % 3==0?"large":k%3==1?"small":"back");
              fineTuned.push(n);
              if (fineTuned.length >= popsize) break;
              targetJSON = fittest.toJSON();
            }
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
