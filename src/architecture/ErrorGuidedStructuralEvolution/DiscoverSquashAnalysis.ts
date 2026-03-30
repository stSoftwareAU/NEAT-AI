/**
 * Squash function analysis for DiscoverStructure.
 *
 * Issue #1472: Extract DiscoverStructure.ts into focused modules.
 *
 * Analyses activation functions to find better alternatives for each neuron,
 * and identifies neurons with extremely high errors that should be removed.
 */
import { assert } from "@std/assert";
import type { Creature } from "@creature";
import { MSE } from "@costs/MSE.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";
import { Activations } from "@methods/activations/Activations.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateSquash,
  DiscoverRecord,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import { buildRuntimeIdToWireMap } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";

/** Module-level MSE instance — the class is stateless so one suffices. */
const mse = new MSE();

/**
 * Calculates MSE between ideal and actual activations.
 */
export function calculateSquashError(
  idealActivations: number[],
  actualActivations: number[],
): number {
  const idealBuffer = new Float32Array(1);
  const actualBuffer = new Float32Array(1);
  let totalError = 0;
  for (let i = 0; i < idealActivations.length; i++) {
    const actualActivation = actualActivations[i];
    if (actualActivation === undefined) {
      throw new TopologyError("Activation is undefined", "INVALID_STATE");
    }
    idealBuffer[0] = idealActivations[i];
    actualBuffer[0] = actualActivation;
    const error = mse.calculate(idealBuffer, actualBuffer);
    totalError += error;
  }

  return totalError / idealActivations.length;
}

/**
 * Core squash analysis: tries all activation functions, picks best.
 *
 * @param creature - The creature containing the neuron
 * @param neuronId - id of the neuron to analyse
 * @param records - Discovery records for the neuron
 * @param calculateNeuronImpactFn - Function to calculate neuron impact
 * @param loggingEnabled - Whether verbose logging is enabled
 * @param logFn - Logging function
 * @returns Best candidate squash, or undefined if current squash is already optimal
 */
