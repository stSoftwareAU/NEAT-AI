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
import type { Creature } from "@creature";
import { CURRENT_CREATURE_SEMANTIC_VERSION } from "@creature";
import {
  assertValidWriteableSemanticVersion,
  isValidWriteableSemanticVersion,
} from "@upgrade/SemanticVersionValidation.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DiscoverRecord } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { calculate as calculateScore } from "@architecture/Score.ts";
import { dataFiles } from "@architecture/Training.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Costs } from "@costs";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { Neat } from "@neat/Neat.ts";
import {
  type BackPropagationConfig,
  createBackPropagationConfig,
} from "@propagate/BackPropagation.ts";
import { propagateTopological } from "@propagate/TopologicalBackpropagation.ts";
import {
  applyMuonGradientOrthogonalisation,
  applyMuonOrthogonalisationToDeltas,
  snapshotWeights,
} from "@propagate/MuonGradientHook.ts";
import { buildOutgoingSynapsesMap } from "@propagate/sparse/CalculatePathsToOutput.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { BufferPool } from "@utils/BufferPool.ts";
import {
  type DiscoveryDirResult,
  DiscoveryRunner,
  type DiscoveryRunnerLike,
} from "@discovery/DiscoveryRunner.ts";
import {
  type DiscoveryReplayDirResult,
  DiscoveryReplayRunner,
  type DiscoveryReplayRunnerLike,
} from "@discovery/DiscoveryReplayRunner.ts";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { setMaxCachedWasmCreatureActivations } from "@wasm/WasmCreatureActivationLRU.ts";
import { setWasmCompilationCacheSize } from "@wasm/WasmCompilationCache.ts";
import { emitTrainingEvent } from "@neat/TrainingEventEmitter.ts";
import {
  defaultRewardToError,
  type EpisodeTrialsEvent,
  type EpisodicOptions,
  type LegacyEpisodeAdapter,
} from "@creature/EpisodicFitnessTypes.ts";
import type { Fitness } from "@architecture/Fitness.ts";
import type { EpisodeAdapter } from "@creature/EpisodeAdapter.ts";
import { buildRLSeedSet } from "@creature/EvolveRLSeedSet.ts";
import {
  type EvolveRLMilestone,
  isMilestoneGeneration,
} from "@creature/EvolveRLStatistics.ts";

/**
 * Propagate expected values backward through the network for all output neurons.
 *
 * Issue #1641: Uses iterative topological ordering instead of recursive
 * traversal. Each neuron is visited exactly once, eliminating the
 * combinatorial explosion of revisits in densely connected networks.
 */
export function propagate(
  creature: Creature,
  expected: Float32Array,
  config: BackPropagationConfig,
  sparseConfig: SparseConfig,
): void {
  propagateTopological(creature, expected, config, sparseConfig);
  // Issue #2529: optional Muon-style orthogonalised gradient updates.
  // No-op for the default `gradientOrthogonalisation = "none"` setting.
  applyMuonGradientOrthogonalisation(creature, config);
}

/**
 * Record expected values for discovery (error-guided structural evolution).
 */
