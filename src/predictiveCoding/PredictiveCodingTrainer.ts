/**
 * Predictive Coding training orchestrator.
 *
 * Issue #1556: Orchestrates the full PC training loop for a creature
 * using binary training data. For each iteration, runs PC inference
 * (settling) on each sample, accumulates weight/bias gradients, and
 * applies averaged Hebbian updates.
 *
 * Training loop:
 *   For each iteration:
 *     For each sample:
 *       1. Clamp inputs, run PC inference (settling)
 *       2. Accumulate weight/bias gradients from prediction errors
 *     3. Apply averaged weight updates (Hebbian learning)
 *     4. Compute validation error
 *     5. Check early stopping (targetError)
 */

import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import type { CostInterface } from "../costs/CostInterface.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import type { RequiredPredictiveCodingConfig } from "../config/PredictiveCodingConfig.ts";
import { runInference } from "./PredictiveCodingInference.ts";
import {
  applyHebbianUpdate,
  type BiasGradient,
  computeWeightGradients,
  type SynapseGradient,
  type WeightGradients,
} from "./PredictiveCodingLearning.ts";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { computeEffectiveConfig } from "./AdaptiveScaling.ts";
import {
  type DataFuzzingConfig,
  DEFAULT_DATA_FUZZING_CONFIG,
  type RequiredDataFuzzingConfig,
} from "../config/DataFuzzingConfig.ts";
import {
  type DataQuantisationConfig,
  DEFAULT_DATA_QUANTISATION_CONFIG,
  type RequiredDataQuantisationConfig,
} from "../config/DataQuantisationConfig.ts";
import { applyNoise } from "@propagate/DataFuzzing.ts";
import { quantiseBuffer } from "@propagate/DataQuantisation.ts";

/**
 * Result from Predictive Coding training.
 */
export interface PCTrainingResult {
  /** Average error after training. */
  error: number;
  /** Number of iterations completed. */
  iterations: number;
  /** Average total energy at convergence across final iteration samples. */
  averageEnergy: number;
  /** Average inference steps used per sample in final iteration. */
  averageInferenceSteps: number;
  /** Whether any weights were changed during training. */
  changed: boolean;
}

/**
 * Trains a creature using Predictive Coding local learning rules.
 *
 * Reads binary training files directly and runs the PC inference and
 * Hebbian learning loop. Returns a result compatible with the standard
 * training pipeline.
 *
 * @param creature The creature to train.
 * @param binaryFiles Array of binary data file paths.
 * @param pcConfig Predictive Coding configuration.
 * @param cost Cost function for error computation.
 * @param options Training loop options.
 * @returns Training result with error and iteration count.
 */
