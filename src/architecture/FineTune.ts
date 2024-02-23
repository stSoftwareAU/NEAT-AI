import { blue, bold, cyan } from "https://deno.land/std@0.217.0/fmt/colors.ts";
import { addTag, getTag } from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Creature } from "../Creature.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import { NeuronExport } from "./NeuronInterfaces.ts";
const MIN_STEP = 0.000_000_1;

function tuneRandomize(
  fittest: Creature,
  previousFittest: Creature,
  oldScore: string,
) {
  const previousJSON = previousFittest.exportJSON();
  const fittestJSON = fittest.exportJSON();

  const uuidNodeMap = new Map<string, NeuronExport>();

  previousJSON.neurons.forEach((n) => {
    const uuid = n.uuid ? n.uuid : "";
    uuidNodeMap.set(uuid, n);
  });

  let changeBiasCount = 0;
  let changeWeightCount = 0;
  for (let i = fittestJSON.neurons.length; i--;) {
    const tn = fittestJSON.neurons[i];

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

  for (let i = fittestJSON.synapses.length; i--;) {
    const tc = fittestJSON.synapses[i];
    for (let j = previousJSON.synapses.length; j--;) {
      const pc = previousJSON.synapses[j];

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

  const all = Creature.fromJSON(fittestJSON);
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
  fittest: Creature,
  previousFittest: Creature | null,
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

  if (showMessage) {
    const approach = getTag(fittest, "approach");
    if (approach == "fine") {
      console.info(
        "Fine tuning increased fitness by",
        fScore - pScore,
        "to",
        fScore,
        "adjusted",
        getTag(fittest, "adjusted"),
      );
    } else if (approach == "trained") {
      const trainID = getTag(fittest, "trainID");
      console.info(
        bold(cyan("Training")),
        blue(trainID ? trainID : "UNKNOWN"),
        "increased fitness by",
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
        `nodes: ${fittest.neurons.length} was:`,
        getTag(fittest, "old-nodes"),
        `connections: ${fittest.synapses.length} was:`,
        getTag(fittest, "old-connections"),
      );
    } else if (approach == "Learnings") {
      console.info(
        "Learnings increased fitness by",
        fScore - pScore,
        "to",
        fScore,
        `nodes: ${fittest.neurons.length} was:`,
        getTag(fittest, "old-nodes"),
        `connections: ${fittest.synapses.length} was:`,
        getTag(fittest, "old-connections"),
      );
    }
  }
  await CreatureUtil.makeUUID(fittest);
  const UUIDs = new Set<string>();
  UUIDs.add(fittest.uuid ? fittest.uuid : "");

  const fineTuned: Creature[] = [];
  const compactNetwork = fittest.compact();
  if (compactNetwork) {
    await CreatureUtil.makeUUID(compactNetwork);
    const uuid = compactNetwork.uuid ? compactNetwork.uuid : "";
    if (!UUIDs.has(uuid)) {
      UUIDs.add(uuid);
      fineTuned.push(compactNetwork);
    }
  }

  for (let attempt = 0; attempt < popSize; attempt++) {
    const resultRandomize = tuneRandomize(fittest, previousFittest, fScoreTxt);
    if (resultRandomize.tuned) {
      await CreatureUtil.makeUUID(resultRandomize.tuned);
      const uuid = resultRandomize.tuned.uuid ? resultRandomize.tuned.uuid : "";
      if (!UUIDs.has(uuid)) {
        UUIDs.add(uuid);
        fineTuned.push(resultRandomize.tuned);
      }
    }
  }

  return fineTuned;
}
