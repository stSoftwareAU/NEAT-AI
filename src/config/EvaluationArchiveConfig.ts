/**
 * Evaluation-archive configuration — Issue #3929.
 *
 * The archive is the precondition for every surrogate in
 * [Jin (2011)](../../docs/comparison/REFERENCES.md): an append-only record of
 * `(design point, true fitness)` pairs that outlives the creature that earned
 * the score. Today NEAT-AI computes tens of thousands of exact evaluations per
 * lineage and discards every one of them.
 *
 * **Off by default.** It is run infrastructure, not part of a creature, and it
 * writes to disk — so it is opted into explicitly. See
 * [`docs/EVALUATION_ARCHIVE.md`](../../docs/EVALUATION_ARCHIVE.md).
 *
 * @module EvaluationArchiveConfig
 */

import { ConfigurationError } from "@errors/ConfigurationError.ts";

/** Caller-supplied archive options; every field is optional. */
export interface EvaluationArchiveConfig {
  /**
   * Write an evaluation archive for this run.
   *
   * Default: `false`. Nothing is created, opened, or written while off.
   */
  enabled?: boolean;
  /**
   * Directory the archive file lives in. Created if missing.
   *
   * Default: `".evaluation-archive"`.
   */
  directory?: string;
  /**
   * File name of the archive within {@link directory}.
   *
   * Default: `"evaluations.jsonl"`. One file per archive; runs sharing a
   * directory and file name append to the same archive, which is the point —
   * cross-run history is what a surrogate is fitted to.
   */
  fileName?: string;
  /**
   * Retention bound: the maximum number of records kept on disk.
   *
   * Default: `100_000`. Once the archive exceeds this, the **oldest** records
   * are dropped so the newest `maxRecords` remain. Must be a finite integer
   * `>= 1`.
   */
  maxRecords?: number;
  /**
   * Run identifier written onto every record as provenance.
   *
   * Default: a fresh UUID per resolved config. Set it explicitly to correlate
   * an archive with an external run register (GRQ's `performance.csv`, say).
   */
  runId?: string;
}

/** Fully resolved archive configuration used internally. */
export interface RequiredEvaluationArchiveConfig {
  enabled: boolean;
  directory: string;
  fileName: string;
  maxRecords: number;
  runId: string;
}

/** Archive off, a hidden directory beside the run, 100k records retained. */
export const DEFAULT_EVALUATION_ARCHIVE_CONFIG: Readonly<
  Omit<RequiredEvaluationArchiveConfig, "runId">
> = Object.freeze({
  enabled: false,
  directory: ".evaluation-archive",
  fileName: "evaluations.jsonl",
  maxRecords: 100_000,
});

/**
 * Layer caller overrides over {@link DEFAULT_EVALUATION_ARCHIVE_CONFIG}.
 *
 * Invalid values are **rejected, never clamped**: a `maxRecords` typo silently
 * corrected to 1 would quietly throw away the data the archive exists to keep.
 *
 * @param overrides - Partial caller options, or `undefined` for the defaults.
 * @returns The resolved configuration, with a generated `runId` when none was
 *   supplied.
 * @throws {ConfigurationError} When a field is present but invalid.
 */
export function resolveEvaluationArchiveConfig(
  overrides?: EvaluationArchiveConfig,
): RequiredEvaluationArchiveConfig {
  const resolved: RequiredEvaluationArchiveConfig = {
    enabled: overrides?.enabled ?? DEFAULT_EVALUATION_ARCHIVE_CONFIG.enabled,
    directory: overrides?.directory ??
      DEFAULT_EVALUATION_ARCHIVE_CONFIG.directory,
    fileName: overrides?.fileName ??
      DEFAULT_EVALUATION_ARCHIVE_CONFIG.fileName,
    maxRecords: overrides?.maxRecords ??
      DEFAULT_EVALUATION_ARCHIVE_CONFIG.maxRecords,
    runId: overrides?.runId ?? crypto.randomUUID(),
  };

  if (resolved.directory.trim().length === 0) {
    throw new ConfigurationError(
      "evaluationArchive.directory must not be empty",
      "INVALID_TYPE",
    );
  }
  if (
    resolved.fileName.trim().length === 0 ||
    resolved.fileName.includes("/") || resolved.fileName.includes("\\")
  ) {
    // A path separator here would silently write outside `directory` — the one
    // place a caller-supplied string could escape the archive's own folder.
    throw new ConfigurationError(
      `evaluationArchive.fileName must be a bare file name, got ` +
        `"${resolved.fileName}"`,
      "INVALID_TYPE",
    );
  }
  if (
    !Number.isSafeInteger(resolved.maxRecords) || resolved.maxRecords < 1
  ) {
    throw new ConfigurationError(
      `evaluationArchive.maxRecords must be an integer >= 1, got ` +
        `${resolved.maxRecords}`,
      "OUT_OF_RANGE",
    );
  }
  if (resolved.runId.trim().length === 0) {
    throw new ConfigurationError(
      "evaluationArchive.runId must not be empty",
      "INVALID_TYPE",
    );
  }
  return resolved;
}
