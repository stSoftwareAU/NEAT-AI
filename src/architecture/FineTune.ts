import { FitnessInterface } from "./FitnessInterface.ts";
import { NetworkInterface } from "./NetworkInterface.ts";
import { Network } from "./network.js";

export function fineTuneImprovement(
  fittest: FitnessInterface,
  previousFittest: (FitnessInterface | null),
  popsize = 10,
) {
  if (previousFittest == null) {
    return [];
  }
  if (fittest.calculatedScore == previousFittest.calculatedScore) {
    return [];
  }
  const fineTuned: Network[] = [];

  const nodeLen = Math.min(fittest.nodes.length, previousFittest.nodes.length);

  for (let i = nodeLen; i--;) {
    const fn = fittest.nodes[i];
    const pn = previousFittest.nodes[i];

    if (fn.index == pn.index) {
      if (fn.bias != pn.bias) {
        const c = cloneIt(fittest);

        c.nodes[i].bias += fn.bias - pn.bias;
        fineTuned.push(c);
        if (fineTuned.length >= popsize) break;
        const c2 = cloneIt(fittest);

        c2.nodes[i].bias += (fn.bias - pn.bias) / 2;
        fineTuned.push(c2);
        if (fineTuned.length >= popsize) break;
      }
    }
  }

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

        c.connections[i].weight += fc.weight - pc.weight;
        fineTuned.push(c);
        if (fineTuned.length >= popsize) break;
        const c2 = cloneIt(fittest);

        c2.connections[i].weight += (fc.weight - pc.weight) / 2;
        fineTuned.push(c2);
        if (fineTuned.length >= popsize) break;
      }
    }
  }

  return fineTuned;
}

function cloneIt(fittest: { toJSON: Function }) {
  const json = fittest.toJSON();
  //   const aClone: NetworkInterface = {
  //     dropout: fittest.dropout,
  //     input: fittest.input,
  //     output: fittest.output,
  //     connections: [],
  //     nodes: [],
  //   };

  //   for (let i = 0; i < fittest.connections.length; i++) {
  //     const c = fittest.connections[i];
  //     const c1 = {
  //       from: c.from,
  //       to: c.to,
  //       weight: c.weight,
  //       gater: c.gater,
  //     };

  //     aClone.connections.push(c1);
  //   }

  //   for (let i = 0; i < fittest.nodes.length; i++) {
  //     const n = fittest.nodes[i];
  //     const n2 = {
  //       bias: n.bias,
  //       index: n.index,
  //       mask: n.mask,
  //       squash: n.squash,
  //       type: n.type,
  //     };

  //     aClone.nodes.push(n2);
  //   }

  return Network.fromJSON(json);
}
