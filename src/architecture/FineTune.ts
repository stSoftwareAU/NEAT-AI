import { blue, bold, cyan } from "https://deno.land/std@0.223.0/fmt/colors.ts";
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
    uuidNodeMap.set(n.uuid, n);
  });

  let changeBiasCount = 0;
  let changeWeightCount = 0;
  for (let i = fittestJSON.neurons.length; i--;) {
    const fittestNeuron = fittestJSON.neurons[i];

    const previousNeuron = uuidNodeMap.get(fittestNeuron.uuid);

    if (previousNeuron && fittestNeuron.squash == previousNeuron.squash) {
      const diff = fittestNeuron.bias - previousNeuron.bias;
      const step = diff * Math.random() * 3 - diff;
      if (
        Math.abs(step) > MIN_STEP
      ) {
        const bias = fittestNeuron.bias + step;
        const quantum = Math.round(bias / MIN_STEP);
        fittestNeuron.bias = quantum * MIN_STEP;
        changeBiasCount++;
      }
    }
  }

  for (let i = fittestJSON.synapses.length; i--;) {
    const fittestSynapse = fittestJSON.synapses[i];
    for (let j = previousJSON.synapses.length; j--;) {
      const previousSynapse = previousJSON.synapses[j];

      if (
        fittestSynapse.fromUUID == previousSynapse.fromUUID &&
        fittestSynapse.toUUID == previousSynapse.toUUID
      ) {
        const diff = fittestSynapse.weight - previousSynapse.weight;
        const step = diff * Math.random() * 3 - diff;
        if (Math.abs(step) > MIN_STEP) {
          const weight = fittestSynapse.weight + step;
          const quantum = Math.round(weight / MIN_STEP);

          fittestSynapse.weight = quantum * MIN_STEP;
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
        blue(`${trainID}`),
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
  const fittestUUID = await CreatureUtil.makeUUID(fittest);
  const UUIDs = new Set<string>();
  UUIDs.add(fittestUUID);

  const fineTuned: Creature[] = [];
  const compactNetwork = fittest.compact();
  if (compactNetwork) {
    const compactUUID = await CreatureUtil.makeUUID(compactNetwork);

    if (!UUIDs.has(compactUUID)) {
      UUIDs.add(compactUUID);
      fineTuned.push(compactNetwork);
    }
  }

  for (let attempt = 0; attempt < popSize; attempt++) {
    const resultRandomize = tuneRandomize(fittest, previousFittest, fScoreTxt);
    if (resultRandomize.tuned) {
      const randomUUID = await CreatureUtil.makeUUID(resultRandomize.tuned);
      if (!UUIDs.has(randomUUID)) {
        UUIDs.add(randomUUID);
        fineTuned.push(resultRandomize.tuned);
      }
    }
  }

  return fineTuned;
}
