/**
 * TrainingPredictiveCoding.ts — Predictive Coding training pipeline.
 *
 * Issue #2399: Extracted from Training.ts. Issue #1556 delegates
 * standard training to the local-learning Predictive Coding trainer and
 * packages a {@link TrainingResult} compatible with the standard pipeline.
 */

import type { CostInterface } from "@costs/CostInterface.ts";
import { Creature } from "@creature";
import { compactUnused } from "@compact/CompactUnused.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { trainWithPredictiveCoding } from "@predictiveCoding/PredictiveCodingTrainer.ts";
import { addTag } from "@stsoftware/tags/mod";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "@config/PredictiveCodingConfig.ts";
import {
  resolveIterations,
  resolveTargetError,
} from "@architecture/training/TrainingSetup.ts";
import type { TrainingResult } from "@architecture/training/TrainingTypes.ts";

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
  const iterations = resolveIterations(options);
  const targetError = resolveTargetError(options);

  const uuid = CreatureUtil.makeUUID(creature);
  const ID = uuid.substring(Math.max(0, uuid.length - 8));

  const pcResult = trainWithPredictiveCoding(
    creature,
    binaryFiles,
    pcConfig,
    cost,
    {
      iterations,
      targetError,
      log: options.log,
      dataFuzzing: options.dataFuzzing,
      dataQuantisation: options.dataQuantisation,
    },
  );

  const feedbackLoop = options.feedbackLoop ?? false;
  let compact = compactUnused(creature.traceJSON(), 1e-7);
  if (!compact) {
    compact = Creature.fromJSON(creature.exportJSON()).compact(feedbackLoop);
  }

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

  return {
    ID,
    iteration: pcResult.iterations,
    error: pcResult.error,
    trace,
    compact: compactExport,
  };
}
