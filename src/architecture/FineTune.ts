import { addTag, getTag, removeTag } from "@stsoftware/tags";
import { Creature } from "../Creature.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import type { NeuronExport } from "./NeuronInterfaces.ts";
import type { CreatureExport } from "../../mod.ts";
import type { SynapseExport } from "./SynapseInterfaces.ts";
import { assert } from "@std/assert";

export const MIN_STEP = 0.000_000_1;

/**
 * Adjusts the best value based on the difference between the current best and previous best value.
 *
 * @param {number} currentBest - The current fittest value.
 * @param {number} previousBest - The previous fittest value.
 * @param {boolean} forwardOnly - Mode to adjust values; true for forward only, false for randomize.
 * @returns {number} - The adjusted best value.
 */
export function quantumAdjust(
  currentBest: number,
  previousBest: number,
  forwardOnly: boolean,
): { value: number; changed: boolean } {
  const diff = currentBest - previousBest;
  if (Math.abs(diff) >= MIN_STEP - MIN_STEP / 10) {
    let delta: number;
    if (forwardOnly) {
      delta = diff * Math.random() * 2;
    } else {
      delta = diff * Math.random() * 3 - diff;
    }

    const adjustedValue = currentBest + delta;
    const currentQuantum = Math.round(currentBest / MIN_STEP);
    let quantum = Math.round(adjustedValue / MIN_STEP);

    /* Ensure the quantum value is at least one MIN_STEP different in the correct direction */
    if (currentQuantum == quantum) {
      quantum += Math.sign(delta);
    }

    const quantizedValue = quantum * MIN_STEP;

    return { value: quantizedValue, changed: true };
  }
  return { value: currentBest, changed: false };
}

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
  forwardOnly = false,
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
      const result = quantumAdjust(
        fittestNeuron.bias,
        previousNeuron.bias,
        forwardOnly,
      );
      if (result.changed) {
        fittestNeuron.bias = result.value;
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
        const result = quantumAdjust(
          fittestSynapse.weight,
          previousSynapse.weight,
          forwardOnly,
        );
        if (result.changed) {
          fittestSynapse.weight = result.value;
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
  removeTag(all, "approach-logged");
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
) {
  if (previousFittest == null) {
    return [];
  }
  const fScoreTxt = getTag(fittest, "score");
  assert(fScoreTxt, "Fittest creature must have a score");
  const fScore = Number.parseFloat(fScoreTxt);

  const pScoreTxt = getTag(previousFittest, "score");
  assert(pScoreTxt, "Previous creature must have a score");

  const pScore = Number.parseFloat(pScoreTxt);

  if (fScore == pScore) return [];
  assert(
    fScore > pScore,
    "Fittest creature must have a higher score than previous",
  );

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
