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
import {
  coordinateBiasWeightAdjustments,
  type NeuronAdjustmentPlan,
  type SynapseAdjustmentPlan,
} from "./BiasWeightCoordination.ts";
import {
  DEFAULT_QUANTUM_STEP_CONFIG,
  type RequiredQuantumStepConfig,
} from "../config/QuantumStepConfig.ts";
export type { GradientHint, GradientHintMap } from "./GradientHint.ts";
import type { GradientHintMap } from "./GradientHint.ts";

export const MIN_STEP = DEFAULT_QUANTUM_STEP_CONFIG.minStep;

/**
 * Optional adaptive parameters for quantum adjustment.
 * When provided, the step size adapts based on score improvement.
 */
export interface AdaptiveQuantumParams {
  quantumStepConfig: RequiredQuantumStepConfig;
  previousScore: number;
  currentScore: number;
}

/**
 * Calculates the effective quantum step size based on error magnitude.
 *
 * Uses the formula: effectiveStep = minStep * (1 + errorScale * normalisedError)
 * where normalisedError = |error| / (1 + |error|) to keep it bounded in [0, 1).
 *
 * The result is clamped between minStep and maxStep.
 *
 * @param {number} error - The error magnitude (e.g., score difference).
 * @param {RequiredQuantumStepConfig} config - The quantum step configuration.
 * @returns {number} The effective step size, clamped to [minStep, maxStep].
 */
export function calculateEffectiveStep(
  error: number,
  config: RequiredQuantumStepConfig,
): number {
  const absError = Math.abs(error);
  const normalisedError = absError / (1 + absError);
  const effectiveStep = config.minStep *
    (1 + config.errorScale * normalisedError);
  return Math.min(effectiveStep, config.maxStep);
}

/**
 * Adjusts the best value based on the difference between the current best and previous best value.
 * Uses trajectory momentum to bias adjustments in the direction of consistent historical improvement.
 * Optionally uses gradient hints from backpropagation to inform the direction and magnitude.
 *
 * @param {number} currentBest - The current fittest value.
 * @param {number} previousBest - The previous fittest value.
 * @param {boolean} forwardOnly - Mode to adjust values; true for forward only, false for randomize.
 * @param {boolean} backtrack - Whether to backtrack (use smaller scale).
 * @param {number} momentumFactor - Optional momentum factor (0.5-2.0) from trajectory analysis.
 *                                  Higher values bias adjustment more strongly in the direction of change.
 * @param {number} suggestedDirection - Optional suggested direction from trajectory (-1, 0, or 1).
 * @param {AdaptiveQuantumParams} adaptiveParams - Optional adaptive parameters for step sizing.
 * @param {GradientHint} gradientHint - Optional gradient hint from backpropagation.
 *                                      Biases the adjustment direction using gradient sign and scales
 *                                      magnitude based on gradient strength.
 * @returns {{ value: number; changed: boolean }} - The adjusted best value and whether it changed.
 */