export function findCandidateSquash(
  creature: Creature,
  neuronId: number,
  records: DiscoverRecord[],
  calculateNeuronImpactFn: (
    neuronId: number,
    derivativeMap?: Map<number, number>,
  ) => number,
  loggingEnabled: boolean,
  logFn: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ) => void,
): CandidateSquash | undefined {
  const idToWire = buildRuntimeIdToWireMap(creature);
  const rawValues: number[] = [];
  const currentActivations: number[] = [];
  const idealActivations: number[] = [];
  const neuronErrors: number[] = [];

  const neuron = creature.neurons.find((neuron) => neuron.id === neuronId)!;
  const neuronUuid = idToWire.get(neuronId);
  assert(neuronUuid, `Missing wire uuid for neuron ${neuronId}`);
  const currentSquash = neuron.squash;
  assert(currentSquash, "Squash function not found");
  const currentSquashMethod = Activations.find(
    currentSquash,
  ) as ActivationInterface;

  records.forEach((record) => {
    const value = record.value;
    if (value === undefined) {
      throw new TopologyError("Value is undefined", "INVALID_STATE");
    }
    rawValues.push(value);
    const activation = record.activation;
    if (activation === undefined) {
      throw new TopologyError("Activation is undefined", "INVALID_STATE");
    }
    currentActivations.push(activation);
    const errors = record.errors;
    const finiteErrors = errors.filter(Number.isFinite);
    const avgError = finiteErrors.length
      ? finiteErrors.reduce((a, b) => a + b, 0) / finiteErrors.length
      : 0;
    neuronErrors.push(avgError);

    const idealValue = value + avgError;
    const idealActivation = currentSquashMethod.squash(idealValue);
    idealActivations.push(idealActivation);
  });

  // Calculate baseline activation error (for comparison)
  const baselineActivationError = calculateSquashError(
    idealActivations,
    currentActivations,
  );

  const baselineError = baselineActivationError;

  // SANITY CHECK: Filter out neurons with astronomically high errors
  const MAX_REASONABLE_SQUASH_ERROR = 1e10;
  if (baselineError > MAX_REASONABLE_SQUASH_ERROR) {
    if (loggingEnabled) {
      logFn(
        "warn",
        `Skipping squash analysis for neuron ${neuronId}: error magnitude (${
          baselineError.toExponential(2)
        }) exceeds reasonable threshold (${
          MAX_REASONABLE_SQUASH_ERROR.toExponential(2)
        }). ` +
          `This neuron should be removed rather than having its activation function changed.`,
      );
    }
    // Clear arrays to help GC
    rawValues.length = 0;
    currentActivations.length = 0;
    idealActivations.length = 0;
    neuronErrors.length = 0;
    return undefined;
  }

  let lowestError = baselineError;
  let bestSquash = currentSquash;
  let bestSquashFunction: ActivationInterface | undefined = undefined;

  const squashFunctions: ActivationInterface[] = Activations.list().filter(
    (activation) => {
      return (activation as ActivationInterface).squash !== undefined;
    },
  ) as ActivationInterface[];

  // Randomise the order of the squash functions using Fisher-Yates shuffle
  const rng = getRandomNumberGenerator();
  for (let i = squashFunctions.length - 1; i > 0; i--) {
    const j = Math.floor(rng.random() * (i + 1));
    [squashFunctions[i], squashFunctions[j]] = [
      squashFunctions[j],
      squashFunctions[i],
    ];
  }

  for (const squashFunction of squashFunctions) {
    const tempActivations = rawValues.map((value) => {
      return squashFunction.squash(value);
    });
    const newError = calculateSquashError(
      idealActivations,
      tempActivations,
    );

    if (newError < lowestError - 0.0001) {
      lowestError = newError;
      bestSquash = squashFunction.getName();
      bestSquashFunction = squashFunction;
    }
  }

  if (bestSquash !== currentSquash) {
    // Calculate activation-based improvement
    const rawActivationImprovement = baselineError > 0
      ? (baselineError - lowestError) / baselineError
      : 0;

    // Apply a conservative scaling factor that increases with sample count
    const sampleCount = records.length;
    const conservativeScale = Math.min(
      0.5,
      Math.max(0.1, 0.1 + (sampleCount / 40000) * 0.4),
    );

    let rawImprovement: number;
    let scaledImprovement: number;

    try {
      const bestSquashMethod = bestSquashFunction ||
        (Activations.find(bestSquash) as ActivationInterface | undefined);

      if (!bestSquashMethod) {
        rawImprovement = rawActivationImprovement;
        scaledImprovement = rawActivationImprovement * conservativeScale;
      } else {
        let errorImprovementSum = 0;
        let errorImprovementCount = 0;
        let absoluteErrorSum = 0;

        for (let i = 0; i < records.length; i++) {
          const value = rawValues[i];
          const currentActivation = currentActivations[i];
          const newActivation = bestSquashMethod.squash(value);
          const idealActivation = idealActivations[i];
          const error = neuronErrors[i];

          const currentDist = Math.abs(currentActivation - idealActivation);
          const newDist = Math.abs(newActivation - idealActivation);

          if (currentDist > 1e-10 && Number.isFinite(error) && error !== 0) {
            const improvementRatio = (currentDist - newDist) / currentDist;
            const errorMagnitude = Math.abs(error);
            const estimatedImprovement = improvementRatio * errorMagnitude;
            errorImprovementSum += estimatedImprovement;
            absoluteErrorSum += errorMagnitude;
            errorImprovementCount++;
          }
        }

        const avgErrorImprovement = errorImprovementCount > 0
          ? errorImprovementSum / errorImprovementCount
          : 0;
        const meanAbsoluteError = errorImprovementCount > 0
          ? absoluteErrorSum / errorImprovementCount
          : 0;
        const errorBasedImprovement = meanAbsoluteError > 0
          ? avgErrorImprovement / meanAbsoluteError
          : 0;

        rawImprovement = Math.min(
          rawActivationImprovement,
          errorBasedImprovement,
        );
        scaledImprovement = rawImprovement * conservativeScale;
      }
    } catch (_error) {
      rawImprovement = rawActivationImprovement;
      scaledImprovement = rawActivationImprovement * conservativeScale;
    }

    // Compute average derivative from records to account for saturation
    let derivativeSum = 0;
    let derivativeCount = 0;
    const sampleSize = Math.min(records.length, 50);
    const step = Math.max(1, Math.floor(records.length / sampleSize));

    for (let i = 0; i < records.length; i += step) {
      const val = records[i].value;
      if (Number.isFinite(val)) {
        const eps = 1e-4;
        const y1 = currentSquashMethod.squash(val as number);
        const y2 = currentSquashMethod.squash((val as number) + eps);
        const derivative = (y2 - y1) / eps;
        if (Number.isFinite(derivative)) {
          derivativeSum += Math.abs(derivative);
          derivativeCount++;
        }
      }
      if (derivativeCount >= sampleSize) break;
    }

    const avgDerivative = derivativeCount > 0
      ? derivativeSum / derivativeCount
      : 1.0;

    // Create derivativeMap with this neuron's average derivative
    const derivativeMap = new Map<number, number>();
    derivativeMap.set(neuronId, avgDerivative);

    // Scale by neuron's impact on output to avoid inflated expectations
    const neuronImpact = calculateNeuronImpactFn(
      neuronId,
      derivativeMap,
    );
    const impactScale = Number.isFinite(neuronImpact)
      ? Math.min(Math.max(neuronImpact, 0), 1)
      : 1.0;

    const expectedCreatureScoreGain = scaledImprovement * impactScale;

    // Accept any positive improvement (no threshold filtering)
    if (rawImprovement > 0) {
      // Clear large arrays to help GC
      rawValues.length = 0;
      currentActivations.length = 0;
      idealActivations.length = 0;
      neuronErrors.length = 0;

      return {
        neuronUuid,
        previousSquash: currentSquash,
        squash: bestSquash,
        expectedCreatureScoreGain: expectedCreatureScoreGain,
        improvedError: lowestError,
        currentError: baselineError,
      };
    }
  }

  // Clear large arrays to help GC
  rawValues.length = 0;
  currentActivations.length = 0;
  idealActivations.length = 0;
  neuronErrors.length = 0;

  return undefined;
}

