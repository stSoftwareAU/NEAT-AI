/**
 * Typed error for vanished / unreadable training datasets.
 *
 * Issue #3412: When the training dataset directory or a `.bin` file is deleted
 * out from under a running discovery (files vanish mid-read), the raw
 * `Deno.errors.NotFound` was previously swallowed downstream and re-surfaced as
 * a misleading `AssertionError: Error is not finite: Infinity`. A `DatasetError`
 * fails loud and clear (Issue #3234 — never fail silently), naming the missing
 * file/directory so the operator debugs the real fault rather than a
 * numeric-stability assertion.
 *
 * Consumers can catch `DatasetError` and inspect `reason` / `path` to handle
 * specific failure modes programmatically.
 *
 * @module DatasetError
 */

export type DatasetErrorReason =
  /** The dataset directory itself is gone (e.g. `rm -rf` mid-run). */
  | "DIRECTORY_MISSING"
  /** A `.bin` file disappeared between listing and reading it. */
  | "FILE_MISSING"
  /** The directory exists but holds no `.bin` training files. */
  | "NO_DATA_FILES";

export class DatasetError extends Error {
  override readonly name = "DatasetError";
  readonly reason: DatasetErrorReason;
  /** The dataset file or directory path that could not be read. */
  readonly path: string;

  constructor(message: string, reason: DatasetErrorReason, path: string) {
    super(message);
    this.reason = reason;
    this.path = path;
  }
}
