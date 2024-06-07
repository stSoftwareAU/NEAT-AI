import { blue, bold, cyan } from "@std/fmt/colors";
import { addTag, getTag } from "@stsoftware/tags";
import { Creature } from "../Creature.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import type { NeuronExport } from "./NeuronInterfaces.ts";
import type { CreatureExport } from "../../mod.ts";
import type { SynapseExport } from "./SynapseInterfaces.ts";

const MIN_STEP = 0.000_000_1;

function addMissingSynapses(from: CreatureExport, to: CreatureExport) {
  const neuronsSet = new Set<string>();
  to.neurons.forEach((n) => {
    neuronsSet.add(n.uuid);
  });

  for (let indx = 0; indx < to.input; indx++) {
    neuronsSet.add(`input-${indx}`);
  }

  const synapsesSet = new Set<string>();

  to.synapses.forEach((s) => {
    synapsesSet.add(`${s.fromUUID}->${s.toUUID}`);
  });

  from.synapses.forEach((s) => {
    if (neuronsSet.has(s.fromUUID) && neuronsSet.has(s.toUUID)) {
      if (!synapsesSet.has(`${s.fromUUID}->${s.toUUID}`)) {
        const toSynapse: SynapseExport = JSON.parse(JSON.stringify(s));
        toSynapse.weight = 0;
        to.synapses.push(toSynapse);
      }
    }
  });
}

function tuneRandomize(
  fittest: Creature,
  previousFittest: Creature,
  oldScore: string,
  randomize = true,
) {
  const previousJSON = previousFittest.exportJSON();
  const fittestJSON = fittest.exportJSON();

  addMissingSynapses(fittestJSON, previousJSON);
  addMissingSynapses(previousJSON, fittestJSON);

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
      let step: number;
      if (randomize) {
        step = diff * Math.random() * 3 - diff;
      } else {
        step = diff;
      }

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
        let step: number;
        if (randomize) {
          step = diff * Math.random() * 3 - diff;
        } else {
          step = diff;
        }

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

  if (changeBiasCount == 0 && changeWeightCount == 0) {
    return {
      changeBiasCount: changeBiasCount,
      changeWeightCount: changeWeightCount,
      tuned: null,
    };
  }

  const all = Creature.fromJSON(fittestJSON);
  addTag(all, "approach", "fine");
  let adjustedDesc = "";
  if (changeWeightCount > 0) {
    adjustedDesc += changeWeightCount + " weight" +
      (changeWeightCount > 1 ? "s" : "");
  }
  if (changeBiasCount > 0) {
    if (adjustedDesc.length > 0) {
      adjustedDesc += ", ";
    }
    adjustedDesc += changeBiasCount + " bias" +
      (changeBiasCount > 1 ? "es" : "");
  }

  addTag(
    all,
    "adjusted",
    adjustedDesc,
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
    const logged = getTag(fittest, "logged");
    if (logged !== "true") {
      addTag(fittest, "logged", "true");
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

  const resultSame = tuneRandomize(fittest, previousFittest, fScoreTxt, false);
  if (resultSame.tuned) {
    const randomUUID = await CreatureUtil.makeUUID(resultSame.tuned);
    if (!UUIDs.has(randomUUID)) {
      UUIDs.add(randomUUID);
      fineTuned.push(resultSame.tuned);
    }
  }

  for (
    let attempt = 0;
    attempt < popSize * 2 && fineTuned.length < popSize;
    attempt++
  ) {
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