export function trainWithPredictiveCoding(
  creature: Creature,
  binaryFiles: string[],
  pcConfig: RequiredPredictiveCodingConfig,
  cost: CostInterface,
  options: {
    iterations: number;
    targetError: number;
    log?: number;
    dataFuzzing?: DataFuzzingConfig;
    dataQuantisation?: DataQuantisationConfig;
  },
): PCTrainingResult {
  const { iterations, targetError } = options;

  // Issue #1900: Resolve data fuzzing configuration.
  const fuzzingConfig: RequiredDataFuzzingConfig = {
    ...DEFAULT_DATA_FUZZING_CONFIG,
    ...options.dataFuzzing,
  };

  // Issue #1901: Resolve data quantisation configuration.
  const quantisationConfig: RequiredDataQuantisationConfig = {
    ...DEFAULT_DATA_QUANTISATION_CONFIG,
    ...options.dataQuantisation,
  };

  // Issue #1915: Apply adaptive learning rate scaling for complex creatures.
  const effective = computeEffectiveConfig(creature, pcConfig);
  const effectivePCConfig = {
    ...pcConfig,
    learningRate: effective.learningRate,
  };

  const rng = getRandomNumberGenerator();
  const valuesCount = creature.input + creature.output;
  const BYTES_PER_RECORD = valuesCount * 4;

  // Reusable buffers for reading binary data.
  const recordBuffer = new Uint8Array(BYTES_PER_RECORD);
  const recordArray = new Float32Array(recordBuffer.buffer);
  const observationsBuffer = new Float32Array(creature.input);
  const targetsBuffer = new Float32Array(creature.output);
  const targetsFloat64 = new Float64Array(creature.output);

  let bestError: number | undefined;
  let bestCreatureJSON = creature.exportJSON();
  let averageEnergy = 0;
  let averageInferenceSteps = 0;
  let changed = false;

  for (let iteration = 0; iteration < iterations; iteration++) {
    // Accumulated gradients across all samples in this iteration.
    const accSynapseDeltas = new Float64Array(creature.synapses.length);
    const accBiasDeltas = new Map<number, number>();
    let sampleCount = 0;
    let errorSum = 0;
    let energySum = 0;
    let stepsSum = 0;

    for (let fileIdx = 0; fileIdx < binaryFiles.length; fileIdx++) {
      const file = Deno.openSync(binaryFiles[fileIdx], { read: true });
      try {
        while (true) {
          const bytesRead = file.readSync(recordBuffer);
          if (bytesRead === null || bytesRead < BYTES_PER_RECORD) break;

          // Extract input and target from record.
          observationsBuffer.set(recordArray.subarray(0, creature.input));
          targetsBuffer.set(recordArray.subarray(creature.input));

          // Issue #1901: Apply data quantisation to prevent memorisation.
          if (quantisationConfig.enabled) {
            quantiseBuffer(
              observationsBuffer,
              quantisationConfig.inputLevels,
            );
            if (quantisationConfig.outputLevels > 0) {
              quantiseBuffer(targetsBuffer, quantisationConfig.outputLevels);
            }
          }

          // Issue #1900: Apply data fuzzing (noise injection) to prevent memorisation.
          if (fuzzingConfig.enabled) {
            applyNoise(
              observationsBuffer,
              fuzzingConfig.inputNoiseScale,
              fuzzingConfig.noiseType,
              rng,
            );
            if (fuzzingConfig.outputNoiseScale > 0) {
              applyNoise(
                targetsBuffer,
                fuzzingConfig.outputNoiseScale,
                fuzzingConfig.noiseType,
                rng,
              );
            }
          }

          // Convert targets to Float64 for PC inference.
          for (let j = 0; j < creature.output; j++) {
            targetsFloat64[j] = targetsBuffer[j];
          }

          // Step 1: Forward activation to set up neuron states.
          const output = creature.activate(observationsBuffer);

          // Step 2: Run PC inference (settling) with clamped targets.
          const inferenceResult = runInference(
            creature,
            observationsBuffer,
            pcConfig,
            targetsFloat64,
          );

          // Step 3: Compute cost error from the forward activation output.
          const sampleError = cost.calculate(targetsBuffer, output);
          assert(Number.isFinite(sampleError), "Sample error is not finite");
          errorSum += sampleError;
          energySum += inferenceResult.finalEnergy;
          stepsSum += inferenceResult.stepsUsed;
          sampleCount++;

          // Step 4: Compute gradients from settled inference state.
          // Issue #1915: Use effective config with adaptive learning rate.
          const gradients = computeWeightGradients(
            creature,
            inferenceResult,
            effectivePCConfig,
          );

          // Accumulate gradients.
          for (const sg of gradients.synapseGradients) {
            accSynapseDeltas[sg.synapseIndex] += sg.delta;
          }
          for (const bg of gradients.biasGradients) {
            const prev = accBiasDeltas.get(bg.neuronIndex) ?? 0;
            accBiasDeltas.set(bg.neuronIndex, prev + bg.delta);
          }
        }
      } finally {
        file.close();
      }
    }

    if (sampleCount === 0) {
      throw new ValidationError(
        "No samples were processed during PC training",
        "OTHER",
      );
    }

    // Step 5: Apply averaged gradients.
    const avgSynapseGradients: SynapseGradient[] = [];
    for (let s = 0; s < accSynapseDeltas.length; s++) {
      avgSynapseGradients.push({
        synapseIndex: s,
        delta: accSynapseDeltas[s] / sampleCount,
      });
    }

    const avgBiasGradients: BiasGradient[] = [];
    for (const [neuronIndex, totalDelta] of accBiasDeltas) {
      avgBiasGradients.push({
        neuronIndex,
        delta: totalDelta / sampleCount,
      });
    }

    const avgGradients: WeightGradients = {
      synapseGradients: avgSynapseGradients,
      biasGradients: avgBiasGradients,
    };

    const error = errorSum / sampleCount;
    averageEnergy = energySum / sampleCount;
    averageInferenceSteps = stepsSum / sampleCount;

    // Check if this iteration improved the error.
    if (bestError === undefined || error < bestError) {
      bestError = error;
      bestCreatureJSON = creature.exportJSON();
    }

    // Apply Hebbian updates.
    applyHebbianUpdate(creature, avgGradients);
    changed = true;

    // Invalidate WASM cache after weight changes.
    if (creature.cachedWasmActivation) {
      creature.cachedWasmActivation.free();
      creature.cachedWasmActivation = undefined;
    }
    delete creature.uuid;
    delete creature.memetic;
    creature.state.preparedNeurons = false;

    if (options.log && (iteration + 1) % options.log === 0) {
      getLogger().info(
        `PC Training iteration ${iteration + 1}/${iterations}`,
        `error: ${error.toFixed(6)}`,
        `energy: ${averageEnergy.toFixed(6)}`,
        `avg steps: ${averageInferenceSteps.toFixed(1)}`,
      );
    }

    // Early stopping.
    if (bestError <= targetError) {
      break;
    }
  }

  // Restore best creature if last iteration was worse.
  const finalError = bestError ?? Infinity;
  creature.loadFrom(bestCreatureJSON, false);

  return {
    error: finalError,
    iterations: iterations,
    averageEnergy,
    averageInferenceSteps,
    changed,
  };
}