export function quantumAdjust(
  currentBest: number,
  previousBest: number,
  forwardOnly: boolean,
  backtrack: boolean,
  momentumFactor?: number,
  suggestedDirection?: number,
  adaptiveParams?: AdaptiveQuantumParams,
  gradientHint?: { direction: -1 | 0 | 1; magnitude: number },
): { value: number; changed: boolean } {
  // Calculate effective step size based on training progress
  const stepSize = adaptiveParams
    ? calculateEffectiveStep(
      adaptiveParams.currentScore - adaptiveParams.previousScore,
      adaptiveParams.quantumStepConfig,
    )
    : MIN_STEP;

  const diff = currentBest - previousBest;
  if (Math.abs(diff) >= stepSize - stepSize / 10) {
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

    // Apply gradient hint: bias delta direction towards the gradient sign
    if (
      gradientHint && gradientHint.direction !== 0 &&
      gradientHint.magnitude > 0
    ) {
      if (Math.sign(delta) !== gradientHint.direction) {
        // Delta opposes gradient direction - blend towards gradient
        // Higher gradient magnitude = stronger pull towards gradient direction
        if (Math.random() < gradientHint.magnitude) {
          delta = Math.abs(delta) * gradientHint.direction;
        }
      } else {
        // Delta already aligns with gradient - amplify proportionally
        delta *= 1 + gradientHint.magnitude * 0.5;
      }
    }

    const adjustedValue = currentBest + delta;
    const currentQuantum = Math.round(currentBest / stepSize);
    let quantum = Math.round(adjustedValue / stepSize);

    /* Ensure the quantum value is at least one step different in the correct direction */
    if (currentQuantum === quantum) {
      quantum += Math.sign(delta);
    }

    const quantizedValue = quantum * stepSize;

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
  forwardOnly?: boolean,
  backtrack?: boolean,
  quantumStepConfig?: RequiredQuantumStepConfig,
  gradientHints?: GradientHintMap,
) {
  const effectiveForwardOnly = forwardOnly ?? false;
  const effectiveBacktrack = backtrack ?? false;
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

  // Build adaptive quantum params from creature scores and config
  const adaptiveParams: AdaptiveQuantumParams | undefined = quantumStepConfig &&
      Number.isFinite(fittest.score) &&
      Number.isFinite(previousFittest.score)
    ? {
      quantumStepConfig,
      previousScore: previousFittest.score!,
      currentScore: fittest.score!,
    }
    : undefined;

  addMissingSynapses(fittestJSON, previousJSON, {
    forwardOnly: effectiveForwardOnly,
  });
  addMissingSynapses(previousJSON, fittestJSON, {
    forwardOnly: effectiveForwardOnly,
  });

  const uuidNodeMap = new Map<string, NeuronExport>();

  previousJSON.neurons.forEach((n) => {
    uuidNodeMap.set(n.uuid, n);
  });

  // Build a lookup for previous synapses by (fromUUID, toUUID)
  const previousSynapseMap = new Map<string, SynapseExport>();
  for (const ps of previousJSON.synapses) {
    previousSynapseMap.set(`${ps.fromUUID}->${ps.toUUID}`, ps);
  }

  // Phase 1: Compute candidate bias adjustments per neuron
  const candidateBiases = new Map<
    string,
    { original: number; candidate: number; previousBias: number }
  >();

  for (let i = fittestJSON.neurons.length; i--;) {
    const fittestNeuron = fittestJSON.neurons[i];
    const previousNeuron = uuidNodeMap.get(fittestNeuron.uuid);

    if (previousNeuron && fittestNeuron.squash === previousNeuron.squash) {
      let momentumFactor: number | undefined;
      let suggestedDirection: number | undefined;
      if (existingMemetic?.ancestry && existingMemetic.ancestry.length > 0) {
        const momentum = calculateTrajectoryMomentum(
          existingMemetic,
          fittestNeuron.uuid,
          undefined,
          true,
        );
        if (momentum) {
          momentumFactor = momentum.factor;
          suggestedDirection = momentum.suggestedDirection;
        }
      }

      const biasGradientHint = gradientHints?.biases.get(fittestNeuron.uuid);
      const result = quantumAdjust(
        fittestNeuron.bias,
        previousNeuron.bias,
        effectiveForwardOnly,
        effectiveBacktrack,
        momentumFactor,
        suggestedDirection,
        adaptiveParams,
        biasGradientHint,
      );
      candidateBiases.set(fittestNeuron.uuid, {
        original: fittestNeuron.bias,
        candidate: result.changed ? result.value : fittestNeuron.bias,
        previousBias: previousNeuron.bias,
      });
    }
  }

  // Phase 2: Compute candidate weight adjustments, grouped by target neuron
  const candidateWeights = new Map<
    string,
    {
      synapseIndex: number;
      fromUUID: string;
      toUUID: string;
      original: number;
      candidate: number;
      previousWeight: number;
    }[]
  >();

  for (let i = fittestJSON.synapses.length; i--;) {
    const fittestSynapse = fittestJSON.synapses[i];
    const key = `${fittestSynapse.fromUUID}->${fittestSynapse.toUUID}`;
    const previousSynapse = previousSynapseMap.get(key);

    if (previousSynapse) {
      let momentumFactor: number | undefined;
      let suggestedDirection: number | undefined;
      if (existingMemetic?.ancestry && existingMemetic.ancestry.length > 0) {
        const momentum = calculateTrajectoryMomentum(
          existingMemetic,
          fittestSynapse.fromUUID,
          fittestSynapse.toUUID,
          false,
        );
        if (momentum) {
          momentumFactor = momentum.factor;
          suggestedDirection = momentum.suggestedDirection;
        }
      }

      const weightKey = `${fittestSynapse.fromUUID}->${fittestSynapse.toUUID}`;
      const weightGradientHint = gradientHints?.weights.get(weightKey);
      const result = quantumAdjust(
        fittestSynapse.weight,
        previousSynapse.weight,
        effectiveForwardOnly,
        effectiveBacktrack,
        momentumFactor,
        suggestedDirection,
        adaptiveParams,
        weightGradientHint,
      );

      const entry = {
        synapseIndex: i,
        fromUUID: fittestSynapse.fromUUID,
        toUUID: fittestSynapse.toUUID,
        original: fittestSynapse.weight,
        candidate: result.changed ? result.value : fittestSynapse.weight,
        previousWeight: previousSynapse.weight,
      };

      const existing = candidateWeights.get(fittestSynapse.toUUID);
      if (existing) {
        existing.push(entry);
      } else {
        candidateWeights.set(fittestSynapse.toUUID, [entry]);
      }
    }
  }

  // Phase 3: Coordinate bias and weight adjustments per neuron
  let changeBiasCount = 0;
  let changeWeightCount = 0;

  for (const [neuronUUID, biasInfo] of candidateBiases) {
    const weightEntries = candidateWeights.get(neuronUUID) ?? [];

    const synapsePlans: SynapseAdjustmentPlan[] = weightEntries.map((w) => ({
      fromUUID: w.fromUUID,
      toUUID: w.toUUID,
      originalWeight: w.original,
      candidateWeight: w.candidate,
    }));

    const plan: NeuronAdjustmentPlan = {
      neuronUUID,
      originalBias: biasInfo.original,
      candidateBias: biasInfo.candidate,
      synapses: synapsePlans,
    };

    const coordinated = coordinateBiasWeightAdjustments(plan);

    if (!coordinated.changed) continue;

    // Apply coordinated bias
    if (coordinated.adjustedBias !== biasInfo.original) {
      const neuron = fittestJSON.neurons.find((n) => n.uuid === neuronUUID);
      if (neuron) {
        neuron.bias = coordinated.adjustedBias;
        changeBiasCount++;
        if (!memetic.biases[neuronUUID]) {
          memetic.biases[neuronUUID] = biasInfo.previousBias;
        }
      }
    }

    // Apply coordinated weights
    for (let wi = 0; wi < coordinated.adjustedWeights.length; wi++) {
      const coordWeight = coordinated.adjustedWeights[wi];
      const weightEntry = weightEntries[wi];

      if (coordWeight.weight !== weightEntry.original) {
        const fittestSynapse = fittestJSON.synapses[weightEntry.synapseIndex];
        fittestSynapse.weight = coordWeight.weight;
        assert(
          Number.isFinite(fittestSynapse.weight),
          "weight must be a number",
        );
        changeWeightCount++;
        if (!memetic.weights[weightEntry.fromUUID]) {
          memetic.weights[weightEntry.fromUUID] = [];
        }
        const existingWeight = memetic.weights[weightEntry.fromUUID].find(
          (w) => w.toUUID === weightEntry.toUUID,
        );
        if (!existingWeight) {
          memetic.weights[weightEntry.fromUUID].push({
            toUUID: weightEntry.toUUID,
            weight: weightEntry.previousWeight,
          });
        }
      }
    }
  }

  // Handle weights for neurons that had no bias candidate (e.g., input neurons as targets)
  for (const [neuronUUID, weightEntries] of candidateWeights) {
    if (candidateBiases.has(neuronUUID)) continue; // Already coordinated above

    for (const weightEntry of weightEntries) {
      if (weightEntry.candidate !== weightEntry.original) {
        const fittestSynapse = fittestJSON.synapses[weightEntry.synapseIndex];
        fittestSynapse.weight = weightEntry.candidate;
        assert(
          Number.isFinite(fittestSynapse.weight),
          "weight must be a number",
        );
        changeWeightCount++;
        if (!memetic.weights[weightEntry.fromUUID]) {
          memetic.weights[weightEntry.fromUUID] = [];
        }
        const existingWeight = memetic.weights[weightEntry.fromUUID].find(
          (w) => w.toUUID === weightEntry.toUUID,
        );
        if (!existingWeight) {
          memetic.weights[weightEntry.fromUUID].push({
            toUUID: weightEntry.toUUID,
            weight: weightEntry.previousWeight,
          });
        }
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
  popSize?: number,
  backtrack?: boolean,
  quantumStepConfig?: RequiredQuantumStepConfig,
  gradientHints?: GradientHintMap,
) {
  const effectivePopSize = popSize ?? 10;
  const effectiveBacktrack = backtrack ?? false;
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
    effectiveBacktrack,
    quantumStepConfig,
    gradientHints,
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
    attempt < effectivePopSize * 2 && fineTuned.length < effectivePopSize;
    attempt++
  ) {
    const resultRandomize = tuneRandomize(
      fittest,
      previousFittest,
      forwardOnly,
      effectiveBacktrack,
      quantumStepConfig,
      gradientHints,
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
