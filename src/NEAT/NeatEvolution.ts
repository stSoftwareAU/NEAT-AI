/**
 * NeatEvolution.ts - Core evolution loop for the NEAT algorithm.
 *
 * Extracted from Neat.ts (Issue #1599) to keep the Neat class
 * under 500 lines and each module focused on a single responsibility.
 */

import { assert } from "@std/assert";
import { blue } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import { addTag, getTag, removeTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DeDuplicator } from "@architecture/DeDuplicator.ts";
import {
  makeElitists,
  sortCreaturesByScore,
} from "@architecture/ElitismUtils.ts";
import { FindTunePopulation } from "@blackbox/FineTunePopulation.ts";
import { Breed } from "@breed/Breed.ts";
import { ParallelBreeding } from "@breed/ParallelBreeding.ts";
import { validateAfterDiscoveryOrThrow } from "@discovery/DiscoveryPostValidate.ts";
import { AddConnection } from "@mutate/AddConnection.ts";
import { Genus } from "@neat/Genus.ts";
import type { Approach } from "@neat/LogApproach.ts";
import { checkMemoryAndEvict, logMemoryUsage } from "@neat/MemoryMonitor.ts";
import { Mutator } from "@neat/Mutator.ts";
import { CRISPR } from "@reconstruct/CRISPR.ts";
import { CrisprError } from "@errors/CrisprError.ts";
import { simplify } from "@optimize/Simplify.ts";
import { validateOrDiagnose } from "@utils/Diagnostics.ts";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import type {
  GenerationPhaseTiming,
  PhaseWorkerUtilisation,
  WorkerUtilisationSnapshot,
} from "@config/TrainingEvent.ts";
import type { Neat } from "@neat/Neat.ts";
import { logReplaySummary } from "@neat/NeatScheduling.ts";
import { emitTrainingEvent } from "@neat/TrainingEventEmitter.ts";
import { preWarmWasmCache } from "@wasm/WasmCachePreWarmer.ts";
import type { WorkerPool } from "@multithreading/WorkerPool.ts";

/**
 * Captures a point-in-time worker utilisation snapshot from the fast and heavy
 * worker pools.
 *
 * Issue #2312: Lightweight helper used at phase boundaries to record how many
 * workers are active vs idle. Because a single snapshot cannot capture the
 * full utilisation curve across a phase, this deliberately samples at the *end*
 * of each phase — the point most indicative of sustained utilisation.
 */
function captureUtilisationSnapshot(
  fastPool: WorkerPool,
  heavyPool: WorkerPool,
): WorkerUtilisationSnapshot {
  const fastActive = fastPool.getActiveWorkerCount();
  const fastTotal = fastPool.getWorkerCount();
  const heavyActive = heavyPool.getActiveWorkerCount();
  const heavyTotal = heavyPool.getWorkerCount();
  return {
    fastActive,
    fastTotal,
    fastUtilisationPct: fastTotal > 0
      ? Math.round((fastActive / fastTotal) * 100)
      : 0,
    heavyActive,
    heavyTotal,
    heavyUtilisationPct: heavyTotal > 0
      ? Math.round((heavyActive / heavyTotal) * 100)
      : 0,
  };
}

/**
 * Computes an overall CPU utilisation estimate from per-phase snapshots
 * weighted by their duration.
 *
 * Issue #2312: Each phase's utilisation is weighted by the fraction of total
 * generation time it consumed. Phases with no snapshot are treated as 0%
 * utilisation (main-thread-only work).
 */
