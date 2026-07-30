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
  const trailingBytes = bytesRead % bytesPerRecord;
  if (trailingBytes !== 0) {
    throw new DatasetError(
      `training data file ${filePath} is not a whole number of records: ` +
        `read ${bytesRead} bytes at ${bytesPerRecord} bytes/record ` +
        `(${shape.inputs} inputs + ${shape.outputs} outputs) — ` +
        `Trailing ${trailingBytes} bytes (incomplete record)`,
      "CORRUPT_DATA",
      filePath,
    );
  }
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
