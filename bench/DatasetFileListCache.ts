/**
 * Benchmark for dataset file list caching (Issue #2260).
 *
 * Compares the cost of scanning a data directory with `dataFiles()` on every
 * call versus using a `DatasetFileListCache` that memoises the sorted file
 * list across repeated invocations.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env bench/DatasetFileListCache.ts
 */

import { dataFiles } from "@architecture/Training.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import { DatasetFileListCache } from "@architecture/DatasetFileListCache.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";

/** Create a dataset directory with many small .bin partition files. */
function createBenchDataDir(
  partitionCount: number,
  recordsPerPartition: number,
): string {
  const totalRecords = partitionCount * recordsPerPartition;
  const dataSet: DataRecordInterface[] = [];
  for (let i = 0; i < totalRecords; i++) {
    dataSet.push({
      input: new Float32Array([i * 0.1, i * 0.2, i * 0.3]),
      output: new Float32Array([i * 0.4]),
    });
  }
  return makeDataDir(dataSet, recordsPerPartition);
}

// Create a dataset directory with 50 partition files (simulates many small files).
const dataDir = createBenchDataDir(50, 100);

Deno.bench({
  name: "dataFiles() — uncached directory scan (50 files)",
  group: "dataset file list lookup",
  baseline: true,
  fn() {
    dataFiles(dataDir, { disableRandomSamples: true });
  },
});

const cache = new DatasetFileListCache();
// Warm the cache with a single call.
cache.getFiles(dataDir);

Deno.bench({
  name: "DatasetFileListCache.getFiles() — cached (50 files)",
  group: "dataset file list lookup",
  fn() {
    cache.getFiles(dataDir);
  },
});

// Cleanup after all benchmarks complete.
addEventListener("unload", () => {
  try {
    Deno.removeSync(dataDir, { recursive: true });
  } catch {
    // Best-effort cleanup.
  }
});
