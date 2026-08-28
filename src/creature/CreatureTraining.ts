/**
 * CreatureTraining.ts - Training orchestration, evolution, and scoring.
 *
 * Extracted from Creature.ts (Issue #1409) to keep the Creature class
 * under 500 lines and each module focused on a single responsibility.
 */

import { assert } from "@std/assert";
import { yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import { getTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import { writeCreatures } from "@creature/CheckpointWriter.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { DatasetError } from "@errors/DatasetError.ts";
import {
  assertWholeRecordRead,
  openDatasetFileSync,
} from "@architecture/DatasetIO.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DiscoverRecord } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { calculate as calculateScore } from "@architecture/Score.ts";
import { dataFiles } from "@architecture/Training.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { EVOLUTION_ONLY_TRAIN_PER_GEN } from "@config/TrainPerGen.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Costs } from "@costs";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { AWAIT_IN_FLIGHT_TIMEOUT_MS, Neat } from "@neat/Neat.ts";
import {
  computeHardDeadlineTS,
  DEFAULT_OVERRUN_ENFORCEMENT_FACTOR,
  shouldStopStartingGenerations,
} from "@neat/HardDeadline.ts";
import {
  awaitWithinHardDeadline,
  HARD_DEADLINE_BREACHED,
} from "@neat/HardDeadlineRace.ts";
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
  disposeEvolvePopulation,
  releaseEvolveCaches,
} from "@creature/EvolveTeardown.ts";
import { runBoundedEvolveTeardown } from "@creature/BoundedEvolveTeardown.ts";
import { finishGeneration } from "@creature/EvolveGenerationTail.ts";
import {
  createPhaseTimingAccumulator,
  finalisePhaseTimingTotals,
} from "@creature/PhaseTimingTotals.ts";
// Re-export so `import * as training` consumers (e.g. Creature.ts) can name the
// run-level phase-timing totals shape (Issue #3210).
export type { PhaseTimingTotals } from "@creature/PhaseTimingTotals.ts";
import {
  createScorerUtilisationAccumulator,
  finaliseScorerUtilisationTotals,
} from "@creature/ScorerUtilisationTotals.ts";
// Re-export so `import * as training` consumers (e.g. Creature.ts) can name the
// run-level scorer-utilisation totals shape (Issue #3234).
export type { ScorerUtilisationTotals } from "@creature/ScorerUtilisationTotals.ts";
import {
  type EvolveRLMilestone,
  isMilestoneGeneration,
} from "@creature/EvolveRLStatistics.ts";
import {
  buildEvolveRunStatistics,
  type EvolveResult,
} from "@creature/EvolveRunStatistics.ts";
// Re-export so `import * as training` consumers (e.g. Creature.ts) can name the
// run-level result and its tuning-statistics sub-shapes (Issue #3422).
export type {
  EvolveResult,
  EvolveRunStatistics,
  HardwareDescriptors,
  OptionsEcho,
  ScoreImprovementMilestone,
  ScoreImprovementMilestones,
  TrainingOutcomeTotals,
} from "@creature/EvolveRunStatistics.ts";
import { summariseTrainingOutcomes } from "@creature/TrainingOutcomeTotals.ts";
import { createScoreTrajectory } from "@creature/ScoreImprovementMilestones.ts";
import { serialiseOptionsEcho } from "@creature/EvolveOptionsEcho.ts";

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

  // Issue #3843: `propagateUpdate` above rewrote weights and biases throughout
  // the creature, and both are inputs to the creature hash — so the identity is
  // stale regardless of what `changed` says. `changed` reports only an
  // IF/MAXIMUM/MINIMUM structural downgrade from `Neuron.applyLearnings`, not
  // whether the gradient step moved anything, so an ordinary backprop pass left
  // `changed === false` and the uuid survived a full training step. Identity is
  // shed unconditionally; the structural repair below stays gated on `changed`.
  delete creature.uuid;

  if (changed) {
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
  // Issue #3412: an empty file list means the dataset vanished / holds no
  // `.bin` files — fail loud with a DatasetError naming the directory.
  if (dataResult.files.length === 0) {
    throw new DatasetError(
      `no .bin training data files found in ${dataDir} (dataset vanished?)`,
      "NO_DATA_FILES",
      dataDir,
    );
  }
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
    // Issue #3412: a vanished `.bin` file fails loud as a DatasetError naming
    // the path rather than a bare NotFound.
    const file = openDatasetFileSync(filePath);

    try {
      while (true) {
        const bytesRead = file.readSync(batchBuffer);
        if (bytesRead === null) break;
        // Issue #3541: name the file and the byte counts — the bare
        // `AssertionError: Invalid number of bytes read` named neither.
        assertWholeRecordRead(filePath, bytesRead, BYTES_PER_RECORD, {
          inputs: creature.input,
          outputs: creature.output,
        });

        const recordsRead = Math.floor(bytesRead / BYTES_PER_RECORD);

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
 * Test-only injection seam for {@link evolveDir} (Issue #2902).
 *
 * Lets the end-to-end T+15 hard-deadline guard drive the absolute cap
 * deterministically without real sleeps (behavioural-test policy #2888).
 * Production callers omit `deps` entirely; the defaults reproduce the
 * pre-existing behaviour exactly.
 *
 * - `startTimeMS` overrides the run-start timestamp that anchors both the soft
 *   `endTimeMS` and the absolute T+15 hard cap. Passing a timestamp far enough
 *   in the past places both deadlines behind the wall clock, so the very first
 *   finish-up cycle takes the hard-cap branch.
 * - `onNeatReady` is invoked with the live {@link Neat} instance once the
 *   population is seeded and before the evolve loop starts, so a test can stub
 *   never-resolving in-flight discovery / training promises (no Rust FFI in CI)
 *   and later inspect the in-flight maps once the run returns.
 */
export interface EvolveDirDeps {
  /** Override the run-start timestamp (ms since epoch). */
  startTimeMS?: number;
  /**
   * Injectable clock (ms since epoch) for over-run enforcement (GRQ #4141).
   * Tests advance this between generations; production omits it (`Date.now`).
   */
  now?: () => number;
  /**
   * Multiple of `timeoutMinutes` after which new generations must not start.
   * Defaults to {@link DEFAULT_OVERRUN_ENFORCEMENT_FACTOR}.
   */
  overrunEnforcementFactor?: number;
  /** Invoked with the constructed {@link Neat} instance before the evolve loop. */
  onNeatReady?: (neat: Neat) => void;
  /**
   * Per-step budget (ms) for the bounded post-loop teardown (GRQ #4472).
   * Tests shrink it so a wedged worker / replay is abandoned without a real
   * wait; production omits it and takes
   * {@link DEFAULT_TEARDOWN_STEP_BUDGET_MS}.
   */
  teardownBudgetMS?: number;
}

/**
 * Mark the run as a graceful over-run stop: no new generations, population
 * stays committed, and the T+15 hard-deadline abandon path is not taken
 * (GRQ #4141).
 */
function requestOverrunStop(neat: Neat, factor: number): void {
  // Issue #3823: once we have decided to stop starting generations, a pending
  // "do at least one more loop" request can never be honoured — `evolve()` is
  // not called again on this path. Leaving it set makes `finishUp()` refuse to
  // finish, and the over-run branch below spins (nothing is in flight, so
  // `awaitInFlightTasks()` returns immediately) until the hard deadline.
  // Cleared before the already-stopped guard so it holds on every pass.
  neat.additionalGenerationCount = 0;
  if (neat.terminationReason === "overrun") return;
  neat.doNotStartMore = true;
  neat.terminationReason = "overrun";
  getLogger().warn(
    `[Neat] Training over-run: elapsed exceeded expected duration ` +
      `× ${factor} — stopping new generations and finishing with the ` +
      `evolved population`,
  );
}

/**
 * GRQ #4470: report and record a generation abandoned mid-flight because the
 * hard cap passed while it was running.
 *
 * The named log line lands at the moment of the abandon — a run that only says
 * `abandoning 0 in-flight task(s)` after the fact is what hid the GRQ-22 wedge.
 * `abandonInFlightPastHardDeadline` then clears the in-flight bookkeeping,
 * sets `terminationReason`, and interrupts any named phase.
 */
function abandonWedgedGeneration(
  neat: Neat,
  hardDeadlineMS: number,
  nowFn: () => number,
  generationsCompleted: number,
): void {
  getLogger().warn(
    `[Neat] Hard deadline (timeoutMinutes + grace) exceeded during ` +
      `generation ${generationsCompleted + 1} — abandoning the in-flight ` +
      `generation and keeping the ${generationsCompleted} generation(s) ` +
      `already evolved`,
  );
  neat.abandonInFlightPastHardDeadline(hardDeadlineMS, nowFn());
}

/**
 * Evolve the creature on a dataset directory using NEAT.
 * Supports multi-threaded workers, checkpointing, and timeout.
 */
export async function evolveDir(
  creature: Creature,
  dataSetDir: string,
  options: NeatOptions,
  deps?: EvolveDirDeps,
): Promise<EvolveResult> {
  let interrupted = false;
  const signalListener = () => {
    getLogger().info("SIGTERM received, saving progress...");
    interrupted = true;
  };

  Deno.addSignalListener("SIGTERM", signalListener);

  // Issue #2902: `deps?.startTimeMS` is a test-only override that anchors both
  // the soft `endTimeMS` and the absolute T+15 hard cap to an injected (past)
  // timestamp, so the hard-cap branch can be driven without real sleeps.
  const start = deps?.startTimeMS ?? Date.now();
  const config = createNeatConfig(options);

  // Issue #1566: Apply WASM cache caps from config before training starts.
  setMaxCachedWasmCreatureActivations(config.wasmCache.maxCachedActivations);
  setWasmCompilationCacheSize(config.wasmCache.compilationCacheSize);

  const endTimeMS = config.timeoutMinutes
    ? start + Math.max(1, config.timeoutMinutes) * 60000
    : 0;
  // Issue #2895: shared absolute hard cap (endTimeMS + clamped grace). 0 when
  // no timeout is configured. Issue #2896 enforces it in the finish-up cycle
  // below via neat.abandonInFlightPastHardDeadline(hardDeadlineMS).
  const hardDeadlineMS =
    computeHardDeadlineTS(start, config.timeoutMinutes ?? 0) ?? 0;

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
      // Issue #3865: the per-creature worker path scores with the run's
      // resolved config, not one re-derived from the worker's own environment.
      config.rustScorer,
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
          config.rustScorer,
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

  // Issue #2902: hand the constructed Neat instance to the test seam (if any)
  // so integration guards can stub never-resolving in-flight work before the
  // evolve loop. No-op for production callers.
  deps?.onNeatReady?.(neat);

  let error = Infinity;
  let bestScore = -Infinity;

  // Dynamic import to avoid circular dependency at module load time.
  const { Creature: CreatureClass } = await import("../Creature.ts");
  let bestCreature: InstanceType<typeof CreatureClass> | undefined;

  let iterationStartMS = Date.now();
  let generation = 0;
  const iterations = config.iterations;
  // Issue #3210: sum the always-on per-generation phase timings across the run.
  const phaseTimingAccumulator = createPhaseTimingAccumulator();
  // Issue #3234: sum the per-backend scorer-utilisation counts across the run.
  const scorerUtilisationAccumulator = createScorerUtilisationAccumulator();
  // Issue #3422: compact best-score trajectory for the improvement milestones.
  const scoreTrajectory = createScoreTrajectory();
  const nowFn = deps?.now ?? Date.now;
  const overrunFactor = deps?.overrunEnforcementFactor ??
    DEFAULT_OVERRUN_ENFORCEMENT_FACTOR;

  while (true) {
    // GRQ #4470: the hard cap is consulted on *every* pass, before any branch
    // decides what to do next. It used to be checked only inside the over-run
    // branch and the `completed` branch, so a generation that neither
    // completed nor tripped the over-run predicate went straight back into
    // evolve() without ever looking at the cap — and both of those branches
    // fall through to an `awaitInFlightTasks()` that returns immediately once
    // the cap has passed, so the loop could spin well past its own deadline.
    // Generation 1 is exempt (as `shouldStopStartingGenerations` is) so a run
    // that starts already past its cap still commits one evolved population.
    if (
      generation > 0 &&
      neat.abandonInFlightPastHardDeadline(hardDeadlineMS, nowFn())
    ) {
      break;
    }

    if (
      shouldStopStartingGenerations(
        generation,
        start,
        config.timeoutMinutes,
        nowFn(),
        overrunFactor,
      )
    ) {
      requestOverrunStop(neat, overrunFactor);
      if (interrupted) break;
      // Graceful self-termination: do not take the hard-deadline abandon path.
      if (neat.finishUp(iterations, endTimeMS, start, generation)) {
        break;
      }
      // deno-lint-ignore no-await-in-loop
      await neat.awaitInFlightTasks(
        AWAIT_IN_FLIGHT_TIMEOUT_MS,
        hardDeadlineMS,
        nowFn,
      );
      continue;
    }

    // GRQ #4470: bound the generation itself. A discovery/training child that
    // never settles can hold the resources this generation needs, and an
    // `await` on a promise that never settles outlives every deadline check in
    // the loop. Past the cap we abandon the generation, keep the population
    // evolved so far, and hand control back to the caller — no hard kill.
    // A run that began already past its cap keeps the unbounded await so it
    // still produces one committed generation.
    const deadlineAlreadyPast = hardDeadlineMS > 0 &&
      nowFn() > hardDeadlineMS;
    const generationCap = deadlineAlreadyPast ? 0 : hardDeadlineMS;
    // deno-lint-ignore no-await-in-loop
    const outcome = await awaitWithinHardDeadline(
      neat.evolve(bestCreature),
      generationCap,
      nowFn,
      () => abandonWedgedGeneration(neat, hardDeadlineMS, nowFn, generation),
    );
    if (outcome === HARD_DEADLINE_BREACHED) {
      break;
    }
    const result = outcome;

    generation++;

    // Issue #3636: the end-of-generation bookkeeping (champion adoption, timed
    // checkpoint, run-total accumulation, score trajectory, lifecycle events,
    // cost-aware early stop) is shared with evolveEnv and evolveRL.
    // deno-lint-ignore no-await-in-loop
    const tail = await finishGeneration({
      neat,
      config,
      result,
      generation,
      start,
      iterationStartMS,
      endTimeMS,
      interrupted,
      bestScore,
      error,
      bestCreature,
      phaseTimingAccumulator,
      scorerUtilisationAccumulator,
      scoreTrajectory,
    });
    bestCreature = tail.bestCreature as
      | InstanceType<typeof CreatureClass>
      | undefined;
    bestScore = tail.bestScore;
    error = tail.error;
    const now = tail.now;
    const completed = tail.completed;

    // evolveDir-specific: supervised scores are `1 - error` (plus the growth
    // penalty), so a new champion's score and error must stay consistent.
    if (tail.championImproved) {
      const tolerance = 1e-10;
      assert(
        bestScore - 1 <= -error + tolerance,
        `Score (absolute) less than error (score=${bestScore}, error=${error})`,
      );
    }

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
        result.fittest.score,
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

      // Issue #2896: enforce the absolute T+15 hard cap. Once it passes, abandon
      // any in-flight discovery/training bookkeeping and break unconditionally —
      // even when finishUp() would still ask for more wait generations. The
      // post-loop sequence (worker termination, best-creature restore,
      // writeCreatures) still runs because the break lands there.
      if (neat.abandonInFlightPastHardDeadline(hardDeadlineMS, nowFn())) {
        break;
      }

      if (neat.finishUp(iterations, endTimeMS, start, generation)) {
        break;
      }

      // Issue #2240: Lightweight wait for in-flight tasks instead of running
      // full evolve() cycles. This avoids wasting worker resources on fitness
      // evaluation, breeding, and mutation while simply waiting for discovery
      // or training to finish.
      // GRQ #4470: the wait shares the loop's clock and cap, so once the cap
      // passes it returns immediately and the guard at the top of the loop
      // ends the run rather than letting it spin here.
      // deno-lint-ignore no-await-in-loop
      await neat.awaitInFlightTasks(
        AWAIT_IN_FLIGHT_TIMEOUT_MS,
        hardDeadlineMS,
        nowFn,
      );
    }
  }

  // GRQ #4472: the post-loop teardown is bounded, so "the loop ended on time"
  // translates into "the process returned on time". The champion restore and
  // the checkpoint write run first — before worker termination or the Issue
  // #1509 replay drain, either of which can be abandoned without losing the
  // generations already evolved.
  await runBoundedEvolveTeardown({
    label: "evolveDir",
    persist: async () => {
      if (bestCreature) {
        creature.loadFrom(bestCreature, config.debug, "training:restoreBest");
      }
      if (config.creatureStore) {
        await writeCreatures(neat, config.creatureStore);
      }
    },
    workers,
    replayQueue: neat.discoveryReplayQueue,
    hardDeadlineMS,
    now: nowFn,
    budgetMS: deps?.teardownBudgetMS,
  });
  workers.length = 0;

  // Issue #3434: run-level lifecycle teardown. The champion has been restored
  // into (and any checkpoint written from) the population above, so dispose the
  // run's population (keeping the caller creature), dispose the temporary
  // champion clone, and release the process-global breed/discovery caches so a
  // second evolveDir in the same process starts from a clean baseline.
  disposeEvolvePopulation(neat.population, creature);
  bestCreature?.dispose();
  releaseEvolveCaches();

  Deno.removeSignalListener("SIGTERM", signalListener);
  const time = Date.now() - start;
  return {
    error: error,
    score: bestScore,
    generation: generation,
    time,
    phaseTimingTotals: finalisePhaseTimingTotals(phaseTimingAccumulator, time),
    scorerUtilisation: finaliseScorerUtilisationTotals(
      scorerUtilisationAccumulator,
    ),
    // Issue #3779: run-level training-outcome totals, including the skipped
    // dispatches a non-verbose run-end summary could not otherwise see.
    trainingOutcomes: summariseTrainingOutcomes(neat.trainingRegressionTracker),
    // Issue #3422: run-level tuning statistics — population size, requested
    // options, hardware and the score-improvement milestones.
    ...buildEvolveRunStatistics({
      populationSize: config.populationSize,
      adaptivePopulationEnabled: config.adaptivePopulation.enabled,
      finalPopulationSize: neat.effectivePopulationSize,
      options,
      trajectory: scoreTrajectory,
    }),
    ...(neat.terminationReason
      ? { terminationReason: neat.terminationReason }
      : {}),
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
): Promise<EvolveResult> {
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
  // Issue #2791: reinforcement learning is an evolution-only task with no
  // labelled dataset, so the supervised auto-scaling of `trainPerGen` does not
  // apply. Preserve the historical default of 1 (per-generation backprop is a
  // no-op without a dataset) unless the caller sets `trainPerGen` explicitly.
  const config = createNeatConfig(
    options.trainPerGen === undefined
      ? { ...options, trainPerGen: EVOLUTION_ONLY_TRAIN_PER_GEN }
      : options,
  );

  setMaxCachedWasmCreatureActivations(config.wasmCache.maxCachedActivations);
  setWasmCompilationCacheSize(config.wasmCache.compilationCacheSize);

  const endTimeMS = config.timeoutMinutes
    ? start + Math.max(1, config.timeoutMinutes) * 60000
    : 0;
  // Issue #2895: shared absolute hard cap (endTimeMS + clamped grace). 0 when
  // no timeout is configured. Issue #2896 enforces it in the finish-up cycle
  // below via neat.abandonInFlightPastHardDeadline(hardDeadlineMS).
  const hardDeadlineMS =
    computeHardDeadlineTS(start, config.timeoutMinutes ?? 0) ?? 0;

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
  const iterations = config.iterations;
  // Issue #3210: sum the always-on per-generation phase timings across the run.
  const phaseTimingAccumulator = createPhaseTimingAccumulator();
  // Issue #3234: sum the per-backend scorer-utilisation counts across the run.
  const scorerUtilisationAccumulator = createScorerUtilisationAccumulator();
  // Issue #3422: compact best-score trajectory for the improvement milestones.
  const scoreTrajectory = createScoreTrajectory();

  while (true) {
    if (
      shouldStopStartingGenerations(
        generation,
        start,
        config.timeoutMinutes,
        Date.now(),
      )
    ) {
      requestOverrunStop(neat, DEFAULT_OVERRUN_ENFORCEMENT_FACTOR);
      if (interrupted) break;
      if (neat.finishUp(iterations, endTimeMS, start, generation)) {
        break;
      }
      // deno-lint-ignore no-await-in-loop
      await neat.awaitInFlightTasks();
      continue;
    }

    generation++;
    episodicFitness.setGeneration(generation);

    // deno-lint-ignore no-await-in-loop
    const result = await neat.evolve(bestCreature);

    // Issue #3636: shared end-of-generation bookkeeping (see finishGeneration).
    // deno-lint-ignore no-await-in-loop
    const tail = await finishGeneration({
      neat,
      config,
      result,
      generation,
      start,
      iterationStartMS,
      endTimeMS,
      interrupted,
      bestScore,
      error,
      bestCreature,
      phaseTimingAccumulator,
      scorerUtilisationAccumulator,
      scoreTrajectory,
    });
    bestCreature = tail.bestCreature as
      | InstanceType<typeof CreatureClass>
      | undefined;
    bestScore = tail.bestScore;
    error = tail.error;
    const now = tail.now;
    const completed = tail.completed;

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
        result.fittest.score,
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

      // Issue #2896: enforce the absolute T+15 hard cap. Once it passes, abandon
      // any in-flight discovery/training bookkeeping and break unconditionally —
      // even when finishUp() would still ask for more wait generations. The
      // post-loop sequence (best-creature restore, writeCreatures) still runs
      // because the break lands there.
      if (neat.abandonInFlightPastHardDeadline(hardDeadlineMS)) {
        break;
      }

      if (neat.finishUp(iterations, endTimeMS, start, generation)) {
        break;
      }
      // deno-lint-ignore no-await-in-loop
      await neat.awaitInFlightTasks();
    }
  }

  // No worker pool to terminate — episode rollouts ran inline. The replay queue
  // never had a chance to schedule anything (no dataDir was provided), but it
  // is drained for symmetry with evolveDir() in case a future change wires one
  // through. GRQ #4472: same bounded teardown, so the champion restore and the
  // checkpoint write cannot be stranded behind a drain that will not end.
  await runBoundedEvolveTeardown({
    label: "evolveEnv",
    persist: async () => {
      if (bestCreature) {
        creature.loadFrom(bestCreature, config.debug, "evolveEnv:restoreBest");
      }
      if (config.creatureStore) {
        await writeCreatures(neat, config.creatureStore);
      }
    },
    replayQueue: neat.discoveryReplayQueue,
    hardDeadlineMS,
  });

  // Issue #3434: run-level lifecycle teardown — dispose the run's population
  // (keeping the caller creature), dispose the temporary champion clone, and
  // release the process-global breed/discovery caches.
  disposeEvolvePopulation(neat.population, creature);
  bestCreature?.dispose();
  releaseEvolveCaches();

  Deno.removeSignalListener("SIGTERM", signalListener);
  options.signal?.removeEventListener("abort", abortListener);
  const time = Date.now() - start;
  return {
    error,
    score: bestScore,
    generation,
    time,
    phaseTimingTotals: finalisePhaseTimingTotals(phaseTimingAccumulator, time),
    scorerUtilisation: finaliseScorerUtilisationTotals(
      scorerUtilisationAccumulator,
    ),
    // Issue #3779: run-level training-outcome totals, including the skipped
    // dispatches a non-verbose run-end summary could not otherwise see.
    trainingOutcomes: summariseTrainingOutcomes(neat.trainingRegressionTracker),
    // Issue #3422: run-level tuning statistics — population size, requested
    // options, hardware and the score-improvement milestones.
    ...buildEvolveRunStatistics({
      populationSize: config.populationSize,
      adaptivePopulationEnabled: config.adaptivePopulation.enabled,
      finalPopulationSize: neat.effectivePopulationSize,
      options,
      trajectory: scoreTrajectory,
    }),
    ...(neat.terminationReason
      ? { terminationReason: neat.terminationReason }
      : {}),
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
   *
   * Issue #2647: when the run terminates between two scheduled milestones,
   * a synthetic final-generation milestone is appended so the last entry of
   * `milestones` always matches `result.generation`.
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
  EvolveResult & {
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
  // Issue #2791: reinforcement learning is an evolution-only task with no
  // labelled dataset, so the supervised auto-scaling of `trainPerGen` does not
  // apply. Preserve the historical default of 1 (per-generation backprop is a
  // no-op without a dataset) unless the caller sets `trainPerGen` explicitly.
  const config = createNeatConfig(
    options.trainPerGen === undefined
      ? { ...options, trainPerGen: EVOLUTION_ONLY_TRAIN_PER_GEN }
      : options,
  );

  setMaxCachedWasmCreatureActivations(config.wasmCache.maxCachedActivations);
  setWasmCompilationCacheSize(config.wasmCache.compilationCacheSize);

  const endTimeMS = config.timeoutMinutes
    ? start + Math.max(1, config.timeoutMinutes) * 60000
    : 0;
  // Issue #2895: shared absolute hard cap (endTimeMS + clamped grace). 0 when
  // no timeout is configured. Issue #2896 enforces it in the finish-up cycle
  // below via neat.abandonInFlightPastHardDeadline(hardDeadlineMS).
  const hardDeadlineMS =
    computeHardDeadlineTS(start, config.timeoutMinutes ?? 0) ?? 0;

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

  /**
   * Issue #2629 / #2647: build the milestone payload for the current
   * generation, consuming and clearing the per-generation statistics
   * accumulator. Hoisted into a closure so the loop body can emit on the
   * geometric schedule and the post-loop tail can append a synthetic
   * final-generation milestone using the same field semantics.
   *
   * Issue #2693: the synthetic-tail caller passes already-snapshotted
   * scalars instead of a live creature reference; the loop path still
   * forwards live `creature.neurons.length` / `creature.synapses.length`
   * via the wrapper below.
   */
  const buildMilestoneFromScalars = (
    fittestScore: number,
    fittestNeurons: number,
    fittestSynapses: number,
    fittestMeanReward: string | null,
    generationStartMs: number,
    nowMs: number,
    gen: number,
  ): EvolveRLMilestone => {
    const stats = rlFitness.consumeGenerationStatistics();
    // bestScore — prefer the fittest creature's tagged mean return so that
    // elites which were not re-evaluated this generation still report a
    // sensible value. Fall back to the in-generation best mean tracked by
    // RLEpisodeFitness when no tag is present.
    let milestoneBestScore: number;
    if (fittestMeanReward) {
      const parsed = Number.parseFloat(fittestMeanReward);
      milestoneBestScore = Number.isFinite(parsed) ? parsed : fittestScore;
    } else if (
      stats !== undefined && Number.isFinite(stats.bestMeanReward)
    ) {
      milestoneBestScore = stats.bestMeanReward;
    } else {
      milestoneBestScore = fittestScore;
    }
    const meanEpisodeSteps = stats !== undefined && stats.episodeCount > 0
      ? stats.totalSteps / stats.episodeCount
      : 0;
    return {
      generation: gen,
      bestScore: milestoneBestScore,
      bestNeurons: fittestNeurons,
      bestSynapses: fittestSynapses,
      meanEpisodeSteps,
      generationWallClockMs: nowMs - generationStartMs,
    };
  };

  const buildMilestonePayload = (
    fittest: Creature,
    fittestScore: number,
    generationStartMs: number,
    nowMs: number,
    gen: number,
  ): EvolveRLMilestone => {
    return buildMilestoneFromScalars(
      fittestScore,
      fittest.neurons.length,
      fittest.synapses.length,
      getTag(fittest, "meanReward"),
      generationStartMs,
      nowMs,
      gen,
    );
  };

  // Issue #2647: track the most recent generation's snapshot inputs so the
  // post-loop tail can append a synthetic final-generation milestone when the
  // run terminates between two scheduled milestones (e.g. iterations = 7).
  //
  // Issue #2693: snapshot the lightweight scalars rather than the live
  // {@link Creature} reference. Holding a strong reference to the previous
  // generation's fittest across the entire run pinned an otherwise-disposable
  // creature in long-running evolveRL loops, fanning out to its neurons,
  // synapses, and tag arrays via the creature → neuron → creature cycle.
  let lastFittestScore = 0;
  let lastFittestNeurons = 0;
  let lastFittestSynapses = 0;
  let lastFittestMeanReward: string | null = null;
  let lastGenerationStartMs = 0;
  let lastNowMs = 0;
  let lastFittestCaptured = false;

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
  const iterations = config.iterations;
  // Issue #3210: sum the always-on per-generation phase timings across the run.
  const phaseTimingAccumulator = createPhaseTimingAccumulator();
  // Issue #3234: sum the per-backend scorer-utilisation counts across the run.
  const scorerUtilisationAccumulator = createScorerUtilisationAccumulator();
  // Issue #3422: compact best-score trajectory for the improvement milestones.
  const scoreTrajectory = createScoreTrajectory();

  while (true) {
    if (
      shouldStopStartingGenerations(
        generation,
        start,
        config.timeoutMinutes,
        Date.now(),
      )
    ) {
      requestOverrunStop(neat, DEFAULT_OVERRUN_ENFORCEMENT_FACTOR);
      if (interrupted) break;
      if (neat.finishUp(iterations, endTimeMS, start, generation)) {
        break;
      }
      // deno-lint-ignore no-await-in-loop
      await neat.awaitInFlightTasks();
      continue;
    }

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

    // Issue #3636: shared end-of-generation bookkeeping (see finishGeneration).
    // deno-lint-ignore no-await-in-loop
    const tail = await finishGeneration({
      neat,
      config,
      result,
      generation,
      start,
      iterationStartMS,
      endTimeMS,
      interrupted,
      bestScore,
      error,
      bestCreature,
      phaseTimingAccumulator,
      scorerUtilisationAccumulator,
      scoreTrajectory,
    });
    bestCreature = tail.bestCreature as
      | InstanceType<typeof CreatureClass>
      | undefined;
    bestScore = tail.bestScore;
    error = tail.error;
    const now = tail.now;
    const completed = tail.completed;

    // Issue #2647: remember the most recent generation's snapshot inputs so a
    // synthetic final milestone can be built after the loop exits between
    // scheduled milestones. Captured before the scheduled-milestone block
    // because that block consumes the per-generation statistics accumulator.
    if (statisticsEnabled) {
      // Issue #2693: snapshot only the milestone-relevant scalars so the
      // live creature reference is not retained across generations.
      lastFittestScore = fittestScore;
      lastFittestNeurons = fittest.neurons.length;
      lastFittestSynapses = fittest.synapses.length;
      lastFittestMeanReward = getTag(fittest, "meanReward");
      lastGenerationStartMs = generationStartMs;
      lastNowMs = now;
      lastFittestCaptured = true;
    }

    // Issue #2629: emit and accumulate the milestone payload exactly when the
    // schedule (geometric: 1, 2, 5, 10, …, 1000, 10_000, …) hits and statistics
    // were opted in.
    if (statisticsEnabled && isMilestoneGeneration(generation)) {
      const milestone = buildMilestonePayload(
        fittest,
        fittestScore,
        generationStartMs,
        now,
        generation,
      );
      milestones.push(milestone);
      emitTrainingEvent(config.onTrainingEvent, {
        kind: "evolverl_milestone",
        timestamp: Temporal.Now.instant().toString(),
        ...milestone,
      });
    }

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

      // Issue #2896: enforce the absolute T+15 hard cap. Once it passes, abandon
      // any in-flight discovery/training bookkeeping and break unconditionally —
      // even when finishUp() would still ask for more wait generations. The
      // post-loop sequence (best-creature restore, writeCreatures) still runs
      // because the break lands there.
      if (neat.abandonInFlightPastHardDeadline(hardDeadlineMS)) {
        break;
      }

      if (neat.finishUp(iterations, endTimeMS, start, generation)) {
        break;
      }
      // deno-lint-ignore no-await-in-loop
      await neat.awaitInFlightTasks();
    }
  }

  // Issue #2647: append a synthetic final-generation milestone when the run
  // terminated between two scheduled milestones (e.g. `targetError` met or
  // `timeoutMinutes` elapsed at a non-power-of-ten generation). Charts and
  // resume helpers driven by `milestones` need the rightmost point to track
  // `result.generation`; otherwise the last visible point is the previous
  // scheduled milestone and downstream consumers see drift.
  if (
    statisticsEnabled &&
    lastFittestCaptured &&
    (milestones.length === 0 ||
      milestones[milestones.length - 1].generation !== generation)
  ) {
    // Issue #2693: build the synthetic-tail milestone from the snapshotted
    // scalars rather than a retained Creature reference.
    const milestone = buildMilestoneFromScalars(
      lastFittestScore,
      lastFittestNeurons,
      lastFittestSynapses,
      lastFittestMeanReward,
      lastGenerationStartMs,
      lastNowMs,
      generation,
    );
    milestones.push(milestone);
    emitTrainingEvent(config.onTrainingEvent, {
      kind: "evolverl_milestone",
      timestamp: Temporal.Now.instant().toString(),
      ...milestone,
    });
  }

  // Issue #2612: Terminate the parallel rollout pool, if any. When no pool was
  // constructed (single-threaded or missing adapterDescription) there is
  // nothing to terminate. GRQ #4472: both the pool shutdown and the replay
  // drain run inside the bounded teardown, after the champion is on disk.
  await runBoundedEvolveTeardown({
    label: "evolveRL",
    persist: async () => {
      if (bestCreature) {
        creature.loadFrom(bestCreature, config.debug, "evolveRL:restoreBest");
      }
      if (config.creatureStore) {
        await writeCreatures(neat, config.creatureStore);
      }
    },
    workers: workerPool ? [workerPool] : undefined,
    replayQueue: neat.discoveryReplayQueue,
    hardDeadlineMS,
  });

  // Issue #3434: run-level lifecycle teardown — dispose the run's population
  // (keeping the caller creature), dispose the temporary champion clone, and
  // release the process-global breed/discovery caches.
  disposeEvolvePopulation(neat.population, creature);
  bestCreature?.dispose();
  releaseEvolveCaches();

  Deno.removeSignalListener("SIGTERM", signalListener);
  options.signal?.removeEventListener("abort", abortListener);
  // Issue #2629: include milestones only when statistics were enabled, so
  // callers that did not opt in see the same return shape as #2628.
  const time = Date.now() - start;
  const phaseTimingTotals = finalisePhaseTimingTotals(
    phaseTimingAccumulator,
    time,
  );
  // Issue #3234: finalise the run-level per-backend scorer-utilisation totals.
  const scorerUtilisation = finaliseScorerUtilisationTotals(
    scorerUtilisationAccumulator,
  );
  // Issue #3779: run-level training-outcome totals, including skipped
  // dispatches.
  const trainingOutcomes = summariseTrainingOutcomes(
    neat.trainingRegressionTracker,
  );
  // Issue #3422: run-level tuning statistics — population size, requested
  // options, hardware and the score-improvement milestones.
  const runStatistics = buildEvolveRunStatistics({
    populationSize: config.populationSize,
    adaptivePopulationEnabled: config.adaptivePopulation.enabled,
    finalPopulationSize: neat.effectivePopulationSize,
    options,
    trajectory: scoreTrajectory,
  });
  const termination = neat.terminationReason
    ? { terminationReason: neat.terminationReason }
    : {};
  if (statisticsEnabled) {
    return {
      error,
      score: bestScore,
      generation,
      time,
      phaseTimingTotals,
      scorerUtilisation,
      trainingOutcomes,
      ...runStatistics,
      milestones,
      ...termination,
    };
  }
  return {
    error,
    score: bestScore,
    generation,
    time,
    phaseTimingTotals,
    scorerUtilisation,
    trainingOutcomes,
    ...runStatistics,
    ...termination,
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
): Promise<EvolveResult> {
  const config = createNeatConfig(options);

  const dataSetDir = makeDataDir(dataSet, config.dataSetPartitionBreak, {
    input: creature.input,
    output: creature.output,
  });

  const result = await evolveDir(creature, dataSetDir, config);

  // deno-lint-ignore no-sync-fn-in-async-fn -- Cleanup of temporary directory after async evolution.
  Deno.removeSync(dataSetDir, { recursive: true });

  // Issue #3422: evolveDir was handed the fully-resolved `config`, so its
  // requestedOptions echo would list every default. Overwrite it with the
  // caller's original request (changes from defaults) to match the contract.
  return { ...result, requestedOptions: serialiseOptionsEcho(options) };
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
    undefined,
    undefined,
    // Issue #3865: honour an explicit `rustScorer` option on the direct
    // score path too, layered over `NEAT_AI_RUST_SCORER_*`.
    config.rustScorer,
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
