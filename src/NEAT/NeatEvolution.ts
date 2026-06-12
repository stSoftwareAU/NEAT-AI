/**
 * NeatEvolution.ts - Core evolution loop for the NEAT algorithm.
 *
 * Extracted from Neat.ts (Issue #1599) to keep the Neat class
 * under 500 lines and each module focused on a single responsibility.
 */

import { assert } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import { DeDuplicator } from "@architecture/DeDuplicator.ts";
import {
  makeElitists,
  sortCreaturesByScore,
} from "@architecture/ElitismUtils.ts";
import { FindTunePopulation } from "@blackbox/FineTunePopulation.ts";
import { Breed } from "@breed/Breed.ts";
import { ParallelBreeding } from "@breed/ParallelBreeding.ts";
import { buildCohortStdContext } from "@breed/ParentSelection.ts";
import { AddConnection } from "@mutate/AddConnection.ts";
import { allocateBreedingQuotas } from "@neat/BreedingQuotas.ts";
import { applyStagnationToQuotas } from "@neat/SpeciesPlateauDetector.ts";
import { Genus } from "@neat/Genus.ts";
import { checkMemoryAndEvict, logMemoryUsage } from "@neat/MemoryMonitor.ts";
import { Mutator } from "@neat/Mutator.ts";
import { CRISPR } from "@reconstruct/CRISPR.ts";
import { CrisprError } from "@errors/CrisprError.ts";
import { simplify } from "@optimize/Simplify.ts";
import { appendAll } from "@utils/ArrayAppend.ts";
import { validateOrDiagnose } from "@utils/Diagnostics.ts";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import type {
  GenerationPhaseTiming,
  GenerationThroughputMetrics,
  PhaseWorkerUtilisation,
  WorkerUtilisationSnapshot,
} from "@config/TrainingEvent.ts";
import type { Neat } from "@neat/Neat.ts";
import { computeThroughputMetrics } from "@neat/ThroughputMetrics.ts";
import { emitTrainingEvent } from "@neat/TrainingEventEmitter.ts";
import { preWarmWasmCache } from "@wasm/WasmCachePreWarmer.ts";
import { computeAdaptivePopulationSize } from "@neat/AdaptivePopulationSizer.ts";
import {
  captureUtilisationSnapshot,
  computeOverallCpuUtilisation,
} from "@neat/CpuUtilisation.ts";
import { processCompletedResults } from "@neat/ProcessCompletedResults.ts";
import { selectTrainingCandidates } from "@neat/TrainingCandidates.ts";
import {
  applySeedWarmupTagsAtSave,
  isSeedWarmupStructuralLockActive,
} from "@architecture/CreatureFactory.ts";

/**
 * The result returned by a single call to `evolve()`.
 *
 * Issue #2330: Named export so that `Neat.ts` can reference it explicitly,
 * avoiding potential circular-type-resolution issues that arise from using
 * `ReturnType<typeof evolution.evolve>` across a circular module boundary.
 */
export interface EvolveResult {
  fittest: Creature;
  averageScore: number;
  plateau: {
    onPlateau: boolean;
    generationsOnPlateau: number;
    improvementRate: number | null;
    mutationMultiplier: number;
  };
  phaseTiming: GenerationPhaseTiming;
  /** Compact throughput counters for this generation. Issue #2330. */
  throughput: GenerationThroughputMetrics;
}

/**
 * Evaluates, selects, breeds and mutates the population.
 *
 * @param neat - The Neat instance to evolve
 * @param previousFittest - The fittest creature from the previous generation
 * @returns Evolution results including fittest creature, average score, and plateau status
 */
