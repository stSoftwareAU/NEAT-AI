/**
 * Benchmark for writeScores directory creation caching.
 *
 * Issue #2279: Measures the overhead of calling ensureDirSync() for every
 * creature vs caching created directories with a Set. Many creatures share
 * the same 3-character UUID prefix, so a Set avoids redundant filesystem
 * syscalls.
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/WriteScoresDirCache.ts
 */
import { ensureDirSync } from "@std/fs";

/**
 * Generates random 3-character hex prefixes (simulating UUID prefixes).
 * With 3 hex characters, there are 4,096 possible prefixes.
 * For a population of 100-500, most creatures share directory prefixes.
 */
function generatePrefixes(count: number): string[] {
  const prefixes: string[] = [];
  for (let i = 0; i < count; i++) {
    // Simulate UUID-style prefix: 3 hex characters
    const hex = (i * 7 + 13) % 256; // Deterministic, clustered
    prefixes.push(hex.toString(16).padStart(3, "0"));
  }
  return prefixes;
}

const tmpDir = Deno.makeTempDirSync({ prefix: "neat_bench_writescores_" });

// ============================================
// Uncached: ensureDirSync every iteration
// ============================================

Deno.bench({
  name: "ensureDirSync every creature (100 creatures)",
  group: "100 creatures",
  baseline: true,
  fn() {
    const prefixes = generatePrefixes(100);
    for (const prefix of prefixes) {
      const dirPath = `${tmpDir}/uncached/${prefix}`;
      ensureDirSync(dirPath);
    }
  },
});

Deno.bench({
  name: "Set-cached ensureDirSync (100 creatures)",
  group: "100 creatures",
  fn() {
    const prefixes = generatePrefixes(100);
    const createdDirs = new Set<string>();
    for (const prefix of prefixes) {
      const dirPath = `${tmpDir}/cached/${prefix}`;
      if (!createdDirs.has(dirPath)) {
        ensureDirSync(dirPath);
        createdDirs.add(dirPath);
      }
    }
  },
});

// ============================================
// Larger population: 500 creatures
// ============================================

Deno.bench({
  name: "ensureDirSync every creature (500 creatures)",
  group: "500 creatures",
  baseline: true,
  fn() {
    const prefixes = generatePrefixes(500);
    for (const prefix of prefixes) {
      const dirPath = `${tmpDir}/uncached500/${prefix}`;
      ensureDirSync(dirPath);
    }
  },
});

Deno.bench({
  name: "Set-cached ensureDirSync (500 creatures)",
  group: "500 creatures",
  fn() {
    const prefixes = generatePrefixes(500);
    const createdDirs = new Set<string>();
    for (const prefix of prefixes) {
      const dirPath = `${tmpDir}/cached500/${prefix}`;
      if (!createdDirs.has(dirPath)) {
        ensureDirSync(dirPath);
        createdDirs.add(dirPath);
      }
    }
  },
});
