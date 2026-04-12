/**
 * DatasetFileListCache.ts - Worker-local cache for dataset file lists.
 *
 * Issue #2260: Avoids repeated `Deno.readDirSync` calls when the dataset
 * directory is stable across many `evaluateDir` invocations (e.g. inside
 * long-lived worker threads).
 */

import { dataFiles } from "@architecture/Training.ts";

/**
 * Caches the sorted list of binary data files for a given directory.
 *
 * Workers are long-lived and the dataset directory does not change between
 * evaluate calls. This cache stores the result of `dataFiles()` so that
 * repeated directory scans are eliminated.
 */
export class DatasetFileListCache {
  private cachedDir: string | null = null;
  private cachedFiles: string[] | null = null;

  /**
   * Returns the cached file list for `dataDir`, scanning only on the first
   * call or when the directory changes.
   *
   * The files are returned in sorted (deterministic) order because evaluation
   * does not require random shuffling — it computes an average over all records.
   */
  getFiles(dataDir: string): string[] {
    if (this.cachedDir === dataDir && this.cachedFiles !== null) {
      return this.cachedFiles;
    }

    const result = dataFiles(dataDir, { disableRandomSamples: true });
    this.cachedFiles = result.files;
    this.cachedDir = dataDir;
    return this.cachedFiles;
  }

  /** Clears the cache, forcing a fresh directory scan on the next call. */
  clear(): void {
    this.cachedDir = null;
    this.cachedFiles = null;
  }
}
