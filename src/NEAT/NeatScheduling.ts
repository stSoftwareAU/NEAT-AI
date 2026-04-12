/**
 * NeatScheduling.ts - Discovery and training task scheduling.
 *
 * Extracted from Neat.ts (Issue #1599) to keep the Neat class
 * under 500 lines and each module focused on a single responsibility.
 */

import { assert } from "@std/assert";
import { blue } from "@std/fmt/colors";
import { ensureDirSync } from "@std/fs";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { isRustDiscoveryEnabled } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { calculate as calculateScore } from "@architecture/Score.ts";
import { fineTuneImprovement } from "@blackbox/FineTune.ts";
import type { NeatConfig } from "@config/NeatConfig.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { calculateDiscoveryTimeout } from "@discovery/DiscoveryTimeout.ts";
import type { DiscoveryReplayDirResult } from "@neat/DiscoveryReplayQueue.ts";
import { getLogger } from "@utils/Logger.ts";
import type { Neat } from "@neat/Neat.ts";

/**
 * Schedules structural discovery for a creature on a worker.
 *
 * Issue #1298: Uses adaptive discovery timeout based on creature complexity.
 * Issue #1538: Uses lightweight frozen config override.
 */
export function scheduleDiscovery(
  neat: Neat,
  creature: Creature,
  timeOutMinutes: number,
): void {
  if (neat.config.discoverySampleRate <= 0) {
    return;
  }

  // Skip discovery if timeout is 0 or negative (discovery disabled)
  if (
    timeOutMinutes <= 0 || neat.config.discoveryRecordTimeOutMinutes <= 0
  ) {
    return;
  }

  // Skip discovery if Rust library or GPU is not available
  if (!isRustDiscoveryEnabled()) {
    return;
  }

  if (neat.doNotStartMore) return;

  if (
    neat.discoveryInProgress.size >= neat.config.maxConcurrentDiscoveries
  ) return;

  const uuid = CreatureUtil.makeUUID(creature);

  // Issue #2244: Heavy pool only — never steal fast (fitness) workers.
  const w = neat.heavyWorkerPool.selectWorker();
  if (!w) {
    getLogger().warn("[Neat] No workers available for discovery");
    return;
  }

  if (neat.config.verbose) {
    getLogger().info(
      `Discovery ${
        blue(uuid.substring(Math.max(0, uuid.length - 8)))
      } scheduled`,
    );
  }

  // Issue #1298: Adaptive discovery timeout based on creature complexity.
  const adaptiveTimeout = calculateDiscoveryTimeout({
    neuronCount: creature.neurons.length,
    synapseCount: creature.synapses.length,
  });
  const effectiveTimeout = Math.min(timeOutMinutes, adaptiveTimeout);

  if (neat.config.verbose) {
    getLogger().info(
      `[Neat] Adaptive discovery timeout: ${adaptiveTimeout.toFixed(2)}m ` +
        `(neurons=${creature.neurons.length}, synapses=${creature.synapses.length}), ` +
        `effective=${effectiveTimeout.toFixed(2)}m`,
    );
  }

  // Issue #1538: Use lightweight frozen override instead of full createNeatConfig()
  const discoveryConfig: NeatConfig = Object.freeze({
    ...neat.config,
    discoveryRecordTimeOutMinutes: effectiveTimeout,
  });

  const taskStartTime = Date.now();
  if (neat.config.verbose) {
    getLogger().info(
      `[Neat] Discovery request sent to worker for ${
        blue(uuid.substring(Math.max(0, uuid.length - 8)))
      }`,
    );
  }

  const discoveryPromise = w.discover(creature, discoveryConfig);

  const p = discoveryPromise.then((r) => {
    assert(r.discover, "No discovery found");

    const discoveryDurationMS = Date.now() - taskStartTime;
    neat.lastDiscoveryDurationMS = discoveryDurationMS;

    if (neat.config.verbose) {
      getLogger().info(
        `[Neat] Discovery completed for ${
          blue(uuid.substring(Math.max(0, uuid.length - 8)))
        } after ${(discoveryDurationMS / 1000).toFixed(1)}s`,
      );
    }

    // Issue #1020: Build the improved creature from the original creature.
    const improvedCreature = DiscoverStructure.addHelpfulSynapses(
      uuid,
      creature,
      r.discover.addHelpfulSynapses,
      neat.config.discoveryFailureCacheDir,
    );

    if (improvedCreature) {
      addTag(improvedCreature, "approach", "discovered");
      addTag(improvedCreature, "discoveryID", uuid);

      r.discover.improvedCreature = improvedCreature.exportJSON();

      if (neat.config.verbose) {
        getLogger().info(
          `[Neat] Built improved creature from discovery ${
            blue(uuid.substring(Math.max(0, uuid.length - 8)))
          } with ${r.discover.addHelpfulSynapses?.length ?? 0} synapses added`,
        );
      }
    }

    neat.discoveryComplete.push(r);
    neat.discoveryInProgress.delete(uuid);
  }).catch((error) => {
    getLogger().error(
      `[Neat] Discovery failed for creature ${
        uuid.substring(Math.max(0, uuid.length - 8))
      } after ${((Date.now() - taskStartTime) / 1000).toFixed(1)}s:`,
      error,
    );

    neat.discoveryInProgress.delete(uuid);

    neat.discoveryComplete.push({
      taskID: 0,
      duration: 0,
      discover: {
        ID: uuid,
      },
    });
  });

  neat.discoveryInProgress.set(uuid, p);
}

