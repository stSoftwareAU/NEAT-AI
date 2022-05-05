import { addTag, getTag } from "../tags/TagsInterface.ts";
import { Network } from "./network.js";
import { NetworkInterface } from "./NetworkInterface.ts";
const MIN_STEP = 0.000_000_1;

function tuneWeights(
  fittest: NetworkInterface,
  previousFittest: NetworkInterface,
  oldScore: string,
) {
  const previousJSON = previousFittest.toJSON();
  const allJSON = fittest.toJSON();
  let changeWeightCount = 0;

  for (let i = allJSON.connections.length; i--;) {
    const tc = allJSON.connections[i];
    for (let j = previousJSON.connections.length; j--;) {
      const pc = previousJSON.connections[j];

      if (tc.from == pc.from && tc.to == pc.to) {
        if (tc.gater == pc.gater) {
          if (Math.abs(tc.weight - pc.weight) > MIN_STEP) {
            const adjust = tc.weight - pc.weight;
            const weight = tc.weight + adjust;

            tc.weight = weight;
            changeWeightCount++;
          }
        }
        break;
      }
    }
  }

  if (changeWeightCount < 2) return null;

  const all = Network.fromJSON(allJSON);
  addTag(all, "approach", "fine");
  addTag(
    all,
    "adjusted",
    changeWeightCount + " weights",
  );

  addTag(
    all,
    "step",
    "ALL-weigths",
  );
  addTag(all, "old-score", oldScore);

  return all;
}

function tuneBias(
  fittest: NetworkInterface,
  previousFittest: NetworkInterface,
  oldScore: string,
) {
  const previousJSON = previousFittest.toJSON();
  const allJSON = fittest.toJSON();

  let changeBiasCount = 0;
  for (let i = allJSON.nodes.length; i--;) {
    const tn = allJSON.nodes[i];

    if (i < previousJSON.nodes.length) {
      const pn = previousJSON.nodes[i];

      if (tn.squash == pn.squash) {
        if (Math.abs(tn.bias - pn.bias) > MIN_STEP) {
          const adjust = tn.bias - pn.bias;
          const bias = tn.bias + adjust;

          tn.bias = bias;
          changeBiasCount++;
        }
      }
    }
  }

  if (changeBiasCount < 2) return null;

  const all = Network.fromJSON(allJSON);
  addTag(all, "approach", "fine");
  addTag(
    all,
    "adjusted",
    changeBiasCount + " biases",
  );

  addTag(
    all,
    "step",
    "ALL-biases",
  );
  addTag(all, "old-score", oldScore);

  return all;
}

function tuneAll(
  fittest: NetworkInterface,
  previousFittest: NetworkInterface,
  oldScore: string,
) {
  const previousJSON = previousFittest.toJSON();
  const allJSON = fittest.toJSON();

  let changeBiasCount = 0;
  let changeWeightCount = 0;
  for (let i = allJSON.nodes.length; i--;) {
    const tn = allJSON.nodes[i];

    if (i < previousJSON.nodes.length) {
      const pn = previousJSON.nodes[i];

      if (tn.squash == pn.squash) {
        if (Math.abs(tn.bias - pn.bias) > MIN_STEP) {
          const adjust = tn.bias - pn.bias;
          const bias = tn.bias + adjust;

          tn.bias = bias;
          changeBiasCount++;
        }
      }
    }
  }

  for (let i = allJSON.connections.length; i--;) {
    const tc = allJSON.connections[i];
    for (let j = previousJSON.connections.length; j--;) {
      const pc = previousJSON.connections[j];

      if (tc.from == pc.from && tc.to == pc.to) {
        if (tc.gater == pc.gater) {
          if (Math.abs(tc.weight - pc.weight) > MIN_STEP) {
            const adjust = tc.weight - pc.weight;
            const weight = tc.weight + adjust;

            tc.weight = weight;
            changeWeightCount++;
          }
        }
        break;
      }
    }
  }

  if (changeBiasCount == 0 || changeWeightCount == 0) return null;

  const all = Network.fromJSON(allJSON);
  addTag(all, "approach", "fine");
  addTag(
    all,
    "adjusted",
    changeWeightCount + " weight" + (changeWeightCount > 1 ? "s" : "") +
      ", " + changeBiasCount + " bias" + (changeBiasCount > 1 ? "es" : ""),
  );

  addTag(
    all,
    "step",
    "ALL",
  );
  addTag(all, "old-score", oldScore);

  return all;
}

export function fineTuneImprovement(
  fittest: NetworkInterface,
  previousFittest: (NetworkInterface | null),
  popsize = 10,
  showMessage = true,
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

  const approach = getTag(fittest, "approach");
  if (showMessage && approach == "fine") {
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
  } else if (approach == "trained") {
    console.info(
      "Training increased fitness by",
      fScore - pScore,
      "to",
      fScore,
    );
  }
  const fineTuned: Network[] = [];
  const previousJSON = previousFittest.toJSON();

  const all = tuneAll(fittest, previousFittest, fScoreTxt);
  if (all) fineTuned.push(all);

  const weightsOnly = tuneWeights(fittest, previousFittest, fScoreTxt);
  if (weightsOnly) fineTuned.push(weightsOnly);

  const biasOnly = tuneBias(fittest, previousFittest, fScoreTxt);
  if (biasOnly) fineTuned.push(biasOnly);

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
            addTag(n, "approach", "fine");
            addTag(n, "adjusted", "bias");
            addTag(
              n,
              "step",
              k % 3 == 0 ? "large" : k % 3 == 1 ? "small" : "back",
            );
            addTag(n, "old-score", fScoreTxt);
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
              addTag(n, "approach", "fine");
              addTag(n, "adjusted", "weight");
              addTag(
                n,
                "step",
                k % 3 == 0 ? "large" : k % 3 == 1 ? "small" : "back",
              );
              addTag(n, "old-score", fScoreTxt);
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

function minStep(v: number) {
  if (v > 0) {
    return v < MIN_STEP ? MIN_STEP : v;
  } else {
    return v > MIN_STEP * -1 ? MIN_STEP * -1 : v;
  }
}

function adjustment(loop: number, difference: number) {
  switch (loop % 3) {
    /* Big step forward. */
    case 0: {
      const r = 1 + Math.random();
      const v = difference * r; // Big step forward.
      // console.debug("big step forward", difference, r, v);
      return minStep(v);
    }
    /* Little step forward. */
    case 1: {
      const r = Math.random();
      const v = difference * r;

      // console.debug("Little step forward", difference, r, v);
      return minStep(v); // Little step forward.
    }
    /* Little step backwards */
    default: {
      const r = Math.random() * -1;
      const v = difference * r;
      // console.debug("Little step backwards", difference, r, v);
      return minStep(v);
    }
  }
}
