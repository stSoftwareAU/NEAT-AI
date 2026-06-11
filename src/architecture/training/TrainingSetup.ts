/**
 * TrainingSetup.ts — Pre-training setup phase.
 *
 * Issue #2399: Responsible for dataset discovery, option resolution,
 * buffer pool allocation, and synthetic synapse injection — everything
 * that must happen once before the training loop begins.
 */

import { yellow } from "@std/fmt/colors";
import type { TrainOptions } from "@config/TrainOptions.ts";
import type { Creature } from "@creature";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { BufferPool } from "@utils/BufferPool.ts";
import {
  type BackPropagationArguments,
  createBackPropagationConfig,
} from "@propagate/BackPropagation.ts";
import { buildOutgoingSynapsesMap } from "@propagate/sparse/CalculatePathsToOutput.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { generateSyntheticSynapses } from "@propagate/SyntheticSynapses.ts";
import {
  DEFAULT_DATA_FUZZING_CONFIG,
  type RequiredDataFuzzingConfig,
} from "@config/DataFuzzingConfig.ts";
import {
  DEFAULT_DATA_QUANTISATION_CONFIG,
  type RequiredDataQuantisationConfig,
} from "@config/DataQuantisationConfig.ts";
import type {
  CreatureExport,
  CreatureTrace,
} from "@architecture/CreatureInterfaces.ts";

/**
 * Formats a fractional percentage value with colour highlighting.
 *
 * Exposed so the loop module can emit consistent progress messages.
 */
export function fp(percentage: number): string {
  if (Math.abs(1 - percentage) < Number.EPSILON) {
    return yellow("100%");
  }

  return yellow((percentage * 100).toFixed(1) + "%");
}

/**
 * Scans a data directory for binary training files.
 *
 * This function reads a directory and returns information about available
 * binary training files. It can optionally shuffle the file order for
 * randomised training or sort them for deterministic training.
 *
 * @param dataDir - Path to the directory containing training data
 * @param options - Training options including randomisation settings
 * @returns Object containing array of binary file paths
 */
export function dataFiles(
  dataDir: string,
  options: TrainOptions = {},
): { files: string[] } {
  const binaryFiles: string[] = [];

  for (const dirEntry of Deno.readDirSync(dataDir)) {
    if (dirEntry.isFile) {
      const fn = dirEntry.name;
      if (fn.endsWith(".bin")) {
        binaryFiles.push(`${dataDir}/${fn}`);
      }
    }
  }

  const files = binaryFiles;

  if (!options.disableRandomSamples) {
    const rng = getRandomNumberGenerator();
    for (let i = files.length; i--;) {
      const j = Math.round(rng.random() * i);
      [files[i], files[j]] = [files[j], files[i]];
    }
  } else {
    files.sort();
  }

  return {
    files: binaryFiles,
  };
}

/**
 * Resolves the per-iteration target error, clamping to a tiny positive
 * floor so downstream comparisons behave sensibly.
 */
export function resolveTargetError(options: TrainOptions): number {
  return options.targetError !== undefined &&
      Number.isFinite(options.targetError)
    ? Math.max(options.targetError, 0.000_000_1)
    : 0.05;
}

/**
 * Resolves the total iteration count, guaranteeing at least one pass.
 */
export function resolveIterations(options: TrainOptions): number {
  return Math.max(options.iterations ? options.iterations : 2, 1);
}

/**
 * Resolves the training sample rate, clamping into a safe (0, 1] range.
 */
export function resolveTrainingSampleRate(options: TrainOptions): number {
  return Math.min(1, Math.max(0.0001, options.trainingSampleRate ?? 1));
}

/**
 * Fully resolved state produced by the setup phase. The loop module
 * consumes this and never touches the raw options again for these fields.
 */
