/**
 * DatasetIO.ts — Fail-loud helpers for reading binary training data.
 *
 * Issue #3412: When the training dataset directory or a `.bin` file vanishes
 * mid-run — e.g. a background disk-cleanup sweep `rm -rf`s `.trainData-binary/`
 * while a discovery iteration holds hundreds of files open — the underlying
 * `Deno.errors.NotFound` was previously either swallowed and re-surfaced far
 * downstream as `AssertionError: Error is not finite: Infinity`, or thrown as a
 * bare `NotFound` that did not name the dataset. These helpers translate the
 * I/O fault into a dedicated {@link DatasetError} that names the missing
 * file/directory, so the real cause fails loud and clear (Issue #3234 — never
 * fail silently) instead of a misleading numeric-stability assertion.
 *
 * Every non-`NotFound` error is re-thrown unchanged.
 *
 * @module DatasetIO
 */

import { DatasetError } from "@errors/DatasetError.ts";

/**
 * Opens a binary training file for reading, translating a vanished file into a
 * {@link DatasetError} that names the path.
 *
 * @param filePath - Absolute or relative path to the `.bin` file
 * @returns The opened file handle (caller owns closing it)
 * @throws {DatasetError} When the file no longer exists (`FILE_MISSING`)
 */
export function openDatasetFileSync(filePath: string): Deno.FsFile {
  try {
    return Deno.openSync(filePath, { read: true });
  } catch (error) {
    throw translateMissingFile(error, filePath);
  }
}

/**
 * Reads a binary training file in full, translating a vanished file into a
 * {@link DatasetError} that names the path.
 *
 * @param filePath - Absolute or relative path to the `.bin` file
 * @returns The file contents
 * @throws {DatasetError} When the file no longer exists (`FILE_MISSING`)
 */
export function readDatasetFileSync(filePath: string): Uint8Array {
  try {
    return Deno.readFileSync(filePath);
  } catch (error) {
    throw translateMissingFile(error, filePath);
  }
}

/** Record geometry a dataset file must line up with. */
export interface DatasetRecordShape {
  /** Bytes per record, `(inputs + outputs) * 4`. */
  bytesPerRecord: number;
  /** Creature input count, reported for context. */
  inputs: number;
  /** Creature output count, reported for context. */
  outputs: number;
}

/**
 * Confirm every cached `.bin` path still exists and — when `record` is given —
 * holds a whole number of records.
 *
 * `rust_scorer` reads the directory itself and ignores the TypeScript file
 * list. Without this check, a file that vanished between listing and scoring
 * is silently dropped on the native path (the remaining files still score)
 * while the WASM path throws {@link DatasetError} `FILE_MISSING`. Honour the
 * Issue #3412 contract on both backends before the native scorer runs.
 *
 * Issue #3831: the record-size check runs here too, off the same `stat`, so a
 * truncated file is classified as `CORRUPT_DATA` with the diagnostic that
 * names the file, the byte counts and the record size — whichever backend
 * would have scored it. Previously the native scorer hit the fault first and,
 * under `NEAT_AI_RUST_SCORER_STRICT=1`, the corrupt dataset surfaced as a
 * `ScorerStrictError` with the diagnostic lost.
 *
 * @param filePaths - Cached dataset file list (absolute or relative)
 * @param record - Optional record geometry to validate each file length against
 * @throws {DatasetError} When a file no longer exists (`FILE_MISSING`) or holds
 *   a partial trailing record (`CORRUPT_DATA`)
 */
export function assertDatasetFilesIntact(
  filePaths: readonly string[],
  record?: DatasetRecordShape,
): void {
  for (const filePath of filePaths) {
    let info: Deno.FileInfo;
    try {
      info = Deno.statSync(filePath);
    } catch (error) {
      throw translateMissingFile(error, filePath);
    }
    if (record === undefined) continue;
    if (info.size % record.bytesPerRecord !== 0) {
      throw partialRecordError(filePath, "holds", info.size, record);
    }
  }
}

/**
 * Lists the entries of a dataset directory, translating a vanished directory
 * into a {@link DatasetError} that names the path.
 *
 * The iterator is materialised into an array so a `NotFound` raised lazily
 * during iteration is caught here rather than escaping to the caller as a bare
 * runtime error.
 *
 * @param dataDir - Path to the dataset directory
 * @returns The directory entries
 * @throws {DatasetError} When the directory no longer exists (`DIRECTORY_MISSING`)
 */
export function readDatasetDirEntriesSync(dataDir: string): Deno.DirEntry[] {
  try {
    return Array.from(Deno.readDirSync(dataDir));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new DatasetError(
        `training data directory ${dataDir} disappeared mid-run`,
        "DIRECTORY_MISSING",
        dataDir,
      );
    }
    throw error;
  }
}

/**
 * Assert a read returned a whole number of records.
 *
 * Issue #3541: both dataset readers previously used
 * `assert(bytesRead % BYTES_PER_RECORD === 0, "Invalid number of bytes read")`,
 * which named neither the file nor any byte count. That bare message was the
 * one the operator saw when a corrupt corpus killed a run — one line after the
 * native Rust scorer's genuinely diagnostic `Trailing N bytes (incomplete
 * record)` had been demoted to a warning by the WASM "fallback".
 *
 * @param filePath - The `.bin` file being read
 * @param bytesRead - Bytes returned by the read
 * @param bytesPerRecord - Record size, `(inputs + outputs) * 4`
 * @param shape - Creature input/output counts, reported for context
 * @throws {DatasetError} With reason `CORRUPT_DATA` for a short/partial record
 */
export function assertWholeRecordRead(
  filePath: string,
  bytesRead: number,
  bytesPerRecord: number,
  shape: { inputs: number; outputs: number },
): void {
  if (bytesRead <= 0) {
    throw new DatasetError(
      `training data file ${filePath} returned ${bytesRead} bytes from a read`,
      "CORRUPT_DATA",
      filePath,
    );
  }
  if (bytesRead % bytesPerRecord !== 0) {
    throw partialRecordError(filePath, "read", bytesRead, {
      bytesPerRecord,
      inputs: shape.inputs,
      outputs: shape.outputs,
    });
  }
}

/**
 * Build the single canonical partial-record diagnostic, so a truncated file
 * reads the same whether the fault was found by the pre-flight length check or
 * mid-read (Issue #3831).
 *
 * @param filePath - The offending `.bin` file
 * @param verb - How `byteCount` was obtained (`"holds"` or `"read"`)
 * @param byteCount - Bytes the file holds, or the bytes a read returned
 * @param record - Record geometry the count failed to line up with
 */
function partialRecordError(
  filePath: string,
  verb: "holds" | "read",
  byteCount: number,
  record: DatasetRecordShape,
): DatasetError {
  const trailingBytes = byteCount % record.bytesPerRecord;
  return new DatasetError(
    `training data file ${filePath} is not a whole number of records: ` +
      `${verb} ${byteCount} bytes at ${record.bytesPerRecord} bytes/record ` +
      `(${record.inputs} inputs + ${record.outputs} outputs) — ` +
      `Trailing ${trailingBytes} bytes (incomplete record)`,
    "CORRUPT_DATA",
    filePath,
  );
}

function translateMissingFile(error: unknown, filePath: string): unknown {
  if (error instanceof Deno.errors.NotFound) {
    return new DatasetError(
      `training data file ${filePath} disappeared mid-run`,
      "FILE_MISSING",
      filePath,
    );
  }
  return error;
}
