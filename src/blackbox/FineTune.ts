import { addTag, removeTag } from "@stsoftware/tags/mod";
import { Creature } from "../Creature.ts";
import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";
import type { CreatureExport } from "../../mod.ts";
import type { SynapseExport } from "../architecture/SynapseInterfaces.ts";
import { assert } from "@std/assert";
import type { Approach } from "../NEAT/LogApproach.ts";
import {
  DEFAULT_ANCESTRY_DEPTH,
  type MemeticInterface,
} from "./MemeticInterface.ts";
import {
  addToAncestry,
  calculateTrajectoryMomentum,
  createAncestorSnapshot,
} from "./MemeticTrajectory.ts";

export const MIN_STEP = 0.000_000_1;

/**
 * Adjusts the best value based on the difference between the current best and previous best value.
 * Uses trajectory momentum to bias adjustments in the direction of consistent historical improvement.
 *
 * @param {number} currentBest - The current fittest value.
 * @param {number} previousBest - The previous fittest value.
 * @param {boolean} forwardOnly - Mode to adjust values; true for forward only, false for randomize.
 * @param {boolean} backtrack - Whether to backtrack (use smaller scale).
 * @param {number} momentumFactor - Optional momentum factor (0.5-2.0) from trajectory analysis.
 *                                  Higher values bias adjustment more strongly in the direction of change.
 * @param {number} suggestedDirection - Optional suggested direction from trajectory (-1, 0, or 1).
 * @returns {number} - The adjusted best value.
 */
export function quantumAdjust(
  currentBest: number,
  previousBest: number,
  forwardOnly: boolean,
  backtrack: boolean,
  momentumFactor?: number,
  suggestedDirection?: number,
): { value: number; changed: boolean } {
  const diff = currentBest - previousBest;
  if (Math.abs(diff) >= MIN_STEP - MIN_STEP / 10) {
    const scale = backtrack ? 1 : 2;
    let delta: number;

    // Apply momentum factor when available
    const effectiveMomentum = momentumFactor ?? 1.0;

    if (forwardOnly) {
      delta = diff * Math.random() * scale;
    } else {
      delta = diff * Math.random() * (scale + 1) - diff;
    }

    // Apply momentum: if we have a strong consistent trajectory, bias towards it
    if (
      effectiveMomentum > 1.0 && suggestedDirection !== undefined &&
      suggestedDirection !== 0
    ) {
      // Increase adjustment magnitude in the suggested direction
      const momentumBoost = (effectiveMomentum - 1.0) * Math.abs(diff);
      if (Math.sign(delta) === suggestedDirection) {
        // Already moving in suggested direction, amplify
        delta *= effectiveMomentum;
      } else if (Math.random() < 0.5) {
        // Moving against suggested direction, sometimes flip
        delta = Math.abs(delta) * suggestedDirection +
          momentumBoost * suggestedDirection;
      }
    } else if (effectiveMomentum < 1.0) {
      // Low consistency, be more conservative
      delta *= effectiveMomentum;
    }

    const adjustedValue = currentBest + delta;
    const currentQuantum = Math.round(currentBest / MIN_STEP);
    let quantum = Math.round(adjustedValue / MIN_STEP);

    /* Ensure the quantum value is at least one MIN_STEP different in the correct direction */
    if (currentQuantum === quantum) {
      quantum += Math.sign(delta);
    }

    const quantizedValue = quantum * MIN_STEP;

    return { value: quantizedValue, changed: true };
  }
  return { value: currentBest, changed: false };
}