/**
 * Analyses selected neurons to identify those with extremely high errors
 * that should be removed rather than having their activation function changed.
 */
export async function analyzeSelectedNeuronsForHarmfulRemoval(
  creature: Creature,
  focusList: number[],
  loadNeuronRecordsFn: (neuronIdentifier: string) => Promise<DiscoverRecord[]>,
  tempDir: string,
  loggingEnabled: boolean,
  logFn: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ) => void,
): Promise<CandidateHarmfulNeuron[] | undefined> {
  if (focusList.length === 0) return undefined;
  const idToWire = buildRuntimeIdToWireMap(creature);

  const MAX_REASONABLE_SQUASH_ERROR = 1e10;

  const candidatePromises = focusList.map(async (neuronId) => {
    try {
      const neuronUuid = idToWire.get(neuronId);
      assert(neuronUuid, `Missing wire uuid for neuron ${neuronId}`);
      const records = await loadNeuronRecordsFn(
        `${tempDir}/${neuronUuid}`,
      );
      if (!records || records.length === 0) return undefined;

      const rawValues: number[] = [];
      const currentActivations: number[] = [];
      const idealActivations: number[] = [];

      const neuron = creature.neurons.find((neuron) => neuron.id === neuronId);
      if (!neuron) return undefined;

      const currentSquash = neuron.squash;
      if (!currentSquash) return undefined;

      const currentSquashMethod = Activations.find(
        currentSquash,
      ) as ActivationInterface;
      if (!currentSquashMethod) return undefined;

      let activationSum = 0;
      let activationCount = 0;

      records.forEach((record) => {
        const value = record.value;
        if (value === undefined) return;
        rawValues.push(value);
        const activation = record.activation;
        if (activation === undefined) return;
        currentActivations.push(activation);

        if (Number.isFinite(activation)) {
          activationSum += activation;
          activationCount++;
        }

        const errors = record.errors;
        const finiteErrors = errors.filter(Number.isFinite);
        const avgError = finiteErrors.length
          ? finiteErrors.reduce((a, b) => a + b, 0) / finiteErrors.length
          : 0;

        const idealValue = value + avgError;
        const idealActivation = currentSquashMethod.squash(idealValue);
        idealActivations.push(idealActivation);
      });

      if (idealActivations.length === 0) return undefined;

      const averageActivation = activationCount > 0
        ? activationSum / activationCount
        : 0;

      const baselineActivationError = calculateSquashError(
        idealActivations,
        currentActivations,
      );

      if (baselineActivationError > MAX_REASONABLE_SQUASH_ERROR) {
        const neuronUuid = idToWire.get(neuronId);
        assert(neuronUuid, `Missing wire uuid for neuron ${neuronId}`);
        const errorLog = Math.log10(baselineActivationError);
        const thresholdLog = Math.log10(MAX_REASONABLE_SQUASH_ERROR);
        const excessMagnitude = errorLog - thresholdLog;
        const expectedCreatureScoreGain = Math.min(
          0.5,
          Math.max(0.1, 0.1 + (excessMagnitude / 10) * 0.4),
        );

        return {
          neuronUuid,
          errorMagnitude: baselineActivationError,
          expectedCreatureScoreGain: expectedCreatureScoreGain,
          sampleCount: records.length,
          averageActivation,
        };
      }

      return undefined;
    } catch (error) {
      if (loggingEnabled) {
        logFn(
          "error",
          `Error analyzing neuron ${neuronId} for harmful removal: ${error}`,
        );
      }
      return undefined;
    }
  });

  const results = await Promise.all(candidatePromises);
  const candidates = results.filter(
    (candidate) => candidate !== undefined,
  ) as CandidateHarmfulNeuron[];

  if (candidates.length === 0) return undefined;

  // Sort by error magnitude (highest first) and expected improvement
  candidates.sort((a, b) => {
    if (Math.abs(b.errorMagnitude - a.errorMagnitude) > 1e-6) {
      return b.errorMagnitude - a.errorMagnitude;
    }
    return b.expectedCreatureScoreGain - a.expectedCreatureScoreGain;
  });

  if (loggingEnabled && candidates.length > 0) {
    logFn(
      "info",
      `Found ${candidates.length} harmful neuron candidate(s) with extremely high errors`,
    );
    candidates.slice(0, 5).forEach((candidate) => {
      logFn(
        "info",
        `  - ${candidate.neuronUuid}: error=${
          candidate.errorMagnitude.toExponential(2)
        }, expected creature score gain=${
          (candidate.expectedCreatureScoreGain * 100).toFixed(1)
        }%`,
      );
    });
  }

  return candidates;
}
