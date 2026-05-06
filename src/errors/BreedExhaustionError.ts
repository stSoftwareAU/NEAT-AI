/**
 * Typed error raised when the breeding loop has skipped every available
 * parent candidate due to corruption (Issue #2523).
 *
 * Distinct from {@link TopologyError}: a `TopologyError` signals that one
 * specific creature is corrupt at the producer side, while
 * `BreedExhaustionError` signals that the whole breeding pool is
 * unusable for the current mother and the caller should handle the
 * failure as recoverable (skip the slot, continue the batch).
 *
 * @module BreedExhaustionError
 */

export type BreedExhaustionReason =
  | "ALL_CANDIDATES_CORRUPT"
  | "RETRY_CAP_EXHAUSTED";

export class BreedExhaustionError extends Error {
  override readonly name = "BreedExhaustionError";
  readonly reason: BreedExhaustionReason;
  /** Number of corrupt candidates skipped before exhaustion. */
  readonly corruptParentSkips: number;

  constructor(
    message: string,
    reason: BreedExhaustionReason,
    corruptParentSkips: number,
  ) {
    super(message);
    this.reason = reason;
    this.corruptParentSkips = corruptParentSkips;
  }
}
