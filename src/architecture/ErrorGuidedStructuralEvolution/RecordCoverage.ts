/**
 * Record-phase coverage accounting (Issue #3073).
 *
 * The discovery recording phase samples binary training files until either all
 * files are read or the record-phase timeout fires. On a large dataset (e.g.
 * GRQ-3's 520 binary files at a 5% sample) the timeout can fire after only a
 * fraction of the expected records have been recorded, leaving the focus-neuron
 * Parquet coverage too sparse for a meaningful analysis pass. Previously the
 * recorder proceeded to full analysis regardless, burning the analysis budget
 * on partial data and producing zero-candidate passes.
 *
 * These pure helpers estimate the expected total records from the records that
 * were actually recorded, and decide whether the achieved coverage is high
 * enough to justify running the analysis phase. They take no I/O and are unit
 * tested directly.
 */

/** Inputs describing what the recording phase actually achieved. */
export interface RecordCoverageInput {
  /** Records sampled and recorded before recording ended. */
  readonly recordsProcessed: number;
  /** Binary files fully visited (whole or partial) before recording ended. */
  readonly filesProcessed: number;
  /** Total binary files discovered in the data directory. */
  readonly totalFiles: number;
  /** True when recording ended because the record-phase timeout fired. */
  readonly timedOut: boolean;
}

/** Derived coverage figures for logging and the skip decision. */
export interface RecordCoverage extends RecordCoverageInput {
  /** Extrapolated total records the dataset would yield at this sample rate. */
  readonly estimatedTotalRecords: number;
  /** `recordsProcessed / estimatedTotalRecords`, clamped to [0, 1]. */
  readonly coverageFraction: number;
}

/**
 * Extrapolate the total records the full dataset would have yielded, from the
 * records recorded across the files processed so far.
 *
 * Returns `recordsProcessed` unchanged when extrapolation is not possible or
 * not meaningful — no files processed yet (can't estimate per-file yield) or
 * every file already processed (the count is exact, not an estimate). This is
 * deliberately conservative: with too little information we assume full
 * coverage so the analysis phase is never skipped on a guess.
 */
export function estimateTotalRecords(
  recordsProcessed: number,
  filesProcessed: number,
  totalFiles: number,
): number {
  if (
    !Number.isFinite(recordsProcessed) || recordsProcessed <= 0 ||
    filesProcessed <= 0 || totalFiles <= 0 || filesProcessed >= totalFiles
  ) {
    return Math.max(0, recordsProcessed);
  }
  const recordsPerFile = recordsProcessed / filesProcessed;
  // Never estimate below what we have already recorded.
  return Math.max(recordsProcessed, Math.round(recordsPerFile * totalFiles));
}

/** Build the derived {@link RecordCoverage} from raw recording counters. */
export function computeRecordCoverage(
  input: RecordCoverageInput,
): RecordCoverage {
  const estimatedTotalRecords = estimateTotalRecords(
    input.recordsProcessed,
    input.filesProcessed,
    input.totalFiles,
  );
  const coverageFraction = estimatedTotalRecords > 0
    ? Math.min(1, Math.max(0, input.recordsProcessed / estimatedTotalRecords))
    : (input.recordsProcessed > 0 ? 1 : 0);
  return { ...input, estimatedTotalRecords, coverageFraction };
}

/**
 * Decide whether analysis should be skipped because recording covered too
 * little of the dataset.
 *
 * The guard is intentionally narrow so it never changes behaviour for a
 * recording that finished normally:
 * - `minCoverage <= 0` disables the guard entirely.
 * - A recording that did not time out is treated as complete — never skipped.
 * - A timed-out recording that captured nothing is always skipped.
 * - Otherwise skip only when the achieved coverage is below `minCoverage`.
 */
export function shouldSkipAnalysisForCoverage(
  coverage: RecordCoverage,
  minCoverage: number,
): boolean {
  if (!Number.isFinite(minCoverage) || minCoverage <= 0) return false;
  if (!coverage.timedOut) return false;
  if (coverage.recordsProcessed <= 0) return true;
  return coverage.coverageFraction < minCoverage;
}

/**
 * Render a human-readable `recordsProcessed / estimatedTotal` summary for the
 * timeout / skip logs (Issue #3073, proposed fix item 3).
 */
export function formatRecordCoverage(coverage: RecordCoverage): string {
  const pct = (coverage.coverageFraction * 100).toFixed(1);
  const records = coverage.recordsProcessed.toLocaleString("en-AU");
  const total = coverage.estimatedTotalRecords.toLocaleString("en-AU");
  return `${records} / ~${total} records (~${pct}% coverage, ` +
    `${coverage.filesProcessed}/${coverage.totalFiles} files)`;
}