export interface TrainingSetupState {
  backPropConfig: ReturnType<typeof createBackPropagationConfig>;
  iterationConfig: BackPropagationArguments;
  feedbackLoop: boolean;
  targetError: number;
  iterations: number;
  trainingSampleRate: number;
  trainingTimeOutMinutes: number;
  /**
   * Absolute hard deadline (epoch ms) to clamp the relative timeout against.
   * Issue #2899: undefined/0 leaves the relative budget unchanged.
   */
  hardDeadlineTS: number | undefined;
  ID: string;
  BYTES_PER_RECORD: number;
  recordBuffer: Uint8Array;
  recordArray: Float32Array;
  bufferPool: BufferPool;
  observationsBuffer: Float32Array;
  targetsBuffer: Float32Array;
  fuzzingConfig: RequiredDataFuzzingConfig;
  quantisationConfig: RequiredDataQuantisationConfig;
  syntheticKeys: Set<string> | undefined;
  sparseConfig: SparseConfig;
  bestCreatureJSON: CreatureExport;
  bestTraceJSON: CreatureTrace;
  outgoingSynapsesMap: ReturnType<typeof buildOutgoingSynapsesMap>;
}

/**
 * Runs the pre-training setup phase: resolves options, allocates reusable
 * buffers, injects synthetic synapses when enabled, and builds the initial
 * sparse configuration.
 *
 * After this returns, the caller is ready to enter the training loop.
 */
export function prepareTraining(
  creature: Creature,
  options: TrainOptions,
  shortId: string,
): TrainingSetupState {
  const backPropConfig = createBackPropagationConfig(options);
  const feedbackLoop = options.feedbackLoop ?? false;
  const targetError = resolveTargetError(options);
  const iterations = resolveIterations(options);
  const trainingSampleRate = resolveTrainingSampleRate(options);
  const trainingTimeOutMinutes = options.trainingTimeOutMinutes ?? 0;
  // Issue #2899: carry the absolute hard deadline through to epoch state.
  const hardDeadlineTS = options.hardDeadlineTS;

  const valuesCount = creature.input + creature.output;
  const BYTES_PER_RECORD = valuesCount * 4; // Each float is 4 bytes

  // Reusable record buffer to avoid repeated allocations
  const recordBuffer = new Uint8Array(BYTES_PER_RECORD);
  const recordArray = new Float32Array(recordBuffer.buffer);

  // Issue #1297: Pre-allocated buffers for batch operations reused
  // throughout the training loop to avoid Float32Array allocations in
  // the hot path.
  const bufferPool = new BufferPool({ maxBuffersPerSize: 4 });
  const observationsBuffer = bufferPool.acquire(creature.input);
  const targetsBuffer = bufferPool.acquire(creature.output);

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

  // Issue #1923: Generate synthetic synapses before backpropagation.
  let syntheticKeys: Set<string> | undefined;
  if (options.syntheticSynapses) {
    const synResult = generateSyntheticSynapses(creature);
    syntheticKeys = synResult.syntheticKeys;
    // Invalidate WASM/state caches after structural change.
    creature.clearState();
  }

  const bestCreatureJSON = exportJSONWithRuntimeIds(creature);
  const bestTraceJSON = creature.traceJSON();

  // Issue #1294: Build outgoing synapse map once and cache it.
  const outgoingSynapsesMap = buildOutgoingSynapsesMap(bestCreatureJSON);
  const sparseConfig = new SparseConfig(
    bestCreatureJSON,
    backPropConfig,
    outgoingSynapsesMap,
  );

  // Issue #1540: Pre-allocate a mutable iteration config and update in
  // place each iteration, avoiding a frozen copy per iteration.
  const iterationConfig: BackPropagationArguments = { ...backPropConfig };

  // shortId is derived from the creature UUID by the orchestrator; we
  // expose it via setup state to keep the loop and teardown self-contained.
  void shortId;

  return {
    backPropConfig,
    iterationConfig,
    feedbackLoop,
    targetError,
    iterations,
    trainingSampleRate,
    trainingTimeOutMinutes,
    hardDeadlineTS,
    ID: shortId,
    BYTES_PER_RECORD,
    recordBuffer,
    recordArray,
    bufferPool,
    observationsBuffer,
    targetsBuffer,
    fuzzingConfig,
    quantisationConfig,
    syntheticKeys,
    sparseConfig,
    bestCreatureJSON,
    bestTraceJSON,
    outgoingSynapsesMap,
  };
}
