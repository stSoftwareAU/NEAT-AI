/**
 * TrainingPredictiveCoding.ts — Predictive Coding training pipeline.
 *
 * Issue #2399: Extracted from Training.ts. Issue #1556 delegates
 * standard training to the local-learning Predictive Coding trainer and
 * packages a {@link TrainingResult} compatible with the standard pipeline.
 * Issue #4146: the trainer honours the task deadline (`trainingTimeOutMinutes` /
 * `hardDeadlineTS`) and reports a `timedOut` result.
 */

import type { CostInterface } from "@costs/CostInterface.ts";
import { Creature } from "@creature";
import { compactUnused } from "@compact/CompactUnused.ts";
import { ageNewbornGrace } from "@architecture/NewbornGrace.ts";
import { selectCompactVariant } from "@compact/CompactVariants.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { trainWithPredictiveCoding } from "@predictiveCoding/PredictiveCodingTrainer.ts";
import { addTag } from "@stsoftware/tags/mod";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "@config/PredictiveCodingConfig.ts";
import {
  resolveIterations,
  resolveTargetError,
} from "@architecture/training/TrainingSetup.ts";
import {
  msFromDeadline,
  reportTrainDirBackend,
  reportTrainDirPhase,
} from "@architecture/training/TrainDirBackendReport.ts";
import { computeTimeoutTS } from "@architecture/training/TrainingOutcome.ts";
import { preTrainingErrorTag } from "@architecture/training/RustTrainDirBridge.ts";
import { getLogger } from "@utils/Logger.ts";
import type { TrainingResult } from "@architecture/training/TrainingTypes.ts";

// Isolated clock seam for deterministic deadline tests (Issue #4146): it
// computes the task deadline, is the trainer's per-sample clock, and times the
// `finalised` phase line.
let predictiveCodingNow: () => number = Date.now;
export function __setPredictiveCodingNowForTests(now?: () => number): void {
  predictiveCodingNow = now ?? Date.now;
}

/**
 * Trains a creature using Predictive Coding local learning rules.
 */
export function trainDirPredictiveCoding(
  creature: Creature,
  binaryFiles: string[],
  options: TrainOptions,
  cost: CostInterface,
): TrainingResult {
  const pcOverrides = options.predictiveCoding!;
  const pcConfig = {
    ...DEFAULT_PREDICTIVE_CODING_CONFIG,
    ...pcOverrides,
  };
  // Issue #4146: the task's one deadline, computed once.
  const now = predictiveCodingNow;
  const timeoutTS = computeTimeoutTS(
    now(),
    options.trainingTimeOutMinutes ?? 0,
    options.hardDeadlineTS,
  );
  const iterations = resolveIterations(options);
  const targetError = resolveTargetError(options);

  const uuid = CreatureUtil.makeUUID(creature);
  const ID = uuid.substring(Math.max(0, uuid.length - 8));

  // Issue #4146: one backend line per task, here too — a missing line must not
  // read as "the task never reached trainDir". No native trainer, no deadline.
  reportTrainDirBackend(ID, {
    backend: "wasm",
    deadlineSent: false,
    capability: "none",
  });

  // Read before the trainer: its best-creature restore may drop tags.
  const carriedError = preTrainingErrorTag(creature);

  const pcResult = trainWithPredictiveCoding(
    creature,
    binaryFiles,
    pcConfig,
    cost,
    {
      iterations,
      targetError,
      log: options.log,
      timeoutTS,
      now,
    },
  );

  const feedbackLoop = options.feedbackLoop ?? false;
  let compact = compactUnused(creature.traceJSON(), 1e-7);
  // Issue #3970: `compactUnused` spends a grace round on the copy it returns;
  // the `compactVariants` fallback below does not.
  const compactWasAged = compact !== undefined;
  if (!compact) {
    // Issue #3037: select the best of the safe + aggressive compaction
    // candidates (the safe variant is the floor; identical variants dedupe).
    compact = selectCompactVariant(
      Creature.fromJSON(creature.exportJSON()).compactVariants(feedbackLoop),
    );
  }

  // Issue #3970: one training round has completed — spend a round of every
  // protected newborn's grace budget before the trace below inherits the tags.
  // The compacted copy was aged inside `compactUnused`.
  ageNewbornGrace(creature);
  // Issue #3970: age the fallback lineage too, so it cannot keep a budget its
  // siblings have already spent.
  if (!compactWasAged && compact) ageNewbornGrace(compact);

  // Issue #1913: Add trace tags indicating Predictive Coding was used.
  const trace = creature.traceJSON();
  addTag(trace, "approach", "predictive-coding");
  addTag(trace, "pc-energy", String(pcResult.averageEnergy));
  addTag(trace, "pc-inference-steps", String(pcResult.averageInferenceSteps));
  addTag(trace, "pc-changed", String(pcResult.changed));

  const compactExport = compact ? compact.exportJSON() : undefined;
  if (compactExport) {
    addTag(compactExport, "approach", "predictive-coding");
    addTag(compactExport, "pc-energy", String(pcResult.averageEnergy));
    addTag(
      compactExport,
      "pc-inference-steps",
      String(pcResult.averageInferenceSteps),
    );
    addTag(compactExport, "pc-changed", String(pcResult.changed));
  }

  let result: TrainingResult;
  if (pcResult.timedOut) {
    const measured = pcResult.completedIterations > 0;
    getLogger().info(
      `Training ${ID} stopped by its deadline (predictive coding, ${pcResult.completedIterations} full iteration(s), best measure: ${
        measured ? "full" : "unmeasured"
      })`,
    );
    result = {
      ID,
      iteration: Math.max(1, pcResult.completedIterations),
      // Never score a partial measure (same convention as the native path).
      error: measured ? pcResult.error : carriedError ?? Number.NaN,
      trace,
      compact: compactExport,
      timedOut: true,
      bestMeasure: measured ? "full" : "unmeasured",
    };
  } else {
    result = {
      ID,
      iteration: pcResult.iterations,
      error: pcResult.error,
      trace,
      compact: compactExport,
    };
  }

  reportTrainDirPhase(ID, {
    phase: "finalised",
    timedOut: pcResult.timedOut,
    msFromDeadline: msFromDeadline(timeoutTS, now()),
  });
  return result;
}
