/**
 * Typed error for CRISPR gene-editing operations.
 *
 * Consumers can catch `CrisprError` and inspect `code` to handle
 * specific failure modes programmatically — for example, distinguishing
 * invalid DNA from missing UUIDs or topology problems.
 *
 * @module CrisprError
 */

export type CrisprErrorCode =
  | "INVALID_DNA"
  | "MISSING_UUID"
  | "INVALID_CONNECTION"
  | "TOPOLOGY_ERROR";

export class CrisprError extends Error {
  override readonly name = "CrisprError";
  readonly code: CrisprErrorCode;

  constructor(message: string, code: CrisprErrorCode) {
    super(message);
    this.code = code;
  }
}