function computeOverallCpuUtilisation(
  phases: Array<{
    durationMs: number;
    snapshot?: WorkerUtilisationSnapshot;
  }>,
  totalMs: number,
): number {
  if (totalMs <= 0) return 0;

  let weightedSum = 0;
  for (const phase of phases) {
    if (phase.snapshot && phase.durationMs > 0) {
      const totalActive = phase.snapshot.fastActive +
        phase.snapshot.heavyActive;
      const totalWorkers = phase.snapshot.fastTotal +
        phase.snapshot.heavyTotal;
      const phaseUtilisation = totalWorkers > 0
        ? totalActive / totalWorkers
        : 0;
      weightedSum += phaseUtilisation * phase.durationMs;
    }
    // Phases without snapshots contribute 0 (main-thread-only).
  }
  return Math.round((weightedSum / totalMs) * 100);
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
): Promise<{
  fittest: Creature;
  averageScore: number;
  plateau: {
    onPlateau: boolean;
    generationsOnPlateau: number;
    improvementRate: number | null;
    mutationMultiplier: number;
  };
  phaseTiming: GenerationPhaseTiming;
}> {
  // Issue #2239: Per-generation timing diagnostics
  const evolveStartMs = Date.now();

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
      timestamp: new Date().toISOString(),
      heapUsed: preFitnessMemory.heapUsed,
      heapLimit: preFitnessMemory.heapTotal,
      evicted: true,
      pressureLevel: preFitnessMemory.pressureLevel as "warning" | "critical",
    });
  }

  // Issue #2312: Capture worker pool references for utilisation snapshots.
  const fastPool = neat.fastWorkerPool;
  const heavyPool = neat.heavyWorkerPool;

  // Issue #2239: Time fitness evaluation phase
  const fitnessStartMs = Date.now();
  await neat.fitness.calculate(neat.population);
  const fitnessMs = Date.now() - fitnessStartMs;
  // Issue #2312: Snapshot after fitness — workers should be heavily utilised
  const fitnessUtilisation = captureUtilisationSnapshot(fastPool, heavyPool);

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

  // Issue #1615: Emit species_adjusted event
  emitTrainingEvent(neat.config.onTrainingEvent, {
    kind: "species_adjusted",
    timestamp: new Date().toISOString(),
    speciesCount: genus.speciesMap.size,
    compatibilityThreshold: neat.config.geneticCompatibilityThreshold,
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

    if (trainingTimeOutMinutes !== -1) {
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
    if (neat.dataDir && neat.config.discoveryCacheDir) {
      neat.discoveryReplayQueue.scheduleReplay(
        fittest,
        neat.dataDir,
        neat.config,
        trainingTimeOutMinutes > 0 ? trainingTimeOutMinutes : undefined,
      );
    }
  }

  if (trainingTimeOutMinutes !== -1) {
    for (
      let i = 0;
      i < results.elitists.length;
      i++
    ) {
      const n = results.elitists[i];

      if (
        neat.doNotStartMore === false &&
        neat.trainingInProgress.size < neat.config.trainPerGen &&
        Number.isFinite(n.score)
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

  const newPopSize = neat.config.populationSize -
    elitists.length -
    dnaPopulation.length -
    neat.trainingComplete.length -
    neat.discoveryComplete.length -
    fineTunedPopulation.length - 1 -
    newPopulation.length;

  // Issue #1026: Use parallel breeding for improved performance
  // Issue #2239: Time parallel breeding phase
  const breedingStartMs = Date.now();
  const parallelBreeding = new ParallelBreeding(
    genus,
    neat.config,
    neat.fastWorkerHandlers,
  );

  // Issue #2314: Start breeding as a non-blocking promise so that main-thread
  // work (result processing, plateau detection, MCMC configuration) can run
  // while workers breed. These phases are independent: result processing reads
  // completed task queues from the previous generation; plateau/MCMC reads
  // neat-level state that breeding does not modify.
  const breedingPromise = parallelBreeding.breedBatch(newPopSize);

  const breed = new Breed(genus, neat.config);

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

  const mutator = new Mutator(mutatorConfig, mcmcTemperature, mcmcDiagnostics);

  // Issue #1099: Single-pass de-duplication (constructed early so it is ready
  // when needed after mutation, without waiting for breeding to complete).
  const deDuplicator = new DeDuplicator(breed, mutator);

  // Issue #2314: Await breeding results now that all overlapped main-thread
  // work is complete.
  const offspringBatch = await breedingPromise;
  newPopulation.push(...offspringBatch);
  const breedingMs = Date.now() - breedingStartMs;
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
  if (neat.config.mcmc.enabled) {
    neat.mcmcState.cool(neat.config.verbose);
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
      timestamp: new Date().toISOString(),
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

  // Issue #2314: Compute pipeline overlap. Breeding overlaps with result
  // processing (and plateau/MCMC config), and dedup overlaps with pre-warming.
  // The overlap is the sum of the shorter phases that ran concurrently with
  // longer ones, representing wall-clock time saved by the pipelining.
  const pipelineOverlapMs = resultProcessingMs + preWarmMs;

  const phaseTiming: GenerationPhaseTiming = {
    fitnessMs,
    breedingMs,
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
      `[Timing] fitness=${fitnessMs}ms breeding=${breedingMs}ms ` +
        `resultProcessing=${resultProcessingMs}ms${memTag}${preWarmTag}` +
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
  }

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
  };
}

/**
 * Process completed training, discovery, and replay results.
 * Returns an array of creatures to add to the population.
 */
function processCompletedResults(
  neat: Neat,
  fittest: Creature,
  _genus: Genus,
): Creature[] {
  const trainedPopulation: Creature[] = [];

  for (let i = neat.trainingComplete.length; i--;) {
    const r = neat.trainingComplete[i];
    assert(r.train, "No train found");
    if (!Number.isFinite(r.train.error)) {
      continue;
    }

    const json = r.train.creature;
    if (neat.config.verbose) {
      getLogger().info(
        `Training ${blue(r.train.ID)} completed ${
          r.duration ? "after " + format(r.duration, { ignoreZero: true }) : ""
        }`,
      );
    }

    // Issue #1913: Preserve PC approach tag from trace if present.
    const traceJSON = r.train.trace ? r.train.trace : null;
    const pcApproach = traceJSON ? getTag(traceJSON, "approach") : null;
    const isPC = pcApproach === "predictive-coding";

    addTag(
      json,
      "approach",
      (isPC ? "predictive-coding" : "trained") as Approach,
    );
    if (isPC && traceJSON) {
      const pcEnergy = getTag(traceJSON, "pc-energy");
      const pcSteps = getTag(traceJSON, "pc-inference-steps");
      const pcChanged = getTag(traceJSON, "pc-changed");
      if (pcEnergy) addTag(json, "pc-energy", pcEnergy);
      if (pcSteps) addTag(json, "pc-inference-steps", pcSteps);
      if (pcChanged) addTag(json, "pc-changed", pcChanged);
    }
    delete json.memetic;
    removeTag(json, "approach-logged");
    addTag(json, "trainID", r.train.ID);
    addTag(json, "trained", "YES");

    trainedPopulation.push(Creature.fromJSON(json, neat.config.debug));
    if (r.train.backtracked) {
      trainedPopulation.push(
        Creature.fromJSON(r.train.backtracked, neat.config.debug),
      );
    }
    if (r.train.forward) {
      trainedPopulation.push(
        Creature.fromJSON(r.train.forward, neat.config.debug),
      );
    }
    const compactJSON = r.train.compact ?? undefined;

    if (compactJSON) {
      if (neat.config.verbose) {
        getLogger().info(
          `Training ${blue(r.train.ID)} compacted`,
        );
      }

      // Issue #1913: Preserve PC approach on compact variant too.
      addTag(
        compactJSON,
        "approach",
        (isPC ? "predictive-coding-compact" : "compact") as Approach,
      );
      if (isPC && traceJSON) {
        const pcEnergy = getTag(traceJSON, "pc-energy");
        const pcSteps = getTag(traceJSON, "pc-inference-steps");
        const pcChanged = getTag(traceJSON, "pc-changed");
        if (pcEnergy) addTag(compactJSON, "pc-energy", pcEnergy);
        if (pcSteps) addTag(compactJSON, "pc-inference-steps", pcSteps);
        if (pcChanged) addTag(compactJSON, "pc-changed", pcChanged);
      }
      delete compactJSON.memetic;
      removeTag(compactJSON, "approach-logged");
      addTag(compactJSON, "trainID", r.train.ID);
      addTag(compactJSON, "trained", "YES");

      trainedPopulation.push(
        Creature.fromJSON(compactJSON, neat.config.debug),
      );
    }

    // Immediately clear large objects to help GC
    // @ts-ignore - clearing to help GC
    r.train.creature = null;
    // @ts-ignore - clearing to help GC
    r.train.trace = null;
    // @ts-ignore - clearing to help GC
    r.train.compact = null;
    // @ts-ignore - clearing to help GC
    r.train.backtracked = null;
    // @ts-ignore - clearing to help GC
    r.train.forward = null;
  }
  neat.trainingComplete.length = 0;

  // Issue #1020: Process discovery results
  for (let i = neat.discoveryComplete.length; i--;) {
    const r = neat.discoveryComplete[i];
    assert(r.discover, "No discovery found");

    // Issue #1615: Emit discovery_complete event
    const outcome = r.discover.improvedCreature ? "improved" : "no_change";
    emitTrainingEvent(neat.config.onTrainingEvent, {
      kind: "discovery_complete",
      timestamp: new Date().toISOString(),
      outcome: outcome as "improved" | "no_change" | "timeout",
      candidateCount: (r.discover.addHelpfulSynapses?.length ?? 0) +
        (r.discover.removeHarmfulSynapse ? 1 : 0) +
        (r.discover.candidateSquashes?.length ?? 0),
      elapsedMs: r.duration ?? 0,
    });

    if (r.discover.improvedCreature) {
      const discoveredCreature = Creature.fromJSON(
        r.discover.improvedCreature,
      );
      CreatureUtil.makeUUID(discoveredCreature);

      validateAfterDiscoveryOrThrow({
        baseCreature: fittest,
        discoveredCreature: discoveredCreature,
        discoveryID: r.discover.ID,
        operation: "discovered-creature-addition",
        feedbackLoop: neat.config.feedbackLoop,
      });

      trainedPopulation.push(discoveredCreature);

      if (neat.config.verbose) {
        getLogger().info(
          `[Neat] Added discovered creature ${
            blue(discoveredCreature.uuid?.substring(0, 8) ?? "unknown")
          } to population (from discovery ${
            blue(
              r.discover.ID.substring(Math.max(0, r.discover.ID.length - 8)),
            )
          })`,
        );
      }
    }

    // @ts-ignore - clearing to help GC
    r.discover.addHelpfulSynapses = null;
    // @ts-ignore - clearing to help GC
    r.discover.removeHarmfulSynapse = null;
    // @ts-ignore - clearing to help GC
    r.discover.candidateSquashes = null;
    // @ts-ignore - clearing to help GC
    r.discover.improvedCreature = null;
  }
  neat.discoveryComplete.length = 0;

  // Issue #997: Process completed background replay results
  const replayResults = neat.discoveryReplayQueue.getCompletedResults();
  for (const result of replayResults) {
    logReplaySummary(neat.config, result);

    if (result.improvement?.creature) {
      const replayedCreature = Creature.fromJSON(
        result.improvement.creature as Parameters<
          typeof Creature.fromJSON
        >[0],
      );
      CreatureUtil.makeUUID(replayedCreature);

      addTag(replayedCreature, "approach", "discovery-replay");

      validateAfterDiscoveryOrThrow({
        baseCreature: fittest,
        discoveredCreature: replayedCreature,
        discoveryID: result.improvement.key ?? "replay",
        operation: "discovery-replay-addition",
        feedbackLoop: neat.config.feedbackLoop,
      });

      trainedPopulation.push(replayedCreature);

      if (neat.config.verbose) {
        getLogger().info(
          `[Neat] Added replayed creature ${
            blue(replayedCreature.uuid?.substring(0, 8) ?? "unknown")
          } to population (score improvement: ${
            result.improvement.scoreDelta?.toFixed(4) ?? "N/A"
          })`,
        );
      }
    }
  }
  neat.discoveryReplayQueue.clearCompletedResults();

  return trainedPopulation;
}
