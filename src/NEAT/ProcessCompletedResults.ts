/**
 * ProcessCompletedResults.ts - Drain completed training, discovery, and replay
 * results into a population of new/updated creatures.
 *
 * Extracted from `NeatEvolution.ts` (Issue #2395) so the main evolution loop
 * stays focused on orchestration. Behaviour is unchanged.
 */

import { assert } from "@std/assert";
import { blue } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import { addTag, getTag, removeTag } from "@stsoftware/tags/mod";

import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { validateAfterDiscoveryOrThrow } from "@discovery/DiscoveryPostValidate.ts";
import type { Genus } from "@neat/Genus.ts";
import type { Approach } from "@neat/LogApproach.ts";
import type { Neat } from "@neat/Neat.ts";
import { logReplaySummary } from "@neat/NeatScheduling.ts";
import { emitTrainingEvent } from "@neat/TrainingEventEmitter.ts";
import { getLogger } from "@utils/Logger.ts";

/**
 * Process completed training, discovery, and replay results.
 * Returns an array of creatures to add to the population.
 */
export function processCompletedResults(
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