function addMissingSynapses(
  from: CreatureExport,
  to: CreatureExport,
  options: { forwardOnly: boolean },
) {
  const forwardOnly = options.forwardOnly === true;

  // In forward-only mode, a synapse is valid only when its source neuron appears
  // earlier than its destination neuron in the *target* creature's ordering.
  //
  // Important (Australian English): neuron UUIDs do not encode ordering; two valid
  // forward-only creatures can share the same neurons but have different index
  // orders. Copying a synapse by UUID across those orderings can create a
  // recurrent/backward connection in the target, corrupting the creature.
  const toIndexByUUID = new Map<string, number>();
  for (let i = 0; i < to.input; i++) {
    toIndexByUUID.set(`input-${i}`, i);
  }
  for (let i = 0; i < to.neurons.length; i++) {
    toIndexByUUID.set(to.neurons[i].uuid, to.input + i);
  }

  const toNeuronsMap = new Map<
    string,
    { type: string; squash?: string } | null
  >();
  to.neurons.forEach((n) => {
    toNeuronsMap.set(n.uuid, n);
  });

  const fromNeuronsMap = new Map<string, NeuronExport>();
  from.neurons.forEach((n) => {
    fromNeuronsMap.set(n.uuid, n);
  });

  for (let indx = 0; indx < to.input; indx++) {
    toNeuronsMap.set(`input-${indx}`, null);
  }

  const synapsesSet = new Set<string>();

  to.synapses.forEach((s) => {
    synapsesSet.add(`${s.fromUUID}->${s.toUUID}`);
  });

  from.synapses.forEach((s) => {
    if (toNeuronsMap.has(s.fromUUID) && toNeuronsMap.has(s.toUUID)) {
      if (forwardOnly) {
        const fromIndex = toIndexByUUID.get(s.fromUUID);
        const toIndex = toIndexByUUID.get(s.toUUID);
        // If we cannot resolve indices, do not attempt to add the synapse.
        if (fromIndex === undefined || toIndex === undefined) return;
        // Reject self-loops and backward/recurrent connections in forward-only mode.
        if (fromIndex >= toIndex) return;
      }
      if (!synapsesSet.has(`${s.fromUUID}->${s.toUUID}`)) {
        const toSynapse: SynapseExport = JSON.parse(JSON.stringify(s));
        toSynapse.weight = 0;
        to.synapses.push(toSynapse);
        const neuron = toNeuronsMap.get(s.toUUID);
        if (neuron) {
          if (neuron.type === "constant") {
            const fromNeuron = fromNeuronsMap.get(s.toUUID);
            if (fromNeuron) {
              neuron.squash = fromNeuron.squash;
            }
            neuron.type = "hidden";
          }
        }
      }
    }
  });
}

