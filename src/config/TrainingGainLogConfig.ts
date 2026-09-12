/**
 * Training-gain-log configuration — Issue #3934.
 *
 * Per-generation backpropagation is Lamarckian local search, and
 * [Jin (2011)](../../docs/comparison/REFERENCES.md) §5 makes the point this log
 * exists to test: in a memetic algorithm the expensive decision is **who gets
 * refined**, because local search is a large fixed cost per individual.
 * NEAT-AI allocates that budget by current score
 * (`selectTrainingCandidates`) and has never recorded whether the rule works.
 *
 * This is the instrumentation half of the answer: one record per real training
 * event, carrying the pre-training design point, the rank the rule selected it
 * at, and the gain the gradient step realised. It changes no selection
 * behaviour.
 *
 * **Off by default.** It is run infrastructure, not part of a creature, and it
 * writes to disk — so it is opted into explicitly. See
 * [`docs/TRAINING_GAIN_LOG.md`](../../docs/TRAINING_GAIN_LOG.md).
 *
 * @module TrainingGainLogConfig
 */

import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { parseNumber } from "@config/ParseOptions.ts";

/** Caller-supplied log options; every field is optional. */
export interface TrainingGainLogConfig {
  /**
   * Write a training-gain log for this run.
   *
   * Default: `false`. Nothing is created, opened, or written while off.
   */
  enabled?: boolean;
  /**
   * Directory the log file lives in. Created if missing.
   *
   * Default: `".training-gain-log"`.
   */
  directory?: string;
  /**
   * Write bound: the maximum number of records **this run** appends.
   *
   * Default: `20_000`. Unlike the evaluation archive (Issue #3929) the bound is
   * per-run and the log is never rewritten: a training event costs minutes, so
   * a run cannot produce enough of them to justify a compaction pass, and
   * rewriting a file that earlier runs also appended to would discard their
   * measurements. Once the bound is reached the log says so — loudly, once —
   * and stops appending. Must be a finite integer `>= 1`.
   */
  maxRecords?: number;
  /**
   * Run identifier written onto every record as provenance.
   *
   * Default: a fresh UUID per resolved config. Set it explicitly to correlate a
   * log with an external run register, or with the run's evaluation archive.
   */
  runId?: string;
}

/** Fully resolved log configuration used internally. */
export interface RequiredTrainingGainLogConfig {
  enabled: boolean;
  directory: string;
  maxRecords: number;
  runId: string;
}

/** Log off, a hidden directory beside the run, 20k records per run. */
export const DEFAULT_TRAINING_GAIN_LOG_CONFIG: Readonly<
  Omit<RequiredTrainingGainLogConfig, "runId">
> = Object.freeze({
  enabled: false,
  directory: ".training-gain-log",
  maxRecords: 20_000,
});

/**
 * File name of the log inside its directory.
 *
 * Fixed rather than configurable, for the same reason the evaluation archive's
 * is: one directory is one log, so two logs are two directories, and no
 * caller-supplied string goes anywhere near a filesystem path.
 */
export const TRAINING_GAIN_LOG_FILE_NAME = "training-events.jsonl";

/**
 * Layer caller overrides over {@link DEFAULT_TRAINING_GAIN_LOG_CONFIG}.
 *
 * Invalid values are **rejected, never clamped**: a `maxRecords` typo silently
 * corrected to 1 would publish a rank-versus-gain correlation over one event.
 *
 * @param overrides - Partial caller options, or `undefined` for the defaults.
 * @returns The resolved configuration, with a generated `runId` when none was
 *   supplied.
 * @throws {ConfigurationError} When a field is present but invalid.
 */
export function resolveTrainingGainLogConfig(
  overrides?: TrainingGainLogConfig,
): RequiredTrainingGainLogConfig {
  const resolved: RequiredTrainingGainLogConfig = {
    enabled: overrides?.enabled ?? DEFAULT_TRAINING_GAIN_LOG_CONFIG.enabled,
    directory: overrides?.directory ??
      DEFAULT_TRAINING_GAIN_LOG_CONFIG.directory,
    maxRecords: parseNumber(
      "trainingGainLog.maxRecords",
      overrides?.maxRecords,
      DEFAULT_TRAINING_GAIN_LOG_CONFIG.maxRecords,
      { integer: true, min: 1 },
    ),
    runId: overrides?.runId ?? crypto.randomUUID(),
  };

  if (resolved.directory.trim().length === 0) {
    throw new ConfigurationError(
      "trainingGainLog.directory must not be empty",
      "INVALID_TYPE",
    );
  }
  if (!Number.isSafeInteger(resolved.maxRecords) || resolved.maxRecords < 1) {
    throw new ConfigurationError(
      `trainingGainLog.maxRecords must be an integer >= 1, got ` +
        `${resolved.maxRecords}`,
      "OUT_OF_RANGE",
    );
  }
  if (resolved.runId.trim().length === 0) {
    throw new ConfigurationError(
      "trainingGainLog.runId must not be empty",
      "INVALID_TYPE",
    );
  }
  return resolved;
}