/**
 * Schedules training for a creature on a worker.
 */
export function scheduleTraining(
  neat: Neat,
  creature: Creature,
  trainingTimeOutMinutes: number,
): void {
  const uuid = CreatureUtil.makeUUID(creature);
  if (neat.trainingInProgress.has(uuid)) return;

  if (neat.alreadyScheduledMap.has(uuid)) {
    if (!neat.config.enableRepetitiveTraining) {
      return;
    }
  }

  neat.alreadyScheduledMap.set(uuid, Date.now());
  if (neat.alreadyScheduledMap.size > 1000) {
    // Clean up by removing old entries
    const minuteAgo = Date.now() - 60_000;
    for (const [key, value] of neat.alreadyScheduledMap) {
      if (value < minuteAgo) {
        neat.alreadyScheduledMap.delete(key);
      }
    }
  }

  // Issue #2244: Heavy pool only — never steal fast (fitness) workers.
  const w = neat.heavyWorkerPool.selectWorker();
  if (!w) {
    getLogger().warn("[Neat] No workers available for training");
    return;
  }

  if (neat.config.verbose) {
    getLogger().info(
      `Training ${
        blue(uuid.substring(Math.max(0, uuid.length - 8)))
      } scheduled`,
    );
  }

  const trainOptions: TrainOptions = {
    log: neat.config.log,
    traceStore: neat.config.traceStore,
    iterations: 1,
    targetError: neat.config.targetError,
    trainingSampleRate: neat.config.trainingSampleRate,
    disableRandomSamples: neat.config.disableRandomSamples,
    trainingTimeOutMinutes: trainingTimeOutMinutes,
    batchSize: neat.config.trainingBatchSize,
    maximumBiasAdjustmentScale: neat.config.maximumBiasAdjustmentScale,
    maximumWeightAdjustmentScale: neat.config.maximumWeightAdjustmentScale,
    feedbackLoop: neat.config.feedbackLoop,
    sparseRatio: neat.config.sparseRatio,
    predictiveCoding: neat.config.predictiveCoding,
    crossValidation: neat.config.crossValidation,
    dataFuzzing: neat.config.dataFuzzing,
  };

  const p = w.train(creature, trainOptions).then((r) => {
    assert(r.train, "No train found");

    const errorTx = getTag(creature, "error");
    assert(errorTx, "No error tag found");

    let trainingImprovement = true;
    if (r.train.error > parseFloat(errorTx)) {
      getLogger().warn(
        `Training ${
          blue(r.train.ID)
        } caused a higher error of ${r.train.error} from ${errorTx}`,
      );
      trainingImprovement = false;
    }
    const trainedCreature = Creature.fromJSON(r.train.creature);
    trainedCreature.score = calculateScore(
      trainedCreature,
      r.train.error,
      neat.config.costOfGrowth,
    );
    const backtracked = fineTuneImprovement(
      creature,
      trainedCreature,
      neat.config.feedbackLoop,
      1,
      true,
      neat.config.quantumStep,
    );
    const forward = fineTuneImprovement(
      creature,
      trainedCreature,
      neat.config.feedbackLoop,
      1,
      false,
      neat.config.quantumStep,
    );

    if (backtracked.length > 0 || forward.length > 0) {
      const untrainedError = getTag(trainedCreature, "untrained-error");
      if (backtracked.length > 0) {
        const backtrackedCreature = exportJSONWithRuntimeIds(backtracked[0]);
        addTag(backtrackedCreature, "trainID", r.train.ID);
        addTag(backtrackedCreature, "trainVariant", "overshot");
        if (untrainedError) {
          addTag(backtrackedCreature, "untrained-error", untrainedError);
        }
        r.train.backtracked = backtrackedCreature;
      }
      if (forward.length > 0) {
        const forwardCreature = exportJSONWithRuntimeIds(forward[0]);
        addTag(forwardCreature, "trainID", r.train.ID);
        addTag(forwardCreature, "trainVariant", "undershot");
        if (untrainedError) {
          addTag(forwardCreature, "untrained-error", untrainedError);
        }
        r.train.forward = forwardCreature;
      }
    } else if (trainingImprovement === false) {
      getLogger().warn(
        `Training ${
          blue(r.train.ID)
        } caused a higher error of ${r.train.error} from ${errorTx} and no tuning`,
      );
    }

    neat.trainingComplete.push(r);
    neat.trainingInProgress.delete(uuid);

    if (neat.config.traceStore) {
      if (r.train.trace) {
        const traceNetwork = Creature.fromJSON(
          r.train.trace,
        );
        CreatureUtil.makeUUID(traceNetwork);
        ensureDirSync(neat.config.traceStore);
        Deno.writeTextFileSync(
          `${neat.config.traceStore}/${traceNetwork.uuid}.json`,
          JSON.stringify(traceNetwork.traceJSON(), null, 1),
        );
      }
    }
  }).catch((error) => {
    getLogger().error(
      `Training failed for creature ${
        uuid.substring(Math.max(0, uuid.length - 8))
      }:`,
      error,
    );

    neat.trainingInProgress.delete(uuid);

    let creatureExport: ReturnType<typeof exportJSONWithRuntimeIds>;
    try {
      creatureExport = exportJSONWithRuntimeIds(creature);
    } catch {
      creatureExport = {
        neurons: [],
        synapses: [],
        input: creature.input,
        output: creature.output,
      };
    }

    neat.trainingComplete.push({
      taskID: 0,
      duration: 0,
      train: {
        ID: uuid,
        creature: creatureExport,
        error: Number.POSITIVE_INFINITY,
        trace: {
          input: creature.input,
          output: creature.output,
          neurons: [],
          synapses: [],
        },
      },
    });
  });

  neat.trainingInProgress.set(uuid, p);
}

