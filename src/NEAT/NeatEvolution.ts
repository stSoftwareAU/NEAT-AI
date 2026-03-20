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
import { Creature } from "../Creature.ts";
import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import { DeDuplicator } from "../architecture/DeDuplicator.ts";
import {
  makeElitists,
  sortCreaturesByScore,
} from "../architecture/ElitismUtils.ts";
import { FindTunePopulation } from "../blackbox/FineTunePopulation.ts";
import { Breed } from "../breed/Breed.ts";
import { ParallelBreeding } from "../breed/ParallelBreeding.ts";
import { validateAfterDiscoveryOrThrow } from "../discovery/DiscoveryPostValidate.ts";
import { AddConnection } from "../mutate/AddConnection.ts";
import { Genus } from "./Genus.ts";
import type { Approach } from "./LogApproach.ts";
import { checkMemoryAndEvict, logMemoryUsage } from "./MemoryMonitor.ts";
import { Mutator } from "./Mutator.ts";
import { CRISPR } from "../reconstruct/CRISPR.ts";
import { simplify } from "../optimize/Simplify.ts";
import { getLogger } from "../utils/Logger.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
import type { Neat } from "./Neat.ts";
import { logReplaySummary } from "./NeatScheduling.ts";
import { emitTrainingEvent } from "./TrainingEventEmitter.ts";

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
}> {
  neat.additionalGenerationCount--;

  await neat.fitness.calculate(neat.population);
  sortCreaturesByScore(neat.population);

  const genus = new Genus();

  neat.writeScores(neat.population);

  // The population is already sorted in the desired order
  for (const creature of neat.population) {
    assert(creature.uuid, "UUID missing");
    assert(creature.score, "Score missing");
    assert(
      Number.isFinite(creature.score),
      `Score: ${creature.score} is not finite`,
    );
    genus.addCreature(creature);
  }
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

    while (applied < maxPerGen && checked < neat.CRISPRs.length) {
      const dna = neat.CRISPRs[neat.crisprIndex % neat.CRISPRs.length];
      neat.crisprIndex = (neat.crisprIndex + 1) % neat.CRISPRs.length;
      checked++;

      const crispr = new CRISPR(fittest);
      const enhanced = crispr.cleaveDNA(dna);
      if (enhanced.uuid !== fittest.uuid) {
        dnaPopulation.push(enhanced);
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
  const parallelBreeding = new ParallelBreeding(
    genus,
    neat.config,
    neat.workers,
  );
  const offspringBatch = await parallelBreeding.breedBatch(newPopSize);
  newPopulation.push(...offspringBatch);

  const breed = new Breed(genus, neat.config);

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

  const mutator = new Mutator(mutatorConfig);
  mutator.mutate(newPopulation);

  // Issue #1099: Single-pass de-duplication
  const deDuplicator = new DeDuplicator(breed, mutator);

  const trainedPopulation = processCompletedResults(neat, fittest, genus);

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
  deDuplicator.perform(neat.population);

  // Issue #1568: Dispose old population creatures not carried forward
  const carriedForward = new Set(neat.population);
  for (const creature of oldPopulation) {
    if (!carriedForward.has(creature)) {
      creature.dispose();
    }
  }

  // Issue #1565: Proactive heap memory monitoring
  const memoryResult = checkMemoryAndEvict(
    neat.config.memory,
    getLogger(),
  );
  if (memoryResult.evicted) {
    if (memoryResult.pressureLevel !== "critical") {
      logMemoryUsage(memoryResult, getLogger());
    } else {
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

  return {
    fittest: fittest,
    averageScore: results.averageScore,
    plateau: {
      onPlateau: neat.plateauDetector.isOnPlateau(),
      generationsOnPlateau: neat.plateauDetector.getGenerationsOnPlateau(),
      improvementRate: neat.plateauDetector.getImprovementRate(),
      mutationMultiplier: neat.plateauDetector.getMutationMultiplier(),
    },
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

    const json = JSON.parse(r.train.creature);
    if (neat.config.verbose) {
      getLogger().info(
        `Training ${blue(r.train.ID)} completed ${
          r.duration ? "after " + format(r.duration, { ignoreZero: true }) : ""
        }`,
      );
    }

    // Issue #1913: Preserve PC approach tag from trace if present.
    const traceJSON = r.train.trace ? JSON.parse(r.train.trace) : null;
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
        Creature.fromJSON(JSON.parse(r.train.backtracked), neat.config.debug),
      );
    }
    if (r.train.forward) {
      trainedPopulation.push(
        Creature.fromJSON(JSON.parse(r.train.forward), neat.config.debug),
      );
    }
    const compactJSON = r.train.compact
      ? JSON.parse(r.train.compact)
      : undefined;

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
