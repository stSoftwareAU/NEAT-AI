/**
 * Typed error for evaluation-archive faults — Issue #3929.
 *
 * The archive's whole value rests on every record describing the same feature
 * space, so a fault here is never recoverable by coercion: a version mismatch,
 * a truncated line, or a wrong-length descriptor makes the archive a mixture of
 * two things, and a model fitted to the mixture is wrong in a way no error
 * metric reveals. Every one of them throws.
 *
 * @module EvaluationArchiveError
 */

export type EvaluationArchiveErrorReason =
  /** A record's `descriptorVersion` is not the version the reader expects. */
  | "DESCRIPTOR_VERSION_MISMATCH"
  /** A line is not JSON, or is missing/mistyping a required field. */
  | "MALFORMED_RECORD"
  /** A descriptor vector is not the fixed length its version declares. */
  | "DESCRIPTOR_LENGTH_MISMATCH"
  /** A caller offered a score that is not an exact, in-range evaluation. */
  | "INVALID_FIDELITY"
  /** The archive could not be read or written (permissions, disk, …). */
  | "IO_FAILURE";

export class EvaluationArchiveError extends Error {
  override readonly name = "EvaluationArchiveError";
  readonly reason: EvaluationArchiveErrorReason;

  constructor(message: string, reason: EvaluationArchiveErrorReason) {
    super(message);
    this.reason = reason;
  }
}