/**
 * Issue #1150: Log a summary of the discovery replay result.
 */
export function logReplaySummary(
  config: NeatConfig,
  result: DiscoveryReplayDirResult,
): void {
  const totalEvaluated = result.evaluatedSingles + result.evaluatedCombos;

  // Build the summary parts
  const parts: string[] = [];
  parts.push(`evaluated: ${totalEvaluated}`);
  if (result.evaluatedSingles > 0) {
    parts.push(`singles: ${result.evaluatedSingles}`);
  }
  if (result.evaluatedCombos > 0) {
    parts.push(`combos: ${result.evaluatedCombos}`);
  }
  if (result.pruned > 0) {
    parts.push(`pruned: ${result.pruned}`);
  }
  if (result.skippedAlreadyApplied > 0) {
    parts.push(`already-applied: ${result.skippedAlreadyApplied}`);
  }
  if (result.skippedNotApplicable > 0) {
    parts.push(`not-applicable: ${result.skippedNotApplicable}`);
  }
  if (result.timedOut) {
    parts.push("(timed out)");
  }

  // Log outcome
  if (result.improvement) {
    const changeType = result.improvement.changeType ?? "unknown";
    const scoreDelta = result.improvement.scoreDelta?.toFixed(6) ?? "N/A";
    getLogger().info(
      `[Neat] Discovery replay: ${
        blue(changeType)
      } improved score by ${scoreDelta} (${parts.join(", ")})`,
    );
  } else {
    getLogger().info(
      `[Neat] Discovery replay: no improvement found (${parts.join(", ")})`,
    );
  }

  // In verbose mode, log details of successful single candidates
  if (config.verbose && result.evaluations) {
    const successfulCandidates = result.evaluations.filter(
      (e) => e.improved && e.kind !== "original",
    );
    if (successfulCandidates.length > 0) {
      getLogger().info("[Neat] Successful replay candidates:");
      for (const candidate of successfulCandidates) {
        const kind = candidate.kind === "combo" ? "combo" : "single";
        const changeType = candidate.changeType ?? "unknown";
        const description = candidate.description ?? candidate.key ?? "";
        const scoreDelta = candidate.scoreDelta?.toFixed(6) ?? "N/A";
        getLogger().info(
          `  - [${kind}] ${blue(changeType)}: ${description} (+${scoreDelta})`,
        );
      }
    }
  }
}
