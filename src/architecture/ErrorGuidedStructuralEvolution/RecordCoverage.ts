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
