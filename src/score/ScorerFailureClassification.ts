/**
 * Classify a native scorer process failure (Issue #3541).
 *
 * The WASM path is a fallback for *backend* failures — a missing binary, a GPU
 * that will not initialise, a crashed process. It is not a fallback for corrupt
 * training data: the WASM path reads the same bytes and dies with a far worse
 * message (`AssertionError: Invalid number of bytes read`, naming neither the
 * file nor the byte count), while the native scorer's genuinely diagnostic
 * `Trailing N bytes (incomplete record)` is demoted to a warning.
 *
 * Classification is deliberately conservative: anything not recognised as a
 * data fault stays retryable so the legitimate fallback is preserved.
 *
 * @module ScorerFailureClassification
 */

import { DatasetError } from "@errors/DatasetError.ts";

/**
 * Stderr shapes that identify a malformed/truncated dataset rather than a
 * backend problem. Sourced from `NEAT-AI-scorer`'s dataset reader.
 */
const CORRUPT_DATASET_PATTERNS: readonly RegExp[] = [
  /trailing\s+\d+\s+bytes/i,
  /incomplete\s+record/i,
  /(truncated|malformed|corrupt(ed)?)\s+\S*\s*(training|dataset|data|record|file)/i,
  /not\s+a\s+(whole\s+)?multiple\s+of\s+the\s+record\s+size/i,
  /record\s+size\s+mismatch/i,
];

/**
 * True when the scorer's stderr shows it rejected the *data* rather than
 * failing for a backend-specific reason.
 *
 * @param stderr - Raw stderr captured from the scorer process.
 */
export function isCorruptDatasetFailure(stderr: string): boolean {
  if (!stderr) return false;
  return CORRUPT_DATASET_PATTERNS.some((pattern) => pattern.test(stderr));
}

/** Collapse whitespace and cap length for safe inclusion in an error message. */
function collapse(value: string, limit = 2000): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= limit
    ? collapsed
    : collapsed.slice(0, limit) + "…";
}

/**
 * Throw when the scorer failed because the dataset is corrupt, preserving its
 * original diagnostic and exit code. Backend failures return normally so the
 * caller can fall back to WASM scoring.
 *
 * @param stderr - Raw stderr captured from the scorer process.
 * @param exitCode - The scorer's exit code.
 * @param dataDir - Dataset directory handed to the scorer.
 * @throws {DatasetError} With reason `CORRUPT_DATA` for a data fault.
 */
export function assertNotCorruptDataset(
  stderr: string,
  exitCode: number,
  dataDir: string,
): void {
  if (!isCorruptDatasetFailure(stderr)) return;
  throw new DatasetError(
    `rust scorer rejected the training data in ${dataDir} (exit ${exitCode}): ${
      collapse(stderr)
    } — corrupt training data is not retryable on another backend, so WASM scoring is not attempted`,
    "CORRUPT_DATA",
    dataDir,
  );
}
