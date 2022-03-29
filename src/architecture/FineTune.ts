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
  if (!fScoreTxt) return [];

  const fScore = Number.parseFloat(fScoreTxt);

  const pScoreTxt = getTag(previousFittest, "score");
  if (!pScoreTxt) return [];

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

  if (fittest.nodes.length == previousFittest.nodes.length) {
    const nodeLen = Math.min(
      fittest.nodes.length,
      previousFittest.nodes.length,
    );

    for (let i = nodeLen; i--;) {
      const fn = fittest.nodes[i];
      const pn = previousFittest.nodes[i];

      if (fn.index == pn.index) {
        if (fn.bias != pn.bias) {
          const c = cloneIt(fittest);

          const adjust = (fn.bias - pn.bias) * 2 * Math.random();
          const bias = c.nodes[i].bias + adjust;
          console.debug(
            i,
            "fine tune bias",
            c.nodes[i].bias,
            "by",
            adjust,
            "to",
            bias,
          );
          c.nodes[i].bias = bias;
          fineTuned.push(c);
          if (fineTuned.length >= popsize) break;
        }
      }
    }
  }

  if (
    fittest.connections.length ==
      previousFittest.connections.length
  ) {
    const connectionsLen = Math.min(
      fittest.connections.length,
      previousFittest.connections.length,
    );

    for (let i = connectionsLen; i--;) {
      const fc = fittest.connections[i];
      const pc = previousFittest.connections[i];

      if (fc.from == pc.from && fc.to == pc.to) {
        if (fc.weight != pc.weight) {
          const c = cloneIt(fittest);

          const adjust = (fc.weight - pc.weight) * 2 * Math.random();
          const weight = c.connections[i].weight + adjust;
          console.debug(
            i,
            "fine tune weight(A)",
            c.connections[i].weight,
            "by",
            adjust,
            "to",
            weight,
          );
          c.connections[i].weight = weight;

          fineTuned.push(c);
          if (fineTuned.length >= popsize) break;
        }
      }
    }
  }
  if (fineTuned.length > 0) {
    console.info("fine tuned ", fineTuned.length, "variants");
  }
  return fineTuned;
}

function cloneIt(fittest: { toJSON: Function }) {
  const json = fittest.toJSON();

  const n = Network.fromJSON(json);

  addTag(n, "tuned", "fine");
  return n;
}
