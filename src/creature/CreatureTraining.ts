/**
 * CreatureTraining.ts - Training orchestration, evolution, and scoring.
 *
 * Extracted from Creature.ts (Issue #1409) to keep the Creature class
 * under 500 lines and each module focused on a single responsibility.
 */

import { assert } from "@std/assert";
import { yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import { emptyDirSync } from "@std/fs";
import { getTag } from "@stsoftware/tags/mod";
import type { Creature } from "../Creature.ts";
import type { DataRecordInterface } from "../architecture/DataSet.ts";
import { makeDataDir } from "../architecture/DataSet.ts";
import type { DiscoverRecord } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { calculate as calculateScore } from "../architecture/Score.ts";
import { dataFiles } from "../architecture/Training.ts";
import { createNeatConfig } from "../config/NeatConfig.ts";
import type { NeatOptions } from "../config/NeatOptions.ts";
import { Costs } from "../Costs.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { Neat } from "../NEAT/Neat.ts";
import {
  type BackPropagationConfig,
  createBackPropagationConfig,
} from "../propagate/BackPropagation.ts";
import { BackpropBuffers } from "../propagate/BackpropBuffers.ts";
import { buildOutgoingSynapsesMap } from "../propagate/sparse/CalculatePathsToOutput.ts";
import { SparseConfig } from "../propagate/sparse/SparseConfig.ts";
import { BufferPool } from "../utils/BufferPool.ts";
import {
  type DiscoveryDirResult,
  DiscoveryRunner,
  type DiscoveryRunnerLike,
} from "../discovery/DiscoveryRunner.ts";
import {
  type DiscoveryReplayDirResult,
  DiscoveryReplayRunner,
  type DiscoveryReplayRunnerLike,
} from "../discovery/DiscoveryReplayRunner.ts";
import { getLogger } from "../utils/Logger.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";

/**
 * Propagate expected values backward through the network for all output neurons.
 */
export function propagate(
  creature: Creature,
  expected: Float32Array,
  config: BackPropagationConfig,
  sparseConfig: SparseConfig,
): void {
  creature.state.cacheAdjustedActivation.clear();

  // Issue #1379: Lazily initialise reusable backward pass buffers.
  if (creature.state.backpropBuffers === undefined) {
    creature.state.backpropBuffers = new BackpropBuffers();
  }

  const neurons = creature.neurons;
  const lastOutputIndx = neurons.length - creature.output;

  for (let indx = creature.output; indx--;) {
    const nodeIndex = lastOutputIndx + indx;
    const n = neurons[nodeIndex];

    if (sparseConfig.propagateNeeded(n.uuid)) {
      n.propagate(expected[indx], config, sparseConfig);
    }
  }
}

/**
 * Record expected values for discovery (error-guided structural evolution).
 */
export function record(
  creature: Creature,
  expected: Float32Array,
): Map<string, DiscoverRecord> {
  const neurons = creature.neurons;
  const lastOutputIndx = neurons.length - creature.output;

  const errorMap = new Map<string, DiscoverRecord>();
  for (let indx = creature.output; indx--;) {
    const nodeIndex = lastOutputIndx + indx;
    const n = neurons[nodeIndex];
    n.record(expected[indx], errorMap);
  }

  // DIAGNOSTIC: Check for excessive total error count per sample
  let totalErrors = 0;
  for (const rec of errorMap.values()) {
    totalErrors += rec.errors.length;
  }

  const expectedMax = neurons.length * creature.output * 3;
  if (totalErrors > expectedMax) {
    getLogger().error(
      `❌ CRITICAL: Sample generated ${totalErrors} total errors (expected ≤${expectedMax})`,
    );
    getLogger().error(
      `   Neurons: ${neurons.length}, Outputs: ${creature.output}, ErrorMap size: ${errorMap.size}`,
    );
    const sorted = Array.from(errorMap.entries())
      .sort((a, b) => b[1].errors.length - a[1].errors.length)
      .slice(0, 5);
    getLogger().error(`   Top 5 neurons by error count:`);
    sorted.forEach(([uuid, rec]) => {
      getLogger().error(`     - ${uuid}: ${rec.errors.length} errors`);
    });

    if (totalErrors > expectedMax * 10) {
      throw new Error(
        `Excessive errors detected: ${totalErrors} total errors in single sample ` +
          `(expected ≤${expectedMax}). This indicates record() is being called too many times, ` +
          `causing the performance issue and timeout.`,
      );
    }
  }

  return errorMap;
}

/**
 * Update propagated gradients in neurons. Invalidates WASM if weights changed.
 */
export function propagateUpdate(
  creature: Creature,
  config: BackPropagationConfig,
  sparseConfig: SparseConfig,
): void {
  let didUpdate = false;
  for (let indx = creature.input; indx < creature.neurons.length; indx++) {
    const n = creature.neurons[indx];
    if (sparseConfig.updateNeeded(n.uuid)) {
      n.propagateUpdate(config);
      didUpdate = true;
    }
  }
  creature.state.preparedNeurons = false;

  if (didUpdate && creature.cachedWasmActivation) {
    creature.cachedWasmActivation.free();
    creature.cachedWasmActivation = undefined;
  }
}

/**
 * Apply learned weight/bias changes from backpropagation.
 */
export function applyLearnings(
  creature: Creature,
  config: BackPropagationConfig,
  sparseConfig: SparseConfig,
): boolean {
  propagateUpdate(creature, config, sparseConfig);

  let changed = false;
  for (
    let indx = creature.neurons.length - 1;
    indx >= creature.input;
    indx--
  ) {
    if (config.trainingMutationRate > getRandomNumberGenerator().random()) {
      const n = creature.neurons[indx];
      if (sparseConfig.updateNeeded(n.uuid)) {
        changed ||= n.applyLearnings();
      }
    }
  }

  if (changed) {
    delete creature.uuid;
    delete creature.memetic;
    creature.state.preparedNeurons = false;
    creature.fix();
  }

  return changed;
}

/**
 * Trace and propagate on a dataset directory.
 * Returns score and error.
 */
export function traceDir(
  creature: Creature,
  dataDir: string,
  options: NeatOptions,
): { score: number; error: number } {
  const dataResult = dataFiles(dataDir);
  assert(dataResult.files.length > 0, "No data files found");
  const config = createNeatConfig(options);
  const cost = Costs.find(config.costName);
  let error = 0;
  let count = 0;
  const backPropConfig = createBackPropagationConfig(config);
  const creatureJSON = creature.exportJSON();
  const outgoingSynapsesMap = buildOutgoingSynapsesMap(creatureJSON);
  const sparseConfig = new SparseConfig(
    creatureJSON,
    backPropConfig,
    outgoingSynapsesMap,
  );

  const valuesCount = creature.input + creature.output;
  const BYTES_PER_RECORD = valuesCount * 4;
  const NVME_OPTIMAL_READ_SIZE = 512 * 1024;
  const BATCH_SIZE = Math.max(
    1,
    Math.floor(NVME_OPTIMAL_READ_SIZE / BYTES_PER_RECORD),
  );
  const BYTES_PER_BATCH = BYTES_PER_RECORD * BATCH_SIZE;

  const batchBuffer = new Uint8Array(BYTES_PER_BATCH);
  const batchArray = new Float32Array(batchBuffer.buffer);

  const bufferPool = new BufferPool({ maxBuffersPerSize: 4 });
  const observationsBuffer = bufferPool.acquire(creature.input);
  const targetsBuffer = bufferPool.acquire(creature.output);

  for (let fileIndx = dataResult.files.length; fileIndx--;) {
    const filePath = dataResult.files[fileIndx];
    const file = Deno.openSync(filePath, { read: true });

    try {
      while (true) {
        const bytesRead = file.readSync(batchBuffer);
        if (bytesRead === null) break;
        assert(bytesRead > 0, "Invalid number of bytes read");

        const recordsRead = Math.floor(bytesRead / BYTES_PER_RECORD);
        assert(
          bytesRead % BYTES_PER_RECORD === 0,
          "Invalid number of bytes read",
        );

        for (let recordIndex = 0; recordIndex < recordsRead; recordIndex++) {
          const offset = recordIndex * valuesCount;
          const inputEnd = offset + creature.input;

          observationsBuffer.set(batchArray.subarray(offset, inputEnd));
          targetsBuffer.set(
            batchArray.subarray(inputEnd, offset + valuesCount),
          );

          const actuals = creature.activateAndTrace(
            observationsBuffer,
            true,
            sparseConfig,
          );

          propagate(creature, targetsBuffer, backPropConfig, sparseConfig);

          error += cost.calculate(targetsBuffer, actuals);
          count++;
        }
      }
    } finally {
      file.close();
    }
  }

  let averageError = 0;
  if (count > 0) {
    averageError = error / count;
  }
  creature.score = calculateScore(
    creature,
    averageError,
    config.costOfGrowth,
  );

  return { error: averageError, score: creature.score };
}

/** Write creatures to a directory for checkpointing. */
function writeCreatures(neat: Neat, dir: string): void {
  let counter = 1;
  emptyDirSync(dir);
  neat.population.forEach((c) => {
    const json = c.exportJSON();
    const txt = JSON.stringify(json, null, 1);
    const filePath = dir + "/" + counter + ".json";
    Deno.writeTextFileSync(filePath, txt);
    counter++;
  });
}

/**
 * Evolve the creature on a dataset directory using NEAT.
 * Supports multi-threaded workers, checkpointing, and timeout.
 */
export async function evolveDir(
  creature: Creature,
  dataSetDir: string,
  options: NeatOptions,
): Promise<
  { error: number; score: number; time: number; generation: number }
> {
  let interrupted = false;
  const signalListener = () => {
    getLogger().info("SIGTERM received, saving progress...");
    interrupted = true;
  };

  Deno.addSignalListener("SIGTERM", signalListener);

  const start = Date.now();
  const config = createNeatConfig(options);

  const endTimeMS = config.timeoutMinutes
    ? start + Math.max(1, config.timeoutMinutes) * 60000
    : 0;

  const workers: WorkerHandler[] = [];
  const threads = config.threads;

  for (let i = threads; i--;) {
    const preferDirect = threads === 1;
    let w = new WorkerHandler(
      dataSetDir,
      config.costName,
      preferDirect,
      config.customCost,
    );
    try {
      // deno-lint-ignore no-await-in-loop
      await w.waitUntilReady();
    } catch (err) {
      try {
        w.terminate();
      } catch {
        // Ignore termination errors.
      }
      if (!preferDirect) {
        getLogger().warn(
          "[Creature.evolveDir] Worker init failed; falling back to direct execution for this worker slot.",
          err,
        );
        w = new WorkerHandler(
          dataSetDir,
          config.costName,
          true,
          config.customCost,
        );
        // deno-lint-ignore no-await-in-loop
        await w.waitUntilReady();
      } else {
        throw err;
      }
    }
    workers.push(w);
  }

  const neat = new Neat(
    creature.input,
    creature.output,
    config,
    workers,
  );

  neat.setDataDir(dataSetDir);
  neat.populatePopulation(creature);

  let error = Infinity;
  let bestScore = -Infinity;

  // Dynamic import to avoid circular dependency at module load time.
  const { Creature: CreatureClass } = await import("../Creature.ts");
  let bestCreature: InstanceType<typeof CreatureClass> | undefined;

  let iterationStartMS = Date.now();
  let generation = 0;
  const targetError = config.targetError;
  const iterations = config.iterations;

  while (true) {
    // deno-lint-ignore no-await-in-loop
    const result = await neat.evolve(bestCreature);

    const fittest = result.fittest;
    const fittestScore = fittest.score!;
    assert(fittestScore >= bestScore, "Score is less than best score");
    if (fittestScore > bestScore) {
      const errorTmp = getTag(fittest, "error");
      assert(errorTmp, "No error tag found");

      error = Number.parseFloat(errorTmp);
      assert(Number.isFinite(error), "Error is not finite");
      assert(error >= 0, "Error is negative");
      assert(
        fittestScore - 1 <= error * -1,
        `Score (absolute) less than error (score=${fittestScore}, error=${error})`,
      );
      bestScore = fittestScore;
      bestCreature = CreatureClass.fromJSON(fittest.exportJSON());
      bestCreature.uuid = fittest.uuid;
      bestCreature.score = bestScore;
    }

    const now = Date.now();
    const timedOut = endTimeMS ? now > endTimeMS : false;

    generation++;

    const completed = interrupted || timedOut || error <= targetError ||
      generation >= iterations;

    if (
      config.log &&
      (generation % config.log === 0 || completed)
    ) {
      let avgTxt = "";
      if (Number.isFinite(result.averageScore)) {
        avgTxt = `(avg: ${yellow(result.averageScore.toFixed(4))})`;
      }
      getLogger().info(
        "Generation",
        generation,
        "score",
        fittest.score,
        avgTxt,
        "error",
        error,
        (config.log > 1 ? "avg " : "") + "time",
        yellow(
          format(Math.round((now - iterationStartMS) / config.log), {
            ignoreZero: true,
          }),
        ),
      );

      iterationStartMS = now;
    }

    if (completed) {
      if (interrupted) break;
      if (neat.finishUp(iterations, endTimeMS, start, generation)) {
        break;
      }
    }

    if (
      config.checkpointEveryGeneration && config.creatureStore
    ) {
      writeCreatures(neat, config.creatureStore);
    }
  }

  for (let i = workers.length; i--;) {
    const w = workers[i];
    w.terminate();
  }
  workers.length = 0;

  if (bestCreature) {
    creature.loadFrom(bestCreature, config.debug);
  }

  if (config.creatureStore) {
    writeCreatures(neat, config.creatureStore);
  }

  Deno.removeSignalListener("SIGTERM", signalListener);
  return {
    error: error,
    score: bestScore,
    generation: generation,
    time: Date.now() - start,
  };
}

/**
 * Evolve the creature on an in-memory dataset.
 * Creates a temporary directory then calls evolveDir().
 */
export async function evolveDataSet(
  creature: Creature,
  dataSet: DataRecordInterface[],
  options: NeatOptions,
): Promise<{ error: number; score: number; time: number }> {
  const config = createNeatConfig(options);

  const dataSetDir = makeDataDir(dataSet, config.dataSetPartitionBreak, {
    input: creature.input,
    output: creature.output,
  });

  const result = await evolveDir(creature, dataSetDir, config);

  // deno-lint-ignore no-sync-fn-in-async-fn -- Cleanup of temporary directory after async evolution.
  Deno.removeSync(dataSetDir, { recursive: true });

  return result;
}

/**
 * Score the creature using a dataset directory.
 */
export async function scoreDir(
  creature: Creature,
  dataDir: string,
  options: NeatOptions,
): Promise<{ score: number; error: number }> {
  const config = createNeatConfig(options);

  const result = await creature.evaluateDir(
    dataDir,
    Costs.find(config.costName),
    config.feedbackLoop,
  );

  creature.score = calculateScore(
    creature,
    result.error,
    config.costOfGrowth,
  );
  return { error: result.error, score: creature.score };
}

/**
 * Run the discovery process for this creature using a dataset directory.
 */
export async function discoveryDir(
  creature: Creature,
  dataDir: string,
  options: NeatOptions,
  deps?: { runner?: DiscoveryRunnerLike },
): Promise<DiscoveryDirResult> {
  const runner = deps?.runner ?? new DiscoveryRunner();
  return await runner.discoverDir({
    creature,
    dataDir,
    options,
  });
}

/**
 * Replay cached discovery successes against this creature.
 */
export async function discoveryReplayDir(
  creature: Creature,
  dataDir: string,
  options: NeatOptions,
  deps?: { runner?: DiscoveryReplayRunnerLike },
): Promise<DiscoveryReplayDirResult> {
  const runner = deps?.runner ?? new DiscoveryReplayRunner();
  return await runner.replayDir({
    creature,
    dataDir,
    options,
  });
}
