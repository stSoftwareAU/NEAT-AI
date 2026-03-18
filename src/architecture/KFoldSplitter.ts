/**
 * KFoldSplitter.ts - K-fold cross-validation data splitting.
 *
 * Issue #1865: Splits binary training data into k folds for
 * cross-validation. Each fold produces a training directory (k-1 folds)
 * and a validation directory (1 fold), enabling more robust fitness
 * evaluation during evolution.
 */

import { ValidationError } from "../errors/ValidationError.ts";

/**
 * Describes a single fold split with training and validation data directories.
 */
export interface FoldSplit {
  /** Directory containing training data (k-1 folds combined). */
  trainDir: string;
  /** Directory containing validation data (1 held-out fold). */
  validationDir: string;
}

/**
 * Collects all binary records from a data directory.
 *
 * @param dataDir - Directory containing .bin training files
 * @param bytesPerRecord - Number of bytes per record
 * @returns Array of Uint8Array records
 */
function collectRecords(
  dataDir: string,
  bytesPerRecord: number,
): Uint8Array[] {
  const records: Uint8Array[] = [];

  for (const dirEntry of Deno.readDirSync(dataDir)) {
    if (!dirEntry.isFile || !dirEntry.name.endsWith(".bin")) continue;

    const filePath = `${dataDir}/${dirEntry.name}`;
    const fileData = Deno.readFileSync(filePath);

    const recordCount = Math.floor(fileData.byteLength / bytesPerRecord);
    for (let i = 0; i < recordCount; i++) {
      const start = i * bytesPerRecord;
      records.push(new Uint8Array(fileData.buffer, start, bytesPerRecord));
    }
  }

  return records;
}

/**
 * Writes records to a new temporary directory as binary files,
 * respecting the partition break size.
 *
 * @param records - Array of binary records to write
 * @param partitionBreak - Maximum records per binary file
 * @param prefix - Prefix for the temporary directory name
 * @returns Path to the created directory
 */
function writeRecordsToDir(
  records: Uint8Array[],
  partitionBreak: number,
  prefix: string,
): string {
  const dir = Deno.makeTempDirSync({ prefix });

  let fileIndex = 0;
  for (let offset = 0; offset < records.length; offset += partitionBreak) {
    const chunk = records.slice(offset, offset + partitionBreak);
    if (chunk.length === 0) break;

    const totalBytes = chunk.reduce((sum, r) => sum + r.byteLength, 0);
    const combined = new Uint8Array(totalBytes);
    let pos = 0;
    for (const record of chunk) {
      combined.set(record, pos);
      pos += record.byteLength;
    }

    const filePath = `${dir}/${fileIndex}.bin`;
    Deno.writeFileSync(filePath, combined);
    fileIndex++;
  }

  return dir;
}

/**
 * Splits training data into k folds for cross-validation.
 *
 * When k=1, returns a single fold where trainDir equals the original
 * dataDir and validationDir is undefined (backward compatible).
 *
 * @param dataDir - Source directory containing binary training data
 * @param inputCount - Number of input values per record
 * @param outputCount - Number of output values per record
 * @param folds - Number of folds (k). Must be >= 1 and <= 20.
 * @param partitionBreak - Maximum records per binary file (default 2000)
 * @returns Array of FoldSplit objects, one per fold
 */
export function createKFoldSplits(
  dataDir: string,
  inputCount: number,
  outputCount: number,
  folds: number,
  partitionBreak = 2000,
): FoldSplit[] {
  if (folds < 1 || folds > 20) {
    throw new ValidationError(
      `Number of folds must be between 1 and 20, got: ${folds}`,
      "OTHER",
    );
  }

  if (!Number.isInteger(folds)) {
    throw new ValidationError(
      `Number of folds must be an integer, got: ${folds}`,
      "OTHER",
    );
  }

  // k=1: no splitting, use original data directory for training
  if (folds === 1) {
    return [{ trainDir: dataDir, validationDir: dataDir }];
  }

  const bytesPerRecord = (inputCount + outputCount) * 4; // Float32 = 4 bytes
  const records = collectRecords(dataDir, bytesPerRecord);

  if (records.length < folds) {
    throw new ValidationError(
      `Not enough records (${records.length}) for ${folds}-fold cross-validation. ` +
        `Need at least ${folds} records.`,
      "OTHER",
    );
  }

  // Calculate fold boundaries
  const foldSize = Math.floor(records.length / folds);
  const remainder = records.length % folds;

  const foldBoundaries: number[] = [0];
  for (let i = 0; i < folds; i++) {
    // Distribute remainder records across the first folds
    const size = foldSize + (i < remainder ? 1 : 0);
    foldBoundaries.push(foldBoundaries[i] + size);
  }

  const splits: FoldSplit[] = [];

  for (
    let validationFoldIndex = 0;
    validationFoldIndex < folds;
    validationFoldIndex++
  ) {
    const validationStart = foldBoundaries[validationFoldIndex];
    const validationEnd = foldBoundaries[validationFoldIndex + 1];

    const validationRecords = records.slice(validationStart, validationEnd);
    const trainingRecords: Uint8Array[] = [];

    // Collect all records except the validation fold
    for (let i = 0; i < folds; i++) {
      if (i === validationFoldIndex) continue;
      const start = foldBoundaries[i];
      const end = foldBoundaries[i + 1];
      for (let j = start; j < end; j++) {
        trainingRecords.push(records[j]);
      }
    }

    const trainDir = writeRecordsToDir(
      trainingRecords,
      partitionBreak,
      `cv-fold${validationFoldIndex}-train-`,
    );
    const validationDir = writeRecordsToDir(
      validationRecords,
      partitionBreak,
      `cv-fold${validationFoldIndex}-val-`,
    );

    splits.push({ trainDir, validationDir });
  }

  return splits;
}

/**
 * Cleans up temporary directories created by createKFoldSplits.
 *
 * @param splits - Array of FoldSplit objects to clean up
 * @param originalDataDir - The original data directory (not cleaned up)
 */
export function cleanupFoldSplits(
  splits: FoldSplit[],
  originalDataDir: string,
): void {
  for (const split of splits) {
    if (split.trainDir !== originalDataDir) {
      try {
        Deno.removeSync(split.trainDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    if (split.validationDir !== originalDataDir) {
      try {
        Deno.removeSync(split.validationDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