export async function evolve(
  neat: Neat,
  previousFittest?: Creature,
): Promise<EvolveResult> {
  // Issue #2239: Per-generation timing diagnostics
  const evolveStartMs = Date.now();

  neat.currentGeneration++;

  neat.additionalGenerationCount--;

  // Issue #2263: Proactive pre-fitness memory monitoring.
  // Check heap pressure BEFORE the fitness phase so that WASM caches are
  // evicted proactively rather than reactively per-creature inside
  // CreatureActivation.ts. This reduces GC pauses during fitnessMs.
  const preFitnessMemoryStartMs = Date.now();
  const preFitnessMemory = checkMemoryAndEvict(
    neat.config.memory,
    getLogger(),
  );
  const preFitnessMemoryMs = Date.now() - preFitnessMemoryStartMs;
  if (preFitnessMemory.evicted) {
    emitTrainingEvent(neat.config.onTrainingEvent, {
      kind: "memory_pressure",
      timestamp: Temporal.Now.instant().toString(),
      heapUsed: preFitnessMemory.heapUsed,
      heapLimit: preFitnessMemory.heapTotal,
      evicted: true,
      pressureLevel: preFitnessMemory.pressureLevel as "warning" | "critical",
    });
  }

  // Issue #2312: Capture worker pool references for utilisation snapshots.
  const fastPool = neat.fastWorkerPool;
  const heavyPool = neat.heavyWorkerPool;

  // Issue #2330: Snapshot cumulative worker busy time so we can derive the
  // per-generation delta without per-task hooks in hot paths.
  const fastBusyStartMs = fastPool.getTotalBusyMs();
  const heavyBusyStartMs = heavyPool === fastPool
    ? fastBusyStartMs
    : heavyPool.getTotalBusyMs();

  // Issue #2330: Track peak heavy-pool backlog across the generation. The
  // backlog is the sum of in-flight discovery and training tasks, which are
  // long-running and may persist across generations.
  let heavyQueueMaxDepth = neat.discoveryInProgress.size +
    neat.trainingInProgress.size;

  // Issue #2313: Borrow idle heavy workers for fitness evaluation.
  // Heavy workers that have no pending discovery or training tasks can
  // temporarily assist the fast pool, improving CPU utilisation. This is
  // safe because discovery/training are scheduled AFTER fitness completes,
  // so borrowed workers are naturally returned before any heavy task begins.
  const idleHeavyForFitness = (fastPool !== heavyPool)
    ? heavyPool.getIdleWorkers()
    : [];
  if (idleHeavyForFitness.length > 0 && neat.config.verbose) {
    getLogger().info(
      `[DynamicPool] ${idleHeavyForFitness.length} idle heavy worker(s) ` +
        `assisting fitness evaluation`,
    );
  }

  // Issue #2239: Time fitness evaluation phase
  const fitnessStartMs = Date.now();
  await neat.fitness.calculate(neat.population, idleHeavyForFitness);
  const fitnessMs = Date.now() - fitnessStartMs;

  // Issue #2457: Commit any squash-mutation outcomes captured last generation
  // now that the freshly evaluated fitness is available. Each creature is
  // a no-op unless it is carrying a pending entry recorded by ModSquash.
  if (neat.config.squashEffectiveness.enabled) {
    for (const creature of neat.population) {
      neat.squashEffectivenessTracker.commit(creature, creature.score);
    }
  }
  // Issue #2312: Snapshot after fitness — workers should be heavily utilised
  const fitnessUtilisation = captureUtilisationSnapshot(fastPool, heavyPool);

  // Issue #2330: Heavy pool may have picked up new discovery/training tasks
  // scheduled from previous generations during fitness; refresh the peak.
  heavyQueueMaxDepth = Math.max(
    heavyQueueMaxDepth,
    neat.discoveryInProgress.size + neat.trainingInProgress.size,
  );

  // Issue #2274: Time score sorting phase
  const sortStartMs = Date.now();
  sortCreaturesByScore(neat.population);
  const sortMs = Date.now() - sortStartMs;
  // Issue #2312: Snapshot after sort — main thread only, all workers idle
  const sortUtilisation = captureUtilisationSnapshot(fastPool, heavyPool);

  // Issue #2315: Start writeScores I/O in the background and overlap it with
  // speciation. writeScores only writes files to disk; speciation only reads
  // in-memory creature data. The two phases are independent, so running them
  // concurrently hides the I/O latency behind useful CPU work.
  const writeScoresStartMs = Date.now();
  const writeScoresPromise = neat.writeScores(neat.population);

  // Issue #2274: Time speciation phase (Genus.addCreature for each creature)
  const speciationStartMs = Date.now();
  const genus = new Genus();

  // The population is already sorted in the desired order.
  // Issue #2214: Creatures that suffered a WASM panic during evaluation
  // receive -Infinity scores (set by Fitness.ts, Issue #2211). These
  // creatures are excluded from the genus so natural selection removes
  // them, but they remain in the population array so elitism and
  // breeding still have a full-size pool to work with.
  for (const creature of neat.population) {
    assert(creature.uuid, "UUID missing");
    assert(
      creature.score !== undefined && creature.score !== null,
      "Score missing",
    );

    if (!Number.isFinite(creature.score)) {
      getLogger().warn(
        `Creature ${creature.uuid.substring(0, 8)} has non-finite score ` +
          `(${creature.score}), excluding from genus`,
      );
      continue;
    }
    genus.addCreature(creature);
  }
  const speciationMs = Date.now() - speciationStartMs;

  // Issue #2315: Await writeScores to ensure all file writes complete before
  // proceeding. Timing captures the full I/O cost (overlapped with speciation).
  await writeScoresPromise;
  const writeScoresMs = Date.now() - writeScoresStartMs;
  // Issue #2312: Snapshot after writeScores+speciation — both now complete
  const writeScoresUtilisation = captureUtilisationSnapshot(
    fastPool,
    heavyPool,
  );
  // Issue #2312: Snapshot after speciation — main thread only
  const speciationUtilisation = captureUtilisationSnapshot(
    fastPool,
    heavyPool,
  );
  if (neat.population.length === 0) {
    getLogger().warn("All creatures died, using zombies");
  }

  // Issue #2452: Compute per-species rolling statistics once per
  // generation, after fitness evaluation and before parent selection,
  // so downstream consumers can see size, best/mean raw fitness, and
  // adjusted (fitness-shared) fitness for every species.
  genus.updateSpeciesStatistics();

  // Issue #2454: Record per-species best fitness for stagnation
  // detection. The detector is a no-op when
  // `speciesStagnation.enabled` is false. Prune history for species
  // that have disappeared so memory does not leak across long runs.
  neat.speciesPlateauDetector.recordGeneration(genus);
  neat.speciesPlateauDetector.pruneAbsent(genus.speciesMap.keys());

  // Issue #1615 / #2452: Emit species_adjusted event with per-species
  // summary for diversity-aware features and external observability.
  emitTrainingEvent(neat.config.onTrainingEvent, {
    kind: "species_adjusted",
    timestamp: Temporal.Now.instant().toString(),
    speciesCount: genus.speciesMap.size,
    compatibilityThreshold: neat.config.geneticCompatibilityThreshold,
    speciesSummary: genus.speciesSummary(),
  });

  const numberOfElitists = neat.config.elitism > 1
    ? neat.config.elitism
    : previousFittest
    ? neat.config.elitism
    : 2;

  /* Elitism: we need at least 2 on the first run */
  const results = makeElitists(
    neat.population,
    numberOfElitists,
    neat.config.verbose,
  );
  const elitists = results.elitists;

  let tmpFittest = elitists[0];

  assert(tmpFittest.uuid, "Fittest creature has no UUID");
  assert(tmpFittest.score, "No fittest creature score found");
  let previousFittestUUID = "NONE";
  if (previousFittest) {
    previousFittestUUID = previousFittest.uuid ?? "NONE";
    assert(previousFittest.score, "No previous fittest creature score found");
    assert(previousFittest.uuid, "Previous fittest creature has no UUID");
    assert(
      previousFittest.score <= tmpFittest.score,
      "Previous fittest has a higher score than fittest",
    );
    if (previousFittest.score === tmpFittest.score) {
      if (previousFittest.uuid !== tmpFittest.uuid) {
        getLogger().info(
          `Fittest creature ${
            tmpFittest.uuid.substring(0, 8)
          } has the same score as previous fittest ${
            previousFittest.uuid.substring(0, 8)
          } reuse previous fittest.`,
        );
      }
      tmpFittest = previousFittest;
    }
  }

  // Issue #1025: Use shallowClone() instead of fromJSON(exportJSON())
  const fittest = tmpFittest.shallowClone();

  fittest.score = tmpFittest.score;
  assert(fittest.score, "No fittest score found");

  // Issue #1039: Record fitness for plateau detection
  neat.plateauDetector.recordFitness(fittest.score);

  // Issue #1323: Record whether fine-tuning produced the new fittest
  if (previousFittest) {
    const approach = getTag(tmpFittest, "approach");
    const fineTuneImproved = approach === "fine" &&
      tmpFittest.uuid !== previousFittest.uuid;
    neat.fineTuneTracker.recordOutcome(fineTuneImproved);
  }

  addTag(fittest, "score", fittest.score.toString());

  const error = getTag(fittest, "error");
  assert(error, "No error tag found");
  let trainingTimeOutMinutes = 0;
  if (neat.endTimeTS) {
    const diff = neat.endTimeTS - Date.now();
    trainingTimeOutMinutes = Math.round(diff / 60_000);

    if (trainingTimeOutMinutes < 1) {
      trainingTimeOutMinutes = -1;
    }
  }

  if (previousFittestUUID !== fittest.uuid) {
    const simplified = simplify(fittest);

    if (simplified) {
      elitists.push(simplified);
    }

    // Issue #2828: while the seed warm-up structural lock is active, skip
    // both inline Discovery and cached-discovery replay — they prune/rewire
    // topology, which must wait until the warm-up window has elapsed so the
    // factory seed can align weights/biases first.
    const warmupLockActive = isSeedWarmupStructuralLockActive(
      neat.warmupGenerations,
      neat.currentGeneration,
    );

    if (warmupLockActive && neat.config.verbose) {
      getLogger().info(
        `Skipping discovery and replay: seed warm-up structural lock ` +
          `active (generation ${neat.currentGeneration}/${neat.warmupGenerations})`,
      );
    }

    if (!warmupLockActive && trainingTimeOutMinutes !== -1) {
      // Estimate if we have enough time for discovery
      const estimatedDiscoveryMinutes = neat.lastDiscoveryDurationMS > 0
        ? Math.ceil(neat.lastDiscoveryDurationMS / 60000) + 1
        : neat.MIN_DISCOVERY_TIME_MINUTES;

      if (trainingTimeOutMinutes >= estimatedDiscoveryMinutes) {
        neat.scheduleDiscovery(fittest, trainingTimeOutMinutes);
      } else {
        if (neat.config.verbose) {
          getLogger().info(
            `Skipping discovery: insufficient time (${trainingTimeOutMinutes}m remaining, ${estimatedDiscoveryMinutes}m estimated)`,
          );
        }
      }
    }

    // Issue #997: Schedule background replay of cached discoveries
    if (!warmupLockActive && neat.dataDir && neat.config.discoveryCacheDir) {
      neat.discoveryReplayQueue.scheduleReplay(
        fittest,
        neat.dataDir,
        neat.config,
        trainingTimeOutMinutes > 0 ? trainingTimeOutMinutes : undefined,
        {
          warmupGenerations: neat.warmupGenerations,
          currentGeneration: neat.currentGeneration,
        },
      );
    }
  }

  if (trainingTimeOutMinutes !== -1) {
    // Issue #2791: schedule per-generation backprop for the top `trainPerGen`
    // creatures of the (already score-sorted) population, not just the
    // elitist slice. With the default `elitism` of 1 the previous loop could
    // only ever train a single creature per generation regardless of
    // `trainPerGen`, starving supervised gradient descent.
    const trainingCandidates = selectTrainingCandidates(
      neat.population,
      neat.config.trainPerGen,
    );
    for (const n of trainingCandidates) {
      if (
        neat.doNotStartMore === false &&
        neat.trainingInProgress.size < neat.config.trainPerGen
      ) {
        neat.scheduleTraining(
          n,
          trainingTimeOutMinutes,
        );
      }
    }
  }

  // Issue #1669: Cycle through CRISPRs instead of permanently consuming them.
  // cleaveDNA() has a built-in idempotency guard (CRISPR tags on neurons/synapses)
  // that prevents the same DNA from being applied twice to the same creature.
  const dnaPopulation = [];

  if (neat.CRISPRs.length > 0) {
    const maxPerGen = neat.config.maxCRISPRsPerGeneration;
    let applied = 0;
    let checked = 0;
    let currentBase = fittest;

    while (applied < maxPerGen && checked < neat.CRISPRs.length) {
      const dna = neat.CRISPRs[neat.crisprIndex % neat.CRISPRs.length];
      neat.crisprIndex = (neat.crisprIndex + 1) % neat.CRISPRs.length;
      checked++;

      const crispr = new CRISPR(currentBase);
      let enhanced: Creature;
      try {
        enhanced = crispr.cleaveDNA(dna);
      } catch (error) {
        if (error instanceof CrisprError) {
          getLogger().warn(
            `Skipping invalid CRISPR '${dna.id}' (${error.code}): ${error.message}`,
          );
          continue;
        }
        throw error;
      }
      if (enhanced.uuid !== currentBase.uuid) {
        dnaPopulation.push(enhanced);
        currentBase = enhanced;
        applied++;
      }
    }
  }
  const newPopulation = [];
  if (
    elitists.length > 0
  ) {
    const n = elitists[0];
    // Issue #1040: Use shallowClone() for better performance
    const creativeThinking = n.shallowClone();
    delete creativeThinking.memetic;
    delete creativeThinking.score;
    const weightScale = 1 / Math.max(creativeThinking.synapses.length, 1);
    const addConnection = new AddConnection(creativeThinking);
    for (let i = 0; i < neat.config.creativeThinkingConnectionCount; i++) {
      addConnection.mutate(
        getRandomNumberGenerator().random() < neat.config.focusRate
          ? neat.config.focusList
          : undefined,
        {
          weightScale: weightScale,
        },
      );
    }

    assert(!creativeThinking.memetic);
    validateOrDiagnose(
      creativeThinking,
      "creativeThinking",
      creativeThinking.forwardOnly ? { forwardOnly: true } : undefined,
    );
    newPopulation.push(creativeThinking);
  }

  const ftp = new FindTunePopulation(neat, neat.fineTuneTracker);
  const fineTunedPopulation = ftp.make(
    fittest,
    previousFittest,
    genus,
  );

  // Issue #2316: Compute effective population size via adaptive sizing.
  // When adaptive sizing is disabled, this returns the base config value.
  const adaptiveConfig = neat.config.adaptivePopulation;
  const previousEffectiveSize = neat.effectivePopulationSize;
  let effectivePopSize = computeAdaptivePopulationSize(
    neat.config.populationSize,
    previousEffectiveSize,
    genus.speciesMap.size,
    neat.plateauDetector.isOnPlateau(),
    adaptiveConfig,
  );

  // Issue #2316: Apply worker-aware floor to ensure enough creatures per
  // worker for good CPU utilisation. On machines with many cores (e.g. 32),
  // a population of 50 means each worker gets ~1.5 creatures — too few for
  // even work distribution when evaluation times vary.
  if (adaptiveConfig.enabled && adaptiveConfig.minCreaturesPerWorker > 0) {
    const workerCount = neat.fastWorkerHandlers.length;
    const workerFloor = workerCount * adaptiveConfig.minCreaturesPerWorker;
    effectivePopSize = Math.max(effectivePopSize, workerFloor);
  }

  neat.effectivePopulationSize = effectivePopSize;

  // Issue #2316: Emit population_resized event and log when size changes.
  if (effectivePopSize !== previousEffectiveSize) {
    const diversityBased = effectivePopSize !==
      neat.config.populationSize;
    const workerFloorApplied = adaptiveConfig.enabled &&
      adaptiveConfig.minCreaturesPerWorker > 0 &&
      effectivePopSize >=
        neat.fastWorkerHandlers.length *
          adaptiveConfig.minCreaturesPerWorker;

    const reason = diversityBased && workerFloorApplied
      ? "combined" as const
      : workerFloorApplied
      ? "worker_floor" as const
      : effectivePopSize > previousEffectiveSize
      ? "low_diversity" as const
      : "high_diversity_plateau" as const;

    emitTrainingEvent(neat.config.onTrainingEvent, {
      kind: "population_resized",
      timestamp: Temporal.Now.instant().toString(),
      previousSize: previousEffectiveSize,
      newSize: effectivePopSize,
      baseSize: neat.config.populationSize,
      reason,
    });

    if (neat.config.verbose) {
      getLogger().info(
        `[Adaptive] Population size ${previousEffectiveSize} → ${effectivePopSize} ` +
          `(base: ${neat.config.populationSize}, reason: ${reason}, ` +
          `species: ${genus.speciesMap.size}, ` +
          `workers: ${neat.fastWorkerHandlers.length})`,
      );
    }
  }

  const newPopSize = effectivePopSize -
    elitists.length -
    dnaPopulation.length -
    neat.trainingComplete.length -
    neat.discoveryComplete.length -
    fineTunedPopulation.length - 1 -
    newPopulation.length;

  // Issue #2313: Borrow idle heavy workers for breeding, same rationale
  // as fitness — heavy tasks are only scheduled after breeding completes.
  const idleHeavyForBreeding = (fastPool !== heavyPool)
    ? heavyPool.getIdleWorkers()
    : [];
  const breedingWorkers = idleHeavyForBreeding.length > 0
    ? [...neat.fastWorkerHandlers, ...idleHeavyForBreeding]
    : neat.fastWorkerHandlers;
  if (idleHeavyForBreeding.length > 0 && neat.config.verbose) {
    getLogger().info(
      `[DynamicPool] ${idleHeavyForBreeding.length} idle heavy worker(s) ` +
        `assisting breeding`,
    );
  }

  // Issue #1026: Use parallel breeding for improved performance
  // Issue #2239: Time parallel breeding phase
  const breedingStartMs = Date.now();
  const parallelBreeding = new ParallelBreeding(
    genus,
    neat.config,
    breedingWorkers,
  );

  // Issue #2314: Start breeding as a non-blocking promise so that main-thread
  // work (result processing, plateau detection, MCMC configuration) can run
  // while workers breed. These phases are independent: result processing reads
  // completed task queues from the previous generation; plateau/MCMC reads
  // neat-level state that breeding does not modify.
  // Issue #2323: Wrap the promise to capture when workers actually complete,
  // distinguishing pure breeding duration from wall-clock breedingMs.
  let breedingWorkerEndMs = 0;
  // Issue #2453: When fitness sharing is enabled, allocate per-species
  // breeding quotas in proportion to summed adjusted fitness. The
  // species_adjusted statistics computed earlier this generation are
  // the inputs.
  let speciesQuotas = neat.config.fitnessSharing.enabled && newPopSize > 0
    ? allocateBreedingQuotas(
      genus,
      newPopSize,
      neat.config.fitnessSharing.minSpeciesSlots,
    )
    : undefined;

  // Issue #2454: Reduce or zero out breeding quotas for species that
  // are flat across the configured windows; reclaimed slots are
  // redistributed proportionally to species that are still
  // progressing. The transformation preserves the total quota count
  // so the breeding budget is unchanged.
  if (speciesQuotas && neat.config.speciesStagnation.enabled) {
    speciesQuotas = applyStagnationToQuotas(
      speciesQuotas,
      neat.speciesPlateauDetector,
    );
  }
  const rawBreedingPromise = parallelBreeding.breedBatch(
    newPopSize,
    speciesQuotas,
  );
  const breedingPromise = rawBreedingPromise.then((result) => {
    breedingWorkerEndMs = Date.now();
    return result;
  });

  const breed = new Breed(genus, neat.config, neat.noveltySearch);

  // Issue #2323: Start timing main-thread overlap work (runs concurrently
  // with worker breeding).
  const overlapStartMs = Date.now();

  // Issue #2314: Process completed results while workers breed.
  // Issue #2239: Time result processing phase
  const resultProcessingStartMs = Date.now();
  const trainedPopulation = processCompletedResults(neat, fittest, genus);
  const resultProcessingMs = Date.now() - resultProcessingStartMs;

  // Issue #2314: Compute plateau and MCMC configuration while workers breed.
  // Issue #1039: Apply plateau stagnation response - increase mutation rate
  const mutationMultiplier = neat.plateauDetector.getMutationMultiplier();
  let mutatorConfig = neat.config;
  if (mutationMultiplier > 1.0) {
    const adjustedMutationRate = Math.min(
      neat.config.mutationRate * mutationMultiplier,
      1.0,
    );
    mutatorConfig = Object.freeze({
      ...neat.config,
      mutationRate: adjustedMutationRate,
    });
    if (neat.config.verbose) {
      getLogger().info(
        `[Plateau] Stagnation detected - mutation rate increased from ` +
          `${(neat.config.mutationRate * 100).toFixed(1)}% to ` +
          `${(adjustedMutationRate * 100).toFixed(1)}% ` +
          `(${neat.plateauDetector.getGenerationsOnPlateau()} generations on plateau)`,
      );
    }
  }

  // Issue #2200: Pass MCMC temperature to the mutator when enabled.
  // Issue #2201: Pass diagnostics for acceptance rate tracking.
  // Temperature is cooled once per generation after mutation.
  const mcmcTemperature = neat.config.mcmc.enabled
    ? neat.mcmcState.getTemperature()
    : undefined;
  const mcmcDiagnostics = neat.config.mcmc.enabled
    ? neat.mcmcState.diagnostics
    : undefined;

  const mutator = new Mutator(
    mutatorConfig,
    mcmcTemperature,
    mcmcDiagnostics,
    // Issue #2457: Reuse the run-wide squash effectiveness tracker so its
    // histogram persists across generations.
    neat.squashEffectivenessTracker,
  );
  mutator.setWarmupContext(neat.warmupGenerations, neat.currentGeneration);

  // Issue #2527: Provide the per-creature cohort std lookup so the
  // Mutator can run M-H acceptance against the GRPO group-relative
  // delta when `mcmcAdvantageMode === "groupRelative"`. No-op when the
  // mode is `"absolute"` so existing behaviour is unchanged.
  if (
    neat.config.mcmc.enabled &&
    neat.config.mcmc.mcmcAdvantageMode === "groupRelative"
  ) {
    const cohortContext = buildCohortStdContext(
      genus,
      neat.config.mcmc.minCohortSize,
    );
    mutator.setMcmcCohortContext(
      cohortContext.stdByUuid,
      cohortContext.fallbackStd,
    );
  }

  // Issue #1099: Single-pass de-duplication (constructed early so it is ready
  // when needed after mutation, without waiting for breeding to complete).
  const deDuplicator = new DeDuplicator(breed, mutator);

  // Issue #2323: End main-thread overlap measurement before awaiting workers.
  const mainThreadOverlapMs = Date.now() - overlapStartMs;

  // Issue #2314: Await breeding results now that all overlapped main-thread
  // work is complete.
  const offspringBatch = await breedingPromise;
  // Issue #2897: Stack-safe in-place append. Spreading an unbounded
  // offspringBatch into push() arguments throws RangeError once the batch
  // exceeds V8's argument/stack limit; appendAll uses an indexed loop instead.
  appendAll(newPopulation, offspringBatch);
  const breedingMs = Date.now() - breedingStartMs;
  // Issue #2323: Compute pure worker breeding duration. If the .then()
  // callback has not fired yet (breedingWorkerEndMs is still 0), the worker
  // completed synchronously with the await — use the current time.
  const breedingWorkerMs =
    (breedingWorkerEndMs > 0 ? breedingWorkerEndMs : Date.now()) -
    breedingStartMs;
  // Issue #2312: Snapshot after breeding — fast workers should be active
  const breedingUtilisation = captureUtilisationSnapshot(fastPool, heavyPool);

  // Issue #2284: Capture breeding sub-phase timing (non-worker path only)
  const breedingSubPhases = parallelBreeding.lastBreedingSubPhases;

  // Issue #2274: Time mutation phase
  const mutationStartMs = Date.now();
  mutator.mutate(newPopulation);
  const mutationMs = Date.now() - mutationStartMs;
  // Issue #2312: Snapshot after mutation — main thread only
  const mutationUtilisation = captureUtilisationSnapshot(fastPool, heavyPool);

  // Issue #2200: Cool the MCMC temperature after each generation.
  // Issue #2201: cool() now also finalises generation diagnostics
  // and applies adaptive temperature tuning.
  // Issue #2456: Pass the live diversity snapshot so cool() can reheat
  // temperature when diversity collapses below threshold. The species
  // count comes from the speciation pass run earlier this generation;
  // mean within-species compatibility is reserved for a future telemetry
  // signal (the diversity-aware reheat fires on either branch).
  if (neat.config.mcmc.enabled) {
    neat.mcmcState.cool(neat.config.verbose, {
      speciesCount: genus.speciesMap.size,
    });
  }

  /** make sure we do at least one more loop */
  if (trainedPopulation.length > 0 && neat.additionalGenerationCount <= 0) {
    neat.additionalGenerationCount = 1;
  }

  // Issue #1568: Save reference to old population before replacement
  const oldPopulation = neat.population;

  neat.population = [
    ...elitists,
    ...trainedPopulation,
    ...fineTunedPopulation,
    ...newPopulation,
    ...dnaPopulation,
  ]; // Keep pseudo sorted.

  // Issue #1099: Single-pass de-duplication on the combined population
  // Issue #2274: Time de-duplication phase
  // Issue #2314: Start dedup as a non-blocking promise and overlap it with
  // WASM pre-warming. Dedup's async I/O (previousExperiment file checks via
  // Deno.stat) yields to the event loop, letting pre-warming run during those
  // pauses. Pre-warming on the pre-dedup population is safe because:
  //   • Duplicate creatures share the same topology as another creature already
  //     in the population, so no extra WASM templates are compiled for them.
  //   • Replacement creatures from dedup are small mutations of existing
  //     topologies and often share the same WASM template.
  //   • At worst, a few replacement templates are compiled lazily during
  //     fitness — a harmless cache overshoot.
  const deduplicationStartMs = Date.now();
  const dedupPromise = deDuplicator.perform(neat.population);

  // Issue #2287: Pre-warm WASM compilation cache before the next generation's
  // fitness evaluation. Pre-computes topology hashes on all unevaluated
  // creatures and pre-compiles WASM templates for unique topologies.
  // Issue #2314: Runs concurrently with dedup I/O to hide latency.
  const preWarmStartMs = Date.now();
  const preWarmResult = preWarmWasmCache(neat.population);
  const preWarmMs = Date.now() - preWarmStartMs;
  // Issue #2312: Snapshot after pre-warming — main thread only
  const preWarmUtilisation = captureUtilisationSnapshot(fastPool, heavyPool);

  // Issue #2314: Await dedup completion after pre-warming finishes.
  await dedupPromise;
  const deduplicationMs = Date.now() - deduplicationStartMs;
  // Issue #2312: Snapshot after deduplication
  const deduplicationUtilisation = captureUtilisationSnapshot(
    fastPool,
    heavyPool,
  );

  // Issue #1568: Dispose old population creatures not carried forward
  const carriedForward = new Set(neat.population);
  for (const creature of oldPopulation) {
    if (!carriedForward.has(creature)) {
      creature.dispose();
    }
  }

  if (neat.config.verbose && preWarmResult.newTemplatesCompiled > 0) {
    getLogger().info(
      `[PreWarm] ${preWarmResult.newTemplatesCompiled} new templates, ` +
        `${preWarmResult.cachedTemplates} cached, ` +
        `${preWarmResult.uniqueTopologies} unique topologies ` +
        `(${preWarmMs}ms)`,
    );
  }

  // Issue #1565: Post-evolution heap memory monitoring
  const postFitnessMemoryStartMs = Date.now();
  const memoryResult = checkMemoryAndEvict(
    neat.config.memory,
    getLogger(),
  );
  if (memoryResult.evicted) {
    if (memoryResult.pressureLevel === "warning") {
      neat.memoryWarningEvictionCount = (neat.memoryWarningEvictionCount ?? 0) +
        1;
      if (neat.memoryWarningEvictionCount % 10 === 1) {
        logMemoryUsage(memoryResult, getLogger());
      }
    } else if (memoryResult.pressureLevel === "critical") {
      neat.memoryCriticalEvictionCount =
        (neat.memoryCriticalEvictionCount ?? 0) + 1;
      if (neat.memoryCriticalEvictionCount % 10 === 1) {
        logMemoryUsage(memoryResult, getLogger());
      }
    }

    // Issue #1615: Emit memory_pressure event
    emitTrainingEvent(neat.config.onTrainingEvent, {
      kind: "memory_pressure",
      timestamp: Temporal.Now.instant().toString(),
      heapUsed: memoryResult.heapUsed,
      heapLimit: memoryResult.heapTotal,
      evicted: true,
      pressureLevel: memoryResult.pressureLevel as "warning" | "critical",
    });
  }

  // Issue #2263: Accumulate total memory eviction time (pre + post fitness).
  const postFitnessMemoryMs = Date.now() - postFitnessMemoryStartMs;
  const memoryEvictionMs = preFitnessMemoryMs + postFitnessMemoryMs;

  // Issue #2239: Compute total generation time and build phase timing
  const totalMs = Date.now() - evolveStartMs;

  // Issue #2312: Build per-phase worker utilisation breakdown.
  const phaseEntries: Array<{
    durationMs: number;
    snapshot?: WorkerUtilisationSnapshot;
  }> = [
    { durationMs: fitnessMs, snapshot: fitnessUtilisation },
    { durationMs: sortMs, snapshot: sortUtilisation },
    { durationMs: writeScoresMs, snapshot: writeScoresUtilisation },
    { durationMs: speciationMs, snapshot: speciationUtilisation },
    { durationMs: breedingMs, snapshot: breedingUtilisation },
    { durationMs: mutationMs, snapshot: mutationUtilisation },
    { durationMs: deduplicationMs, snapshot: deduplicationUtilisation },
    { durationMs: preWarmMs, snapshot: preWarmUtilisation },
    { durationMs: resultProcessingMs },
  ];

  const workerUtilisation: PhaseWorkerUtilisation = {
    fitness: fitnessUtilisation,
    breeding: breedingUtilisation,
    sort: sortUtilisation,
    writeScores: writeScoresUtilisation,
    speciation: speciationUtilisation,
    mutation: mutationUtilisation,
    deduplication: deduplicationUtilisation,
    preWarm: preWarmMs > 0 ? preWarmUtilisation : undefined,
    overallCpuUtilisationPct: computeOverallCpuUtilisation(
      phaseEntries,
      totalMs,
    ),
  };

  // Issue #2314: Compute pipeline overlap. Three concurrent phase pairs:
  //   1. resultProcessingMs runs during breedingMs (worker breeding overlaps
  //      main-thread result processing).
  //   2. speciationMs runs during writeScoresMs (speciation is synchronous
  //      while writeScores is async I/O — Issue #2315 pipeline).
  //   3. preWarmMs runs during deduplicationMs (pre-warming overlaps dedup I/O).
  // The overlap is the sum of the shorter phases that ran concurrently with
  // longer ones, representing wall-clock time saved by the pipelining.
  const pipelineOverlapMs = resultProcessingMs + speciationMs + preWarmMs;

  const phaseTiming: GenerationPhaseTiming = {
    fitnessMs,
    breedingMs,
    // Issue #2323: Split breeding timing into worker vs main-thread overlap
    breedingWorkerMs,
    mainThreadOverlapMs,
    resultProcessingMs,
    totalMs,
    memoryEvictionMs: memoryEvictionMs > 0 ? memoryEvictionMs : undefined,
    // Issue #2274: New per-phase timing fields — always reported since
    // these phases run every generation (even if 0ms on fast iterations).
    writeScoresMs,
    mutationMs,
    deduplicationMs,
    speciationMs,
    sortMs,
    // Issue #2284: Breeding sub-phase breakdown (non-worker path only)
    breedingSubPhases,
    // Issue #2287: WASM cache pre-warming time
    preWarmMs: preWarmMs > 0 ? preWarmMs : undefined,
    // Issue #2314: Pipeline overlap from concurrent phases
    pipelineOverlapMs: pipelineOverlapMs > 0 ? pipelineOverlapMs : undefined,
    // Issue #2312: Per-phase worker utilisation
    workerUtilisation,
  };

  // Issue #2330: Compute per-generation throughput metrics. All inputs are
  // cheap aggregates captured at phase/generation boundaries — there is no
  // per-creature hook in the hot path.
  const fastBusyEndMs = fastPool.getTotalBusyMs();
  const heavyBusyEndMs = heavyPool === fastPool
    ? fastBusyEndMs
    : heavyPool.getTotalBusyMs();
  const fastBusyDeltaMs = Math.max(0, fastBusyEndMs - fastBusyStartMs);
  const heavyBusyDeltaMs = Math.max(0, heavyBusyEndMs - heavyBusyStartMs);

  // Peak fast-pool backlog is the larger of fitness or breeding queues —
  // both use the same handler set, so the max is representative of the pool.
  const fastQueueMaxDepth = Math.max(
    neat.fitness.lastQueueMaxDepth,
    parallelBreeding.lastQueueMaxDepth,
  );

  // Final heavy-backlog sample after any late scheduling events.
  heavyQueueMaxDepth = Math.max(
    heavyQueueMaxDepth,
    neat.discoveryInProgress.size + neat.trainingInProgress.size,
  );

  const throughput = computeThroughputMetrics({
    wallClockMs: totalMs,
    fitnessMs,
    fastWorkerCount: fastPool.getWorkerCount(),
    heavyWorkerCount: heavyPool.getWorkerCount(),
    fastBusyMs: fastBusyDeltaMs,
    heavyBusyMs: heavyBusyDeltaMs,
    fastQueueMaxDepth,
    heavyQueueMaxDepth,
    // Issue #2424: Scorer runtime telemetry captured inside Fitness.calculate.
    scoredCreatureCount: neat.fitness.lastScoredCreatureCount,
    scorerMs: neat.fitness.lastScorerMs,
    // Issue #2523: corrupt parent skips during the breed phase.
    corruptParentSkips: parallelBreeding.lastCorruptParentSkips,
  });

  // Issue #2239: Log per-phase timing when verbose is enabled
  if (neat.config.verbose) {
    const memTag = memoryEvictionMs > 0
      ? ` memoryEviction=${memoryEvictionMs}ms`
      : "";
    const preWarmTag = preWarmMs > 0 ? ` preWarm=${preWarmMs}ms` : "";
    const overlapTag = pipelineOverlapMs > 0
      ? ` pipelineOverlap=${pipelineOverlapMs}ms`
      : "";
    getLogger().info(
      `[Timing] fitness=${fitnessMs}ms breeding=${breedingMs}ms` +
        ` breedingWorker=${breedingWorkerMs}ms` +
        ` mainThreadOverlap=${mainThreadOverlapMs}ms` +
        ` resultProcessing=${resultProcessingMs}ms${memTag}${preWarmTag}` +
        `${overlapTag}` +
        ` sort=${sortMs}ms writeScores=${writeScoresMs}ms` +
        ` mutation=${mutationMs}ms deduplication=${deduplicationMs}ms` +
        ` speciation=${speciationMs}ms total=${totalMs}ms`,
    );
    // Issue #2312: Log worker utilisation summary
    getLogger().info(
      `[Utilisation] fitness=${fitnessUtilisation.fastUtilisationPct}%fast/${fitnessUtilisation.heavyUtilisationPct}%heavy` +
        ` breeding=${breedingUtilisation.fastUtilisationPct}%fast/${breedingUtilisation.heavyUtilisationPct}%heavy` +
        ` overall=${workerUtilisation.overallCpuUtilisationPct}%`,
    );
    // Issue #2330: Log throughput summary
    // Issue #2424: Include scorer runtime telemetry (creatures/sec, scorer
    // wall time, and unique-scored creature count) so operators can compare
    // batch-mode scoring gains across different hardware.
    getLogger().info(
      `[Throughput] wall=${throughput.wallClockMs}ms` +
        ` nonFitness=${throughput.nonFitnessMs}ms` +
        ` gensPerHour=${throughput.generationsPerHour.toFixed(1)}` +
        ` fast=busy${throughput.fastBusyMs}ms/idle${throughput.fastIdleMs}ms` +
        `/depth${throughput.fastQueueMaxDepth}/wait${throughput.fastWaitMs}ms` +
        ` heavy=busy${throughput.heavyBusyMs}ms/idle${throughput.heavyIdleMs}ms` +
        `/depth${throughput.heavyQueueMaxDepth}/wait${throughput.heavyWaitMs}ms` +
        ` scorer=${throughput.scorerMs.toFixed(1)}ms` +
        `/scored${throughput.scoredCreatureCount}` +
        `/creaturesPerSec${throughput.creaturesPerSec.toFixed(1)}` +
        // Issue #2523: surface corrupt-parent skip count in the
        // throughput summary so operators can alert on producer
        // corruption.
        ` corruptParentSkips=${throughput.corruptParentSkips}`,
    );
  }

  // Issue #2909: stamp warm-up tags only at this save boundary while warming,
  // and strip both once warm (or when warm-up was never configured) so the
  // returned fittest never carries stale warm-up state. The fittest is already
  // a clone, so tagging it directly is safe.
  applySeedWarmupTagsAtSave(
    fittest,
    neat.warmupGenerations,
    neat.currentGeneration,
  );

  return {
    fittest: fittest,
    averageScore: results.averageScore,
    plateau: {
      onPlateau: neat.plateauDetector.isOnPlateau(),
      generationsOnPlateau: neat.plateauDetector.getGenerationsOnPlateau(),
      improvementRate: neat.plateauDetector.getImprovementRate(),
      mutationMultiplier: neat.plateauDetector.getMutationMultiplier(),
    },
    phaseTiming,
    throughput,
  };
}