function tuneRandomize(
  fittest: Creature,
  previousFittest: Creature,
  forwardOnly = false,
  backtrack = false,
) {
  const previousJSON = previousFittest.exportJSON();
  const fittestJSON = fittest.exportJSON();

  let memetic: MemeticInterface;
  let existingMemetic: MemeticInterface | undefined;

  if (fittestJSON.memetic) {
    existingMemetic = fittestJSON.memetic;
    // Create a deep copy of the existing memetic data
    memetic = JSON.parse(JSON.stringify(fittestJSON.memetic));
  } else {
    memetic = {
      generation: 0,
      score: previousFittest.score ?? -1,
      biases: {},
      weights: {},
    };
  }

  addMissingSynapses(fittestJSON, previousJSON, { forwardOnly });
  addMissingSynapses(previousJSON, fittestJSON, { forwardOnly });

  const uuidNodeMap = new Map<string, NeuronExport>();

  previousJSON.neurons.forEach((n) => {
    uuidNodeMap.set(n.uuid, n);
  });

  let changeBiasCount = 0;
  let changeWeightCount = 0;
  for (let i = fittestJSON.neurons.length; i--;) {
    const fittestNeuron = fittestJSON.neurons[i];

    const previousNeuron = uuidNodeMap.get(fittestNeuron.uuid);

    if (previousNeuron && fittestNeuron.squash === previousNeuron.squash) {
      // Calculate trajectory momentum for this bias if we have ancestry
      let momentumFactor: number | undefined;
      let suggestedDirection: number | undefined;
      if (existingMemetic?.ancestry && existingMemetic.ancestry.length > 0) {
        const momentum = calculateTrajectoryMomentum(
          existingMemetic,
          fittestNeuron.uuid,
          undefined,
          true, // isBias
        );
        if (momentum) {
          momentumFactor = momentum.factor;
          suggestedDirection = momentum.suggestedDirection;
        }
      }

      const result = quantumAdjust(
        fittestNeuron.bias,
        previousNeuron.bias,
        forwardOnly,
        backtrack,
        momentumFactor,
        suggestedDirection,
      );
      if (result.changed) {
        fittestNeuron.bias = result.value;
        changeBiasCount++;
        if (!memetic.biases[fittestNeuron.uuid]) {
          memetic.biases[fittestNeuron.uuid] = previousNeuron.bias;
        }
      }
    }
  }

  for (let i = fittestJSON.synapses.length; i--;) {
    const fittestSynapse = fittestJSON.synapses[i];
    for (let j = previousJSON.synapses.length; j--;) {
      const previousSynapse = previousJSON.synapses[j];

      if (
        fittestSynapse.fromUUID === previousSynapse.fromUUID &&
        fittestSynapse.toUUID === previousSynapse.toUUID
      ) {
        // Calculate trajectory momentum for this weight if we have ancestry
        let momentumFactor: number | undefined;
        let suggestedDirection: number | undefined;
        if (existingMemetic?.ancestry && existingMemetic.ancestry.length > 0) {
          const momentum = calculateTrajectoryMomentum(
            existingMemetic,
            fittestSynapse.fromUUID,
            fittestSynapse.toUUID,
            false, // not a bias
          );
          if (momentum) {
            momentumFactor = momentum.factor;
            suggestedDirection = momentum.suggestedDirection;
          }
        }

        const result = quantumAdjust(
          fittestSynapse.weight,
          previousSynapse.weight,
          forwardOnly,
          backtrack,
          momentumFactor,
          suggestedDirection,
        );
        if (result.changed) {
          fittestSynapse.weight = result.value;
          assert(
            Number.isFinite(fittestSynapse.weight),
            "weight must be a number",
          );
          changeWeightCount++;
          if (!memetic.weights[fittestSynapse.fromUUID]) {
            memetic.weights[fittestSynapse.fromUUID] = [];
          }
          const existingWeight = memetic.weights[fittestSynapse.fromUUID].find(
            (w) => w.toUUID === fittestSynapse.toUUID,
          );
          if (!existingWeight) {
            memetic.weights[fittestSynapse.fromUUID].push({
              toUUID: fittestSynapse.toUUID,
              weight: previousSynapse.weight,
            });
          }
        }

        break;
      }
    }
  }

  if (changeBiasCount === 0 && changeWeightCount === 0) {
    return {
      changeBiasCount: changeBiasCount,
      changeWeightCount: changeWeightCount,
      tuned: null,
    };
  }

  // Build ancestry: add current memetic state to ancestry before incrementing generation
  if (existingMemetic && memetic.generation > 0) {
    const ancestorSnapshot = createAncestorSnapshot(existingMemetic);
    memetic.ancestry = addToAncestry(
      existingMemetic.ancestry,
      ancestorSnapshot,
      DEFAULT_ANCESTRY_DEPTH,
    );
  }

  memetic.generation++;

  const tuned = Creature.fromJSON(fittestJSON);
  tuned.memetic = memetic;
  addTag(tuned, "approach", "fine" as Approach);
  removeTag(tuned, "approach-logged");
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
    tuned,
    "adjusted",
    adjustedDesc,
  );

  return {
    changeBiasCount: changeBiasCount,
    changeWeightCount: changeWeightCount,
    tuned: tuned,
  };
}

export function fineTuneImprovement(
  fittest: Creature,
  previousFittest: Creature | null,
  feedbackLoop: boolean,
  popSize = 10,
  backtrack = false,
) {
  if (previousFittest === null) {
    return [];
  }
  assert(fittest.score);

  if (
    fittest.score === previousFittest.score ||
    !Number.isFinite(previousFittest.score)
  ) {
    return [];
  }

  const fittestUUID = CreatureUtil.makeUUID(fittest);
  const UUIDs = new Set<string>();
  UUIDs.add(fittestUUID);

  const fineTuned: Creature[] = [];
  const compactNetwork = fittest.compact(feedbackLoop);
  if (compactNetwork) {
    const compactUUID = CreatureUtil.makeUUID(compactNetwork);

    if (!UUIDs.has(compactUUID)) {
      UUIDs.add(compactUUID);
      fineTuned.push(compactNetwork);
    }
  }

  const forwardOnly = feedbackLoop !== true;
  const resultSame = tuneRandomize(
    fittest,
    previousFittest,
    forwardOnly,
    backtrack,
  );
  if (resultSame.tuned) {
    const randomUUID = CreatureUtil.makeUUID(resultSame.tuned);
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
    const resultRandomize = tuneRandomize(
      fittest,
      previousFittest,
      forwardOnly,
      backtrack,
    );
    if (resultRandomize.tuned) {
      const randomUUID = CreatureUtil.makeUUID(resultRandomize.tuned);
      if (!UUIDs.has(randomUUID)) {
        UUIDs.add(randomUUID);
        fineTuned.push(resultRandomize.tuned);
      }
    }
  }

  return fineTuned;
}
