/**
 * Typed error for training-gain-log faults — Issue #3934.
 *
 * The log exists to answer one question — does score rank predict training gain
 * — and every fault here makes the answer wrong rather than absent: a foreign
 * descriptor version mixes two feature spaces, a torn line is a record whose
 * contents are not what they claim, and an outcome for an event nobody
 * dispatched is a gain with no design point behind it. None of them is
 * recoverable by coercion, so each one throws.
 *
 * @module TrainingGainLogError
 */

export type TrainingGainLogErrorReason =
  /** A record's `descriptorVersion` is not the version the reader expects. */
  | "DESCRIPTOR_VERSION_MISMATCH"
  /** A line is not JSON, or is missing/mistyping a required field. */
  | "MALFORMED_RECORD"
  /** A descriptor vector is not the fixed length its version declares. */
  | "DESCRIPTOR_LENGTH_MISMATCH"
  /** An outcome arrived for a creature no dispatch was recorded for. */
  | "UNKNOWN_EVENT"
  /** The log could not be read or written (permissions, disk, …). */
  | "IO_FAILURE";

export class TrainingGainLogError extends Error {
  override readonly name = "TrainingGainLogError";
  readonly reason: TrainingGainLogErrorReason;

  constructor(message: string, reason: TrainingGainLogErrorReason) {
    super(message);
    this.reason = reason;
  }
}