export function record(
  creature: Creature,
  expected: Float32Array,
): Map<number, DiscoverRecord> {
  const neurons = creature.neurons;
  const lastOutputIndx = neurons.length - creature.output;

  const errorMap = new Map<number, DiscoverRecord>();
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
      throw new TopologyError(
        `Excessive errors detected: ${totalErrors} total errors in single sample ` +
          `(expected ≤${expectedMax}). This indicates record() is being called too many times, ` +
          `causing the performance issue and timeout.`,
        "EXCESSIVE_ERRORS",
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
  // Issue #2529: Capture pre-update weights so the optional Muon hook
  // below can compute the per-neuron delta the standard step applied
  // and orthogonalise it. The snapshot is only taken when Muon mode
  // is enabled; the default ("none") path remains zero-cost.
  const muonSnapshot = config.gradientOrthogonalisation === "muon"
    ? snapshotWeights(creature)
    : undefined;

  let didUpdate = false;
  for (let indx = creature.input; indx < creature.neurons.length; indx++) {
    const n = creature.neurons[indx];
    if (sparseConfig.updateNeeded(n.id)) {
      n.propagateUpdate(config);
      didUpdate = true;
    }
  }

  // Issue #2529: Optional Muon-style orthogonalised gradient updates,
  // applied to the (post-update − snapshot) delta per topological layer.
  // No-op for the default `gradientOrthogonalisation = "none"` setting.
  if (muonSnapshot !== undefined) {
    applyMuonOrthogonalisationToDeltas(creature, muonSnapshot, config);
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
      if (sparseConfig.updateNeeded(n.id)) {
        changed ||= n.applyLearnings();
      }
    }
  }

  if (changed) {
    delete creature.uuid;
    delete creature.memetic;
    creature.state.preparedNeurons = false;
    // Issue #2302: Respect the creature's forward-only flag so self-connections
    // (if present from legacy data) are removed during training repair.
    creature.fix(
      creature.forwardOnly === true ? { forwardOnly: true } : undefined,
    );
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
  const creatureJSON = exportJSONWithRuntimeIds(creature);
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

/**
 * Write creatures to a directory for checkpointing.
 *
 * Issue #2275: Converted to async I/O with compact JSON serialisation.
 * Benchmarks showed 32-54% improvement over the previous synchronous
 * approach (which used pretty-printed JSON.stringify(..., null, 1) +
 * Deno.writeTextFileSync per creature). Compact JSON (no indentation)
 * is 2.4x faster to serialise, and async file writes with Promise.all
 * unblock the event loop during checkpoint writes.
 */
async function writeCreatures(neat: Neat, dir: string): Promise<void> {
  emptyDirSync(dir);
  const writes: Promise<void>[] = [];
  let counter = 1;
  for (const c of neat.population) {
    // Issue #2349: never write a creature without a valid semanticVersion.
    // If a creature somehow lost its version (empty, undefined, or pre-2.x),
    // heal it to the current default rather than writing an invalid value
    // that aborts downstream tools (GRQ worker).
    if (!isValidWriteableSemanticVersion(c.semanticVersion)) {
      c.semanticVersion = CURRENT_CREATURE_SEMANTIC_VERSION;
    }
    const json = c.exportJSON();
    assertValidWriteableSemanticVersion(json.semanticVersion);
    const txt = JSON.stringify(json);
    const filePath = dir + "/" + counter + ".json";
    writes.push(Deno.writeTextFile(filePath, txt));
    counter++;
  }
  await Promise.all(writes);
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

  // Issue #1566: Apply WASM cache caps from config before training starts.
  setMaxCachedWasmCreatureActivations(config.wasmCache.maxCachedActivations);
  setWasmCompilationCacheSize(config.wasmCache.compilationCacheSize);

  const endTimeMS = config.timeoutMinutes
    ? start + Math.max(1, config.timeoutMinutes) * 60000
    : 0;

  const workers: WorkerHandler[] = [];
  const threads = config.threads;

  for (let i = threads; i--;) {
    const preferDirect = threads === 1;
    // Issue #1567: Propagate WASM cache limits to worker threads.
    // Issue #1620: Propagate output range constraints to worker threads.
    const outputRanges = config.outputRanges.length > 0
      ? config.outputRanges
      : undefined;
    let w = new WorkerHandler(
      dataSetDir,
      config.costName,
      preferDirect,
      config.customCost,
      config.wasmCache,
      outputRanges,
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
          config.wasmCache,
          outputRanges,
        );
        // deno-lint-ignore no-await-in-loop
        await w.waitUntilReady();
      } else {
        throw err;
      }
    }
    workers.push(w);
  }

  // Issue #2243: Partition workers into fast (evaluation) and heavy
  // (discovery/training) pools using the configured heavyTaskWorkerCount.
  const fastWorkers = workers.length > config.heavyTaskWorkerCount
    ? workers.slice(0, workers.length - config.heavyTaskWorkerCount)
    : undefined;

  const neat = new Neat(
    creature.input,
    creature.output,
    config,
    workers,
    fastWorkers,
  );

  neat.setDataDir(dataSetDir);
  await neat.populatePopulation(creature);

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
      const tolerance = 1e-10;
      assert(
        fittestScore - 1 <= -error + tolerance,
        `Score (absolute) less than error (score=${fittestScore}, error=${error})`,
      );
      bestScore = fittestScore;
      // Issue #2276: Use shallowClone() instead of exportJSONWithRuntimeIds +
      // fromJSON round-trip. shallowClone() is 2.4–3.5x faster (Issue #1586)
      // and preserves all necessary state including runtime IDs and UUIDs.
      bestCreature = fittest.shallowClone() as InstanceType<
        typeof CreatureClass
      >;
      bestCreature.score = bestScore;
    }

    const now = Date.now();
    const timedOut = endTimeMS ? now > endTimeMS : false;

    generation++;

    // Issue #2251: Time checkpoint write so it flows through onTrainingEvent
    // Issue #2275: Async checkpoint writes unblock the event loop
    let phaseTiming = result.phaseTiming;
    if (config.checkpointEveryGeneration && config.creatureStore) {
      const checkpointStart = Date.now();
      // deno-lint-ignore no-await-in-loop
      await writeCreatures(neat, config.creatureStore);
      phaseTiming = {
        ...result.phaseTiming,
        checkpointWriteMs: Date.now() - checkpointStart,
      };
    }

    // Issue #1615: Emit generation_complete event
    // Issue #2239: Include per-phase timing diagnostics from evolve()
    // Issue #2330: Forward compact throughput counters (wall-clock, queue
    // depths, approximate worker wait) on the same event.
    const generationElapsedMs = now -
      (generation === 1 ? start : iterationStartMS);
    emitTrainingEvent(config.onTrainingEvent, {
      kind: "generation_complete",
      timestamp: new Date().toISOString(),
      generation,
      bestFitness: fittestScore,
      averageFitness: result.averageScore,
      populationSize: neat.population.length,
      elapsedMs: generationElapsedMs,
      phaseTiming,
      throughput: result.throughput,
    });

    // Issue #1615: Emit plateau_detected event when on plateau
    if (result.plateau.onPlateau) {
      emitTrainingEvent(config.onTrainingEvent, {
        kind: "plateau_detected",
        timestamp: new Date().toISOString(),
        generation,
        stagnationCount: result.plateau.generationsOnPlateau,
        plateauThreshold: config.plateauDetection.windowSize,
        improvementRate: result.plateau.improvementRate,
        mutationMultiplier: result.plateau.mutationMultiplier,
      });
    }

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

      // Issue #2240: Lightweight wait for in-flight tasks instead of running
      // full evolve() cycles. This avoids wasting worker resources on fitness
      // evaluation, breeding, and mutation while simply waiting for discovery
      // or training to finish.
      // deno-lint-ignore no-await-in-loop
      await neat.awaitInFlightTasks();
    }
  }

  for (let i = workers.length; i--;) {
    const w = workers[i];
    w.terminate();
  }
  workers.length = 0;

  // Issue #1509: Await background replay queue completion before returning.
  // Without this, callers that delete the data directory after evolveDir()
  // returns may cause NotFound errors in still-running replay workers.
  await neat.discoveryReplayQueue.waitForCompletion();

  if (bestCreature) {
    creature.loadFrom(bestCreature, config.debug, "training:restoreBest");
  }

  if (config.creatureStore) {
    await writeCreatures(neat, config.creatureStore);
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
 * Evolve the creature against a streaming-observation simulator using an
 * {@link LegacyEpisodeAdapter} (Issue #2611).
 *
 * Reuses the same outer shape as {@link evolveDir}: a single `Neat` instance
 * drives population management, mutation, crossover, elitism, plateau
 * detection, and lifecycle events. The only difference is the scorer — the
 * worker-based dataset {@link Fitness} is swapped for an
 * {@link EpisodicFitness} that runs episode rollouts inline.
 *
 * Stop conditions (`targetError`, `timeoutMinutes`, `iterations`, SIGTERM) and
 * lifecycle events (`generation_complete`, `plateau_detected`) match
 * `evolveDir()` so existing consumers do not need a new event handler.
 * Cumulative episode reward is mapped to the non-negative `error` slot via
 * {@link EpisodicOptions.rewardToError} (default `error = max(0, -reward)`),
 * so `targetError` semantics are preserved.
 *
 * Multi-threaded worker rollouts are deliberately deferred to a follow-up so
 * this PR stays reviewable; today every episode runs on the main thread.
 */
export async function evolveEnv<S, A>(
  creature: Creature,
  adapter: LegacyEpisodeAdapter<S, A>,
  options: NeatOptions & EpisodicOptions,
): Promise<
  { error: number; score: number; time: number; generation: number }
> {
  if (creature.input !== adapter.inputCount) {
    throw new Error(
      `Creature input ${creature.input} does not match adapter inputCount ` +
        `${adapter.inputCount}`,
    );
  }
  if (creature.output !== adapter.outputCount) {
    throw new Error(
      `Creature output ${creature.output} does not match adapter outputCount ` +
        `${adapter.outputCount}`,
    );
  }
  if (adapter.maxSteps <= 0 || !Number.isFinite(adapter.maxSteps)) {
    throw new Error(
      `Adapter.maxSteps must be a positive finite integer, got ${adapter.maxSteps}`,
    );
  }

  let interrupted = false;
  const signalListener = () => {
    getLogger().info("SIGTERM received, stopping evolveEnv...");
    interrupted = true;
  };
  Deno.addSignalListener("SIGTERM", signalListener);

  // Support AbortSignal for external interruption (e.g. in tests).
  // Prefer this over Deno.kill(Deno.pid, "SIGTERM") from worker threads,
  // which propagates to the main process and can abort parallel test runners.
  const abortListener = () => {
    getLogger().info("AbortSignal received, stopping evolveEnv...");
    interrupted = true;
  };
  options.signal?.addEventListener("abort", abortListener);

  const start = Date.now();
  const config = createNeatConfig(options);

  setMaxCachedWasmCreatureActivations(config.wasmCache.maxCachedActivations);
  setWasmCompilationCacheSize(config.wasmCache.compilationCacheSize);

  const endTimeMS = config.timeoutMinutes
    ? start + Math.max(1, config.timeoutMinutes) * 60000
    : 0;

  const trialsPerScore = options.trialsPerScore !== undefined
    ? Math.max(1, Math.floor(options.trialsPerScore))
    : 1;
  const initialPerturbation = options.initialPerturbation !== undefined
    ? Math.max(0, options.initialPerturbation)
    : 0;
  const baseSeed = options.seed !== undefined && options.seed !== null
    ? Math.max(0, Math.floor(options.seed))
    : 0;
  const rewardToError = options.rewardToError ?? defaultRewardToError;

  // Lazy import avoids adding EpisodicFitness → Fitness to the static module
  // graph, which would create a circular initialisation ordering problem
  // (Neat.ts → Creature.ts → CreatureTraining.ts → EpisodicFitness.ts → Fitness.ts
  // while Neat.ts also imports Fitness.ts directly).
  const { EpisodicFitness } = await import("@creature/EpisodicFitness.ts");
  const episodicFitness = new EpisodicFitness({
    adapter,
    growth: config.costOfGrowth,
    trialsPerScore,
    initialPerturbation,
    baseSeed,
    rewardToError,
    onEpisodeTrials: options.onEpisodeTrials,
  });

  // Empty worker pool: scoring runs inline. Discovery/training scheduling
  // becomes a no-op (the schedulers warn and bail when no workers are
  // available); breeding falls back to the main-thread path.
  const neat = new Neat(creature.input, creature.output, config, []);
  // Swap in the episodic scorer. The `fitness` property is `readonly` at the
  // type level for ergonomics, but this is the documented seam for
  // alternative scoring strategies.
  (neat as unknown as { fitness: Fitness }).fitness = episodicFitness;

  await neat.populatePopulation(creature);

  let error = Infinity;
  let bestScore = -Infinity;

  const { Creature: CreatureClass } = await import("../Creature.ts");
  let bestCreature: InstanceType<typeof CreatureClass> | undefined;

  let iterationStartMS = Date.now();
  let generation = 0;
  const targetError = config.targetError;
  const iterations = config.iterations;

  while (true) {
    generation++;
    episodicFitness.setGeneration(generation);

    // deno-lint-ignore no-await-in-loop
    const result = await neat.evolve(bestCreature);

    const fittest = result.fittest;
    const fittestScore = fittest.score!;
    assert(fittestScore >= bestScore, "Score is less than best score");
    if (fittestScore > bestScore) {
      const errorTmp = getTag(fittest, "error");
      assert(errorTmp, "No error tag found");

      const parsedError = errorTmp === "Infinity"
        ? Number.POSITIVE_INFINITY
        : Number.parseFloat(errorTmp);
      assert(Number.isFinite(parsedError), "Error is not finite");
      assert(parsedError >= 0, "Error is negative");
      error = parsedError;
      bestScore = fittestScore;
      bestCreature = fittest.shallowClone() as InstanceType<
        typeof CreatureClass
      >;
      bestCreature.score = bestScore;
    }

    const now = Date.now();
    const timedOut = endTimeMS ? now > endTimeMS : false;

    let phaseTiming = result.phaseTiming;
    if (config.checkpointEveryGeneration && config.creatureStore) {
      const checkpointStart = Date.now();
      // deno-lint-ignore no-await-in-loop
      await writeCreatures(neat, config.creatureStore);
      phaseTiming = {
        ...result.phaseTiming,
        checkpointWriteMs: Date.now() - checkpointStart,
      };
    }

    const generationElapsedMs = now -
      (generation === 1 ? start : iterationStartMS);
    emitTrainingEvent(config.onTrainingEvent, {
      kind: "generation_complete",
      timestamp: new Date().toISOString(),
      generation,
      bestFitness: fittestScore,
      averageFitness: result.averageScore,
      populationSize: neat.population.length,
      elapsedMs: generationElapsedMs,
      phaseTiming,
      throughput: result.throughput,
    });

    if (result.plateau.onPlateau) {
      emitTrainingEvent(config.onTrainingEvent, {
        kind: "plateau_detected",
        timestamp: new Date().toISOString(),
        generation,
        stagnationCount: result.plateau.generationsOnPlateau,
        plateauThreshold: config.plateauDetection.windowSize,
        improvementRate: result.plateau.improvementRate,
        mutationMultiplier: result.plateau.mutationMultiplier,
      });
    }

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
      // deno-lint-ignore no-await-in-loop
      await neat.awaitInFlightTasks();
    }
  }

  // No worker pool to terminate — episode rollouts ran inline. Replay queue
  // never had a chance to schedule anything (no dataDir was provided), but
  // await it for symmetry with evolveDir() in case a future change wires one
  // through.
  await neat.discoveryReplayQueue.waitForCompletion();

  if (bestCreature) {
    creature.loadFrom(bestCreature, config.debug, "evolveEnv:restoreBest");
  }

  if (config.creatureStore) {
    await writeCreatures(neat, config.creatureStore);
  }

  Deno.removeSignalListener("SIGTERM", signalListener);
  options.signal?.removeEventListener("abort", abortListener);
  return {
    error,
    score: bestScore,
    generation,
    time: Date.now() - start,
  };
}

/**
 * Caller-tunable options for {@link evolveRL} (Issue #2628).
 *
 * Layered on top of {@link NeatOptions} so the same evolutionary stop
 * conditions and lifecycle events used by `evolveDir()` apply here too.
 */
export interface EvolveRLOptions extends NeatOptions {
  /**
   * Number of episodes per creature per generation; per-creature fitness is
   * the mean return across these episodes. Default: `3`.
   */
  episodesPerCreature?: number;
  /**
   * Base seed mixed into the per-generation seed set. When omitted, a
   * time-based default is used so the seed set still rotates between
   * generations and across runs. Pin this when you need reproducibility.
   */
  seed?: number;
  /**
   * When `true`, every generation uses `seedSet(0)` instead of rotating with
   * the generation counter. Tests / regression only — real evolution should
   * keep this `false` so creatures cannot over-fit one map. Default: `false`.
   */
  fixedSeedSet?: boolean;
  /**
   * Issue #2629: when `true`, `evolveRL()` collects a per-milestone payload
   * (best-creature score / topology, mean episode steps, generation
   * wall-clock) at generations `1, 2, 5, 10, 20, 50, 100, 200, 500, 1000`
   * and beyond at powers of ten. Each payload is emitted on
   * `onTrainingEvent` as an `evolverl_milestone` event and the full sequence
   * is returned as `milestones` on the run summary. Default `false` keeps
   * the collection cost (best-creature topology snapshot, per-episode step
   * counts) off the hot path.
   */
  statistics?: boolean;
  /**
   * Optional callback fired once per scored creature per generation with the
   * per-trial reward breakdown so callers can chart variance. Mirrors the
   * `evolveEnv` hook of the same name.
   */
  onEpisodeTrials?: (event: EpisodeTrialsEvent) => void;
  /**
   * Optional {@link AbortSignal} that allows the caller to interrupt the
   * evolution run externally without sending an OS signal. Mirrors the
   * `evolveEnv` hook of the same name.
   */
  signal?: AbortSignal;
  /**
   * Issue #2612: Adapter description used to spin up the parallel
   * episode-rollout pool. When omitted, every rollout runs inline on the
   * main thread regardless of `config.threads` — the worker pool needs an
   * importable URL since adapter instances themselves cannot cross the
   * worker boundary (they may close over functions, sockets, etc.).
   *
   * When supplied alongside `threads > 1`, every creature is dispatched to
   * a worker pool of size `threads`. The main-thread `adapter` argument
   * passed to `Creature.evolveRL()` is still used for type checking and
   * graceful fallback, so authors should make sure both produce identical
   * trajectories given the same seed.
   */
  adapterDescription?:
    import("@creature/EpisodeWorkerProtocol.ts").AdapterDescription;
}

/**
 * Evolve the creature against a streaming-observation simulator using the
 * class-shaped {@link EpisodeAdapter} contract from Issue #2626 and the
 * library-owned {@link runEpisode} runner from Issue #2627 (Issue #2628).
 *
 * Reuses the same outer shape as {@link evolveDir}: a single `Neat` instance
 * drives population management, mutation, crossover, elitism, plateau
 * detection, and lifecycle events. The only difference is the scorer — the
 * worker-based dataset {@link Fitness} is swapped for an
 * {@link RLEpisodeFitness} that runs `episodesPerCreature` episode rollouts
 * per creature inline.
 *
 * Per-generation seed set: every creature in generation `g` plays the same
 * seeds derived from `seedSet(g) = [hash(seed, g, 0), …, hash(seed, g, N-1)]`,
 * so within-generation comparisons are fair and the set rotates each
 * generation to avoid one-map over-fit. Pass `fixedSeedSet = true` to lock
 * `seedSet(0)` for every generation (tests / regression only).
 *
 * Stop conditions (`targetError`, `timeoutMinutes`, `iterations`, SIGTERM)
 * and lifecycle events (`generation_complete`, `plateau_detected`) match
 * `evolveDir()` so existing consumers do not need a new event handler.
 * Cumulative episode reward is mapped to the non-negative `error` slot via
 * `defaultRewardToError` (`error = max(0, -reward)`), so `targetError`
 * semantics are preserved.
 *
 * Multi-threaded worker rollouts are deliberately deferred to #2612; today
 * every episode runs on the main thread.
 */
export async function evolveRL<S, A>(
  creature: Creature,
  adapter: EpisodeAdapter<S, A>,
  options: EvolveRLOptions,
): Promise<
  {
    error: number;
    score: number;
    time: number;
    generation: number;
    /**
     * Issue #2629: per-milestone payloads collected when `statistics === true`.
     * Omitted entirely when statistics are disabled so the return shape stays
     * unchanged from #2628 for callers that did not opt in.
     */
    milestones?: EvolveRLMilestone[];
  }
> {
  if (creature.input !== adapter.observationLength) {
    throw new Error(
      `Creature input ${creature.input} does not match adapter ` +
        `observationLength ${adapter.observationLength}`,
    );
  }

  const episodesPerCreature = options.episodesPerCreature !== undefined
    ? Math.max(1, Math.floor(options.episodesPerCreature))
    : 3;
  const fixedSeedSet = options.fixedSeedSet === true;
  // Default base seed is time-based so independent runs differ. Callers that
  // need reproducibility pin `seed` explicitly. The mask keeps it inside the
  // 32-bit unsigned range expected by `deriveRLSeed`.
  const baseSeed = options.seed !== undefined && options.seed !== null
    ? Math.floor(options.seed) >>> 0
    : Date.now() >>> 0;

  let interrupted = false;
  const signalListener = () => {
    getLogger().info("SIGTERM received, stopping evolveRL...");
    interrupted = true;
  };
  Deno.addSignalListener("SIGTERM", signalListener);

  const abortListener = () => {
    getLogger().info("AbortSignal received, stopping evolveRL...");
    interrupted = true;
  };
  options.signal?.addEventListener("abort", abortListener);

  const start = Date.now();
  const config = createNeatConfig(options);

  setMaxCachedWasmCreatureActivations(config.wasmCache.maxCachedActivations);
  setWasmCompilationCacheSize(config.wasmCache.compilationCacheSize);

  const endTimeMS = config.timeoutMinutes
    ? start + Math.max(1, config.timeoutMinutes) * 60000
    : 0;

  // Lazy import avoids a circular module graph (Neat.ts → Creature.ts →
  // CreatureTraining.ts → RLEpisodeFitness.ts → Fitness.ts vs Neat.ts → Fitness.ts).
  const { RLEpisodeFitness } = await import("@creature/RLEpisodeFitness.ts");

  // Issue #2612: Build a parallel-rollout pool when the caller asked for
  // > 1 thread AND supplied an importable adapter description. Without a
  // description we cannot spin up real workers (adapter instances are not
  // structured-clone-safe), so we warn and fall back to inline execution.
  let workerPool:
    | import("@creature/EpisodeWorkerPool.ts").EpisodeWorkerPool
    | undefined;
  if (config.threads > 1) {
    if (options.adapterDescription) {
      const { EpisodeWorkerPool } = await import(
        "@creature/EpisodeWorkerPool.ts"
      );
      workerPool = await EpisodeWorkerPool.create({
        adapter: options.adapterDescription,
        threads: config.threads,
        // `direct: true` on the adapter description forces in-process
        // execution for the whole pool — tests use this; production runs
        // leave it off so rollouts actually parallelise.
        direct: options.adapterDescription.direct === true,
      });
    } else {
      getLogger().warn(
        "[evolveRL] config.threads > 1 but no adapterDescription supplied; " +
          "falling back to single-threaded inline rollouts. Pass " +
          "options.adapterDescription = { url, config } to enable the parallel pool.",
      );
    }
  }

  const rlFitness = new RLEpisodeFitness({
    adapter,
    growth: config.costOfGrowth,
    rewardToError: defaultRewardToError,
    onEpisodeTrials: options.onEpisodeTrials,
    workerPool,
  });
  // Issue #2629: opt-in milestone statistics. When enabled, RLEpisodeFitness
  // accumulates per-episode step counts and the best mean return per
  // generation; when disabled the collection cost is skipped entirely (not
  // merely hidden) — see RLEpisodeFitness.setStatisticsEnabled().
  const statisticsEnabled = options.statistics === true;
  rlFitness.setStatisticsEnabled(statisticsEnabled);
  const milestones: EvolveRLMilestone[] = [];

  // Empty worker pool: scoring runs inline. Discovery/training scheduling
  // becomes a no-op (the schedulers warn and bail when no workers are
  // available); breeding falls back to the main-thread path.
  const neat = new Neat(creature.input, creature.output, config, []);
  // Swap in the RL scorer. The `fitness` property is `readonly` at the type
  // level for ergonomics, but this is the documented seam for alternative
  // scoring strategies.
  (neat as unknown as { fitness: Fitness }).fitness = rlFitness;

  await neat.populatePopulation(creature);

  let error = Infinity;
  let bestScore = -Infinity;

  const { Creature: CreatureClass } = await import("../Creature.ts");
  let bestCreature: InstanceType<typeof CreatureClass> | undefined;

  let iterationStartMS = Date.now();
  let generation = 0;
  const targetError = config.targetError;
  const iterations = config.iterations;

  while (true) {
    generation++;
    rlFitness.setGeneration(generation);
    rlFitness.setSeedSet(
      buildRLSeedSet(baseSeed, generation, episodesPerCreature, fixedSeedSet),
    );
    // Issue #2629: capture per-generation wall-clock and reset stats
    // accumulators *before* fitness runs. When statistics are off, both
    // calls are no-ops on the disabled path.
    const generationStartMs = Date.now();
    rlFitness.beginGenerationStatistics();

    // deno-lint-ignore no-await-in-loop
    const result = await neat.evolve(bestCreature);

    const fittest = result.fittest;
    const fittestScore = fittest.score!;
    assert(fittestScore >= bestScore, "Score is less than best score");
    if (fittestScore > bestScore) {
      const errorTmp = getTag(fittest, "error");
      assert(errorTmp, "No error tag found");

      const parsedError = errorTmp === "Infinity"
        ? Number.POSITIVE_INFINITY
        : Number.parseFloat(errorTmp);
      assert(Number.isFinite(parsedError), "Error is not finite");
      assert(parsedError >= 0, "Error is negative");
      error = parsedError;
      bestScore = fittestScore;
      bestCreature = fittest.shallowClone() as InstanceType<
        typeof CreatureClass
      >;
      bestCreature.score = bestScore;
    }

    const now = Date.now();
    const timedOut = endTimeMS ? now > endTimeMS : false;

    let phaseTiming = result.phaseTiming;
    if (config.checkpointEveryGeneration && config.creatureStore) {
      const checkpointStart = Date.now();
      // deno-lint-ignore no-await-in-loop
      await writeCreatures(neat, config.creatureStore);
      phaseTiming = {
        ...result.phaseTiming,
        checkpointWriteMs: Date.now() - checkpointStart,
      };
    }

    const generationElapsedMs = now -
      (generation === 1 ? start : iterationStartMS);
    emitTrainingEvent(config.onTrainingEvent, {
      kind: "generation_complete",
      timestamp: new Date().toISOString(),
      generation,
      bestFitness: fittestScore,
      averageFitness: result.averageScore,
      populationSize: neat.population.length,
      elapsedMs: generationElapsedMs,
      phaseTiming,
      throughput: result.throughput,
    });

    if (result.plateau.onPlateau) {
      emitTrainingEvent(config.onTrainingEvent, {
        kind: "plateau_detected",
        timestamp: new Date().toISOString(),
        generation,
        stagnationCount: result.plateau.generationsOnPlateau,
        plateauThreshold: config.plateauDetection.windowSize,
        improvementRate: result.plateau.improvementRate,
        mutationMultiplier: result.plateau.mutationMultiplier,
      });
    }

    // Issue #2629: emit and accumulate the milestone payload exactly when the
    // schedule (geometric: 1, 2, 5, 10, …, 1000, 10_000, …) hits and statistics
    // were opted in.
    if (statisticsEnabled && isMilestoneGeneration(generation)) {
      const stats = rlFitness.consumeGenerationStatistics();
      // bestScore — prefer the fittest creature's tagged mean return so that
      // elites which were not re-evaluated this generation still report a
      // sensible value. Fall back to the in-generation best mean tracked by
      // RLEpisodeFitness when no tag is present.
      const meanRewardTag = getTag(fittest, "meanReward");
      let bestScore: number;
      if (meanRewardTag) {
        const parsed = Number.parseFloat(meanRewardTag);
        bestScore = Number.isFinite(parsed) ? parsed : fittestScore;
      } else if (
        stats !== undefined && Number.isFinite(stats.bestMeanReward)
      ) {
        bestScore = stats.bestMeanReward;
      } else {
        bestScore = fittestScore;
      }
      const meanEpisodeSteps = stats !== undefined && stats.episodeCount > 0
        ? stats.totalSteps / stats.episodeCount
        : 0;
      const milestone: EvolveRLMilestone = {
        generation,
        bestScore,
        bestNeurons: fittest.neurons.length,
        bestSynapses: fittest.synapses.length,
        meanEpisodeSteps,
        generationWallClockMs: now - generationStartMs,
      };
      milestones.push(milestone);
      emitTrainingEvent(config.onTrainingEvent, {
        kind: "evolverl_milestone",
        timestamp: new Date().toISOString(),
        ...milestone,
      });
    }

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
      // deno-lint-ignore no-await-in-loop
      await neat.awaitInFlightTasks();
    }
  }

  // Issue #2612: Terminate the parallel rollout pool, if any. When no
  // pool was constructed (single-threaded or missing adapterDescription)
  // this is a no-op.
  workerPool?.terminate();
  await neat.discoveryReplayQueue.waitForCompletion();

  if (bestCreature) {
    creature.loadFrom(bestCreature, config.debug, "evolveRL:restoreBest");
  }

  if (config.creatureStore) {
    await writeCreatures(neat, config.creatureStore);
  }

  Deno.removeSignalListener("SIGTERM", signalListener);
  options.signal?.removeEventListener("abort", abortListener);
  // Issue #2629: include milestones only when statistics were enabled, so
  // callers that did not opt in see the same return shape as #2628.
  if (statisticsEnabled) {
    return {
      error,
      score: bestScore,
      generation,
      time: Date.now() - start,
      milestones,
    };
  }
  return {
    error,
    score: bestScore,
    generation,
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
