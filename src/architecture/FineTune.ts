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
  console.info( "Fine tune scores" , pScore, "->", fScore);
  if (getTag(fittest, "tuned") == "fine") {
    console.info(
      "Fine tuning increased fitness by",
      fScore - pScore,
    );
  }
  const fineTuned: Network[] = [];

  for (let i = fittest.nodes.length; i--;) {
    const fn = fittest.nodes[i];
    for (let j = previousFittest.nodes.length; j--;) {
      const pn = previousFittest.nodes[j];

      if (fn.index == pn.index) {
        if (fn.bias != pn.bias) {
          const c = cloneIt(fittest);

          const adjust = (fn.bias - pn.bias) * 2 * Math.random();
          const bias = fn.bias + adjust;
          console.debug(
            "pos: ("+i+":"+j+"), index: (" + fn.index +":" +pn.index +")",
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
          Deno.writeTextFileSync( ".fittest.json", JSON.stringify( fittest));
          Deno.writeTextFileSync( ".variant.json", JSON.stringify( c));
          Deno.writeTextFileSync( ".previous.json", JSON.stringify( previousFittest));
        }
        break;
      }
    }
    if (fineTuned.length >= popsize) break;
  }

  for (let i = fittest.connections.length; i--;) {
    const fc = fittest.connections[i];
    for (let j = previousFittest.connections.length; j--;) {
      const pc = previousFittest.connections[j];

      if (fc.from == pc.from && fc.to == pc.to) {
        if (fc.weight != pc.weight) {
          const c = cloneIt(fittest);

          const adjust = (fc.weight - pc.weight) * 2 * Math.random();
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

  if (fineTuned.length > 0) {
    console.info("fine tuned", fineTuned.length, "variants");
  }
  return fineTuned;
}

function cloneIt(fittest: { toJSON: Function }) {
  const json = fittest.toJSON();

  const n = Network.fromJSON(json);

  addTag(n, "tuned", "fine");
  return n;
}