/** Inputs for mid-recording throughput projection (GRQ #4065 / NEAT-AI). */
export interface RecordThroughputProjectionInput {
  readonly recordsProcessed: number;
  readonly filesProcessed: number;
  readonly totalFiles: number;
  /** Elapsed wall time since file processing started. */
  readonly elapsedMs: number;
  /** Remaining wall time until the record-phase timeout. */
  readonly remainingMs: number;
  /** Minimum coverage fraction required to run analysis (e.g. 0.5). */
  readonly minCoverage: number;
  /**
   * Minimum files processed before trusting the projection. Too few files
   * produce a noisy rate; the elephant failure was visible after ~5–10 files.
   */
  readonly minFilesForProjection?: number;
  /**
   * Minimum elapsed ms before projecting. Guards against a fast first file
   * falsely projecting "will clear" or "cannot finish".
   */
  readonly minElapsedMsForProjection?: number;
}

/** Result of projecting final coverage from measured throughput. */
export interface RecordThroughputProjection {
  readonly ready: boolean;
  readonly recordsPerSec: number;
  readonly projectedRecords: number;
  readonly estimatedTotalRecords: number;
  readonly projectedCoverageFraction: number;
  readonly requiredCoverageFraction: number;
  readonly minutesNeededForRequiredCoverage: number;
  readonly cannotReachRequiredCoverage: boolean;
}

export const DEFAULT_MIN_FILES_FOR_PROJECTION = 5;
export const DEFAULT_MIN_ELAPSED_MS_FOR_PROJECTION = 30_000;

/**
 * Project final record coverage from the measured records/sec so far.
 *
 * Returns `ready: false` until enough files/time have elapsed to trust the
 * rate. When ready, `cannotReachRequiredCoverage` is true if finishing the
 * remaining timeout budget still leaves projected coverage below `minCoverage`.
 *
 * Pure — no I/O. Callers abort the record loop early when
 * `cannotReachRequiredCoverage` is true (GRQ #4065).
 */
export function projectRecordCoverageFromThroughput(
  input: RecordThroughputProjectionInput,
): RecordThroughputProjection {
  const minFiles = input.minFilesForProjection ??
    DEFAULT_MIN_FILES_FOR_PROJECTION;
  const minElapsed = input.minElapsedMsForProjection ??
    DEFAULT_MIN_ELAPSED_MS_FOR_PROJECTION;
  const minCoverage =
    Number.isFinite(input.minCoverage) && input.minCoverage > 0
      ? input.minCoverage
      : 0;

  const estimatedTotalRecords = estimateTotalRecords(
    input.recordsProcessed,
    input.filesProcessed,
    input.totalFiles,
  );

  const notReady = input.filesProcessed < minFiles ||
    input.elapsedMs < minElapsed ||
    input.recordsProcessed <= 0 ||
    estimatedTotalRecords <= 0 ||
    minCoverage <= 0;

  if (notReady) {
    return {
      ready: false,
      recordsPerSec: 0,
      projectedRecords: input.recordsProcessed,
      estimatedTotalRecords,
      projectedCoverageFraction: 0,
      requiredCoverageFraction: minCoverage,
      minutesNeededForRequiredCoverage: Number.POSITIVE_INFINITY,
      cannotReachRequiredCoverage: false,
    };
  }

  const recordsPerSec = input.recordsProcessed / (input.elapsedMs / 1000);
  const remainingMs = Math.max(0, input.remainingMs);
  const projectedRecords = input.recordsProcessed +
    recordsPerSec * (remainingMs / 1000);
  const projectedCoverageFraction = Math.min(
    1,
    Math.max(0, projectedRecords / estimatedTotalRecords),
  );
  const requiredRecords = minCoverage * estimatedTotalRecords;
  const recordsStillNeeded = Math.max(
    0,
    requiredRecords - input.recordsProcessed,
  );
  const minutesNeededForRequiredCoverage = recordsPerSec > 0
    ? (recordsStillNeeded / recordsPerSec) / 60
    : Number.POSITIVE_INFINITY;

  return {
    ready: true,
    recordsPerSec,
    projectedRecords: Math.round(projectedRecords),
    estimatedTotalRecords,
    projectedCoverageFraction,
    requiredCoverageFraction: minCoverage,
    minutesNeededForRequiredCoverage,
    cannotReachRequiredCoverage: projectedCoverageFraction < minCoverage,
  };
}

/**
 * Format the early-abort decision line so the GRQ-logs sweep can see
 * projected vs required coverage without arithmetic (GRQ #4065).
 */
export function formatRecordThroughputAbort(
  projection: RecordThroughputProjection,
): string {
  const projectedPct = (projection.projectedCoverageFraction * 100).toFixed(1);
  const requiredPct = (projection.requiredCoverageFraction * 100).toFixed(0);
  const rate = Math.round(projection.recordsPerSec);
  const needed = Number.isFinite(projection.minutesNeededForRequiredCoverage)
    ? `~${projection.minutesNeededForRequiredCoverage.toFixed(0)} min`
    : "unknown";
  return `projected ~${projectedPct}% < required ${requiredPct}% ` +
    `at ${rate} records/sec (need ${needed} to clear floor)`;
}
