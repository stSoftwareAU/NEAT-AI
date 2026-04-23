/**
 * TrainingTypes.ts — Shared interfaces for the split training pipeline.
 *
 * Issue #2399: Extracted from Training.ts so each training phase module
 * (setup, loop, teardown) imports types from a single source.
 */

import type {
  CreatureExport,
  CreatureTrace,
} from "@architecture/CreatureInterfaces.ts";

/**
 * Result returned from every training entry point.
 *
 * The fields are intentionally minimal so that the standard, predictive
 * coding, and cross-validation pipelines produce the same shape.
 */
export interface TrainingResult {
  /** Short creature identifier (last 8 chars of UUID). */
  ID: string;
  /** Number of training iterations actually executed. */
  iteration: number;
  /** Best observed error across training iterations. */
  error: number;
  /** Trace snapshot of the best creature. */
  trace: CreatureTrace;
  /** Compact export of the best creature, when available. */
  compact: CreatureExport | undefined;
}
