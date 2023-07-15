import { addTag, getTag } from "../tags/TagsInterface.ts";
import { Network } from "./Network.ts";
import { NetworkInternal } from "./NetworkInterfaces.ts";
import { NetworkUtil } from "./NetworkUtils.ts";
import { NodeExport } from "./NodeInterfaces.ts";
const MIN_STEP = 0.000_000_1;

function tuneRandomize(
  fittest: NetworkInternal,
  previousFittest: NetworkInternal,
  oldScore: string,
) {
  const previousJSON = (previousFittest as Network).exportJSON();
  const fittestJSON = (fittest as Network).exportJSON();

  const uuidNodeMap = new Map<string, NodeExport>();

  previousJSON.nodes.forEach((n) => {
    const uuid = n.uuid ? n.uuid : "";
    uuidNodeMap.set(uuid, n);
  });

  let changeBiasCount = 0;
  let changeWeightCount = 0;
  for (let i = fittestJSON.nodes.length; i--;) {
    const tn = fittestJSON.nodes[i];

    const pn = uuidNodeMap.get(tn.uuid ? tn.uuid : "");

    if (pn && tn.squash == pn.squash) {
      const diff = (tn.bias ? tn.bias : 0) - (pn.bias ? pn.bias : 0);
      const step = diff * Math.random() * 3 - diff;
      if (
        Math.abs(step) > MIN_STEP
      ) {
        const bias = (tn.bias ? tn.bias : 0) + step;
        const quantum = Math.round(bias / MIN_STEP);
        tn.bias = quantum * MIN_STEP;
        changeBiasCount++;
      }
    }
  }

  for (let i = fittestJSON.connections.length; i--;) {
    const tc = fittestJSON.connections[i];
    for (let j = previousJSON.connections.length; j--;) {
      const pc = previousJSON.connections[j];

      if (tc.fromUUID == pc.fromUUID && tc.toUUID == pc.toUUID) {
        const diff = tc.weight - pc.weight;
        const step = diff * Math.random() * 3 - diff;
        if (Math.abs(step) > MIN_STEP) {
          const weight = tc.weight + step;
          const quantum = Math.round(weight / MIN_STEP);

          tc.weight = quantum * MIN_STEP;
          changeWeightCount++;
        }

        break;
      }
    }
  }

  if (changeBiasCount == 0 || changeWeightCount == 0) {
    return {
      changeBiasCount: changeBiasCount,
      changeWeightCount: changeWeightCount,
      tuned: null,
    };
  }

  const all = Network.fromJSON(fittestJSON);
  addTag(all, "approach", "fine");
  addTag(
    all,
    "adjusted",
    changeWeightCount + " weight" + (changeWeightCount > 1 ? "s" : "") +
      ", " + changeBiasCount + " bias" + (changeBiasCount > 1 ? "es" : ""),
  );

  addTag(all, "old-score", oldScore);

  return {
    changeBiasCount: changeBiasCount,
    changeWeightCount: changeWeightCount,
    tuned: all,
  };
}

export async function fineTuneImprovement(
  fittest: NetworkInternal,
  previousFittest: NetworkInternal | null,
  popSize = 10,
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
    );
  } else if (approach == "trained") {
    console.info(
      "Training increased fitness by",
      fScore - pScore,
      "to",
      fScore,
    );
  } else if (approach == "compact") {
    console.info(
      "Compacting increased fitness by",
      fScore - pScore,
      "to",
      fScore,
      `nodes: ${fittest.nodes.length} was:`,
      getTag(fittest, "old-nodes"),
      `connections: ${fittest.connections.length} was:`,
      getTag(fittest, "old-connections"),
    );
  } else if (approach == "Learnings") {
    console.info(
      "Learnings increased fitness by",
      fScore - pScore,
      "to",
      fScore,
      `nodes: ${fittest.nodes.length} was:`,
      getTag(fittest, "old-nodes"),
      `connections: ${fittest.connections.length} was:`,
      getTag(fittest, "old-connections"),
    );
  }

  await NetworkUtil.makeUUID(fittest as Network);
  const UUIDs = new Set<string>();
  UUIDs.add(fittest.uuid ? fittest.uuid : "");

  const fineTuned: Network[] = [];
  const compactNetwork = (fittest as Network).compact();
  if (compactNetwork != null) {
    await NetworkUtil.makeUUID(compactNetwork);
    const uuid = compactNetwork.uuid ? compactNetwork.uuid : "";
    if (!UUIDs.has(uuid)) {
      UUIDs.add(uuid);
      fineTuned.push(compactNetwork);
    }
  }

  for (let attempt = 0; attempt < popSize; attempt++) {
    const resultRandomize = tuneRandomize(fittest, previousFittest, fScoreTxt);
    if (resultRandomize.tuned) {
      await NetworkUtil.makeUUID(resultRandomize.tuned);
      const uuid = resultRandomize.tuned.uuid ? resultRandomize.tuned.uuid : "";
      if (!UUIDs.has(uuid)) {
        UUIDs.add(uuid);
        fineTuned.push(resultRandomize.tuned);
      }
    }
  }

  return fineTuned;
}
