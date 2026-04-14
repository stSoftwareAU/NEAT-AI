/**
 * Issue #2275 - Benchmark synchronous vs async disk I/O in the evolution loop.
 *
 * Compares:
 * 1. writeScores: sync vs async writes, with/without directory caching
 * 2. Checkpoint writing: pretty-print vs compact JSON, sync vs async writes
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env bench/DiskIOEvolutionLoop.ts
 */

import { emptyDirSync, ensureDirSync } from "@std/fs";
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

// ---------------------------------------------------------------------------
// Setup: create temporary directories and a test population
// ---------------------------------------------------------------------------

const TEMP_BASE = Deno.makeTempDirSync({ prefix: "neat_io_bench_" });

function makeTempDir(suffix: string): string {
  const dir = `${TEMP_BASE}/${suffix}`;
  ensureDirSync(dir);
  return dir;
}

/** Build a population of simple creatures for benchmarking. */
function buildPopulation(size: number): Creature[] {
  const population: Creature[] = [];
  for (let i = 0; i < size; i++) {
    const c = new Creature(5, 3, { layers: [{ count: 10 }] });
    creatureValidate(c);
    c.score = Math.random() * 100 - 50;
    population.push(c);
  }
  return population;
}

// Pre-build populations of various sizes
const pop100 = buildPopulation(100);
const pop300 = buildPopulation(300);
const pop500 = buildPopulation(500);

// Pre-compute UUIDs so UUID generation does not dominate benchmarks
for (const pop of [pop100, pop300, pop500]) {
  for (const c of pop) {
    CreatureUtil.makeUUID(c);
  }
}

// ---------------------------------------------------------------------------
// Benchmark group 1: writeScores — sync baseline
// ---------------------------------------------------------------------------

function writeScoresSync(
  creatures: Creature[],
  baseStorePath: string,
): void {
  for (const creature of creatures) {
    const name = CreatureUtil.makeUUID(creature);
    const dirPath = baseStorePath + name.substring(0, 3);
    ensureDirSync(dirPath);
    const filePath = `${dirPath}/${name.substring(3)}.txt`;
    Deno.writeTextFileSync(filePath, `${creature.score}`);
  }
}

/** Async writes with Promise.all + directory creation cache. */
async function writeScoresAsync(
  creatures: Creature[],
  baseStorePath: string,
): Promise<void> {
  const createdDirs = new Set<string>();
  const writes: Promise<void>[] = [];

  for (const creature of creatures) {
    const name = CreatureUtil.makeUUID(creature);
    const dirPath = baseStorePath + name.substring(0, 3);

    if (!createdDirs.has(dirPath)) {
      ensureDirSync(dirPath);
      createdDirs.add(dirPath);
    }

    const filePath = `${dirPath}/${name.substring(3)}.txt`;
    writes.push(Deno.writeTextFile(filePath, `${creature.score}`));
  }

  await Promise.all(writes);
}

/** Sync writes with directory creation cache only. */
function writeScoresCachedDirs(
  creatures: Creature[],
  baseStorePath: string,
): void {
  const createdDirs = new Set<string>();

  for (const creature of creatures) {
    const name = CreatureUtil.makeUUID(creature);
    const dirPath = baseStorePath + name.substring(0, 3);

    if (!createdDirs.has(dirPath)) {
      ensureDirSync(dirPath);
      createdDirs.add(dirPath);
    }

    const filePath = `${dirPath}/${name.substring(3)}.txt`;
    Deno.writeTextFileSync(filePath, `${creature.score}`);
  }
}

// --- writeScores: population 100 ---

const scoresDir100Sync = makeTempDir("scores_100_sync");
const scoresDir100Async = makeTempDir("scores_100_async");
const scoresDir100Cached = makeTempDir("scores_100_cached");

Deno.bench({
  name: "writeScores sync (pop 100)",
  group: "writeScores-100",
  baseline: true,
  fn() {
    writeScoresSync(pop100, scoresDir100Sync + "/");
  },
});

Deno.bench({
  name: "writeScores async+cached dirs (pop 100)",
  group: "writeScores-100",
  async fn() {
    await writeScoresAsync(pop100, scoresDir100Async + "/");
  },
});

Deno.bench({
  name: "writeScores sync+cached dirs (pop 100)",
  group: "writeScores-100",
  fn() {
    writeScoresCachedDirs(pop100, scoresDir100Cached + "/");
  },
});

// --- writeScores: population 300 ---

const scoresDir300Sync = makeTempDir("scores_300_sync");
const scoresDir300Async = makeTempDir("scores_300_async");
const scoresDir300Cached = makeTempDir("scores_300_cached");

Deno.bench({
  name: "writeScores sync (pop 300)",
  group: "writeScores-300",
  baseline: true,
  fn() {
    writeScoresSync(pop300, scoresDir300Sync + "/");
  },
});

Deno.bench({
  name: "writeScores async+cached dirs (pop 300)",
  group: "writeScores-300",
  async fn() {
    await writeScoresAsync(pop300, scoresDir300Async + "/");
  },
});

Deno.bench({
  name: "writeScores sync+cached dirs (pop 300)",
  group: "writeScores-300",
  fn() {
    writeScoresCachedDirs(pop300, scoresDir300Cached + "/");
  },
});

// --- writeScores: population 500 ---

const scoresDir500Sync = makeTempDir("scores_500_sync");
const scoresDir500Async = makeTempDir("scores_500_async");
const scoresDir500Cached = makeTempDir("scores_500_cached");

Deno.bench({
  name: "writeScores sync (pop 500)",
  group: "writeScores-500",
  baseline: true,
  fn() {
    writeScoresSync(pop500, scoresDir500Sync + "/");
  },
});

Deno.bench({
  name: "writeScores async+cached dirs (pop 500)",
  group: "writeScores-500",
  async fn() {
    await writeScoresAsync(pop500, scoresDir500Async + "/");
  },
});

Deno.bench({
  name: "writeScores sync+cached dirs (pop 500)",
  group: "writeScores-500",
  fn() {
    writeScoresCachedDirs(pop500, scoresDir500Cached + "/");
  },
});

// ---------------------------------------------------------------------------
// Benchmark group 2: Checkpoint writing — JSON serialisation + file I/O
// ---------------------------------------------------------------------------

/** Pre-export JSON for checkpoint benchmarks (avoids measuring export time). */
function preExportPopulation(
  pop: Creature[],
): ReturnType<Creature["exportJSON"]>[] {
  return pop.map((c) => c.exportJSON());
}

const jsonPop100 = preExportPopulation(pop100);
const jsonPop300 = preExportPopulation(pop300);

// --- JSON.stringify: pretty vs compact ---

Deno.bench({
  name: "JSON.stringify pretty-print (pop 100)",
  group: "json-stringify",
  baseline: true,
  fn() {
    for (const json of jsonPop100) {
      JSON.stringify(json, null, 1);
    }
  },
});

Deno.bench({
  name: "JSON.stringify compact (pop 100)",
  group: "json-stringify",
  fn() {
    for (const json of jsonPop100) {
      JSON.stringify(json);
    }
  },
});

// --- Checkpoint write: sync pretty vs sync compact vs async compact ---

function writeCheckpointSyncPretty(
  jsons: ReturnType<Creature["exportJSON"]>[],
  dir: string,
): void {
  emptyDirSync(dir);
  let counter = 1;
  for (const json of jsons) {
    const txt = JSON.stringify(json, null, 1);
    Deno.writeTextFileSync(`${dir}/${counter}.json`, txt);
    counter++;
  }
}

function writeCheckpointSyncCompact(
  jsons: ReturnType<Creature["exportJSON"]>[],
  dir: string,
): void {
  emptyDirSync(dir);
  let counter = 1;
  for (const json of jsons) {
    const txt = JSON.stringify(json);
    Deno.writeTextFileSync(`${dir}/${counter}.json`, txt);
    counter++;
  }
}

async function writeCheckpointAsyncCompact(
  jsons: ReturnType<Creature["exportJSON"]>[],
  dir: string,
): Promise<void> {
  emptyDirSync(dir);
  const writes: Promise<void>[] = [];
  let counter = 1;
  for (const json of jsons) {
    const txt = JSON.stringify(json);
    writes.push(Deno.writeTextFile(`${dir}/${counter}.json`, txt));
    counter++;
  }
  await Promise.all(writes);
}

async function writeCheckpointAtomicAsync(
  jsons: ReturnType<Creature["exportJSON"]>[],
  dir: string,
): Promise<void> {
  const tmpDir = dir + ".tmp";
  ensureDirSync(tmpDir);
  emptyDirSync(tmpDir);

  const writes: Promise<void>[] = [];
  let counter = 1;
  for (const json of jsons) {
    const txt = JSON.stringify(json);
    writes.push(Deno.writeTextFile(`${tmpDir}/${counter}.json`, txt));
    counter++;
  }
  await Promise.all(writes);

  // Atomic swap: remove old dir, rename tmp to target
  try {
    await Deno.remove(dir, { recursive: true });
  } catch {
    // Directory might not exist on first run
  }
  await Deno.rename(tmpDir, dir);
}

// --- Checkpoint: population 100 ---

const cpDir100SyncPretty = makeTempDir("cp_100_sync_pretty");
const cpDir100SyncCompact = makeTempDir("cp_100_sync_compact");
const cpDir100AsyncCompact = makeTempDir("cp_100_async_compact");
const cpDir100AtomicAsync = makeTempDir("cp_100_atomic_async");

Deno.bench({
  name: "checkpoint sync+pretty (pop 100)",
  group: "checkpoint-100",
  baseline: true,
  fn() {
    writeCheckpointSyncPretty(jsonPop100, cpDir100SyncPretty);
  },
});

Deno.bench({
  name: "checkpoint sync+compact (pop 100)",
  group: "checkpoint-100",
  fn() {
    writeCheckpointSyncCompact(jsonPop100, cpDir100SyncCompact);
  },
});

Deno.bench({
  name: "checkpoint async+compact (pop 100)",
  group: "checkpoint-100",
  async fn() {
    await writeCheckpointAsyncCompact(jsonPop100, cpDir100AsyncCompact);
  },
});

Deno.bench({
  name: "checkpoint atomic+async+compact (pop 100)",
  group: "checkpoint-100",
  async fn() {
    await writeCheckpointAtomicAsync(jsonPop100, cpDir100AtomicAsync);
  },
});

// --- Checkpoint: population 300 ---

const cpDir300SyncPretty = makeTempDir("cp_300_sync_pretty");
const cpDir300SyncCompact = makeTempDir("cp_300_sync_compact");
const cpDir300AsyncCompact = makeTempDir("cp_300_async_compact");
const cpDir300AtomicAsync = makeTempDir("cp_300_atomic_async");

Deno.bench({
  name: "checkpoint sync+pretty (pop 300)",
  group: "checkpoint-300",
  baseline: true,
  fn() {
    writeCheckpointSyncPretty(jsonPop300, cpDir300SyncPretty);
  },
});

Deno.bench({
  name: "checkpoint sync+compact (pop 300)",
  group: "checkpoint-300",
  fn() {
    writeCheckpointSyncCompact(jsonPop300, cpDir300SyncCompact);
  },
});

Deno.bench({
  name: "checkpoint async+compact (pop 300)",
  group: "checkpoint-300",
  async fn() {
    await writeCheckpointAsyncCompact(jsonPop300, cpDir300AsyncCompact);
  },
});

Deno.bench({
  name: "checkpoint atomic+async+compact (pop 300)",
  group: "checkpoint-300",
  async fn() {
    await writeCheckpointAtomicAsync(jsonPop300, cpDir300AtomicAsync);
  },
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

addEventListener("unload", () => {
  try {
    Deno.removeSync(TEMP_BASE, { recursive: true });
  } catch {
    // Best-effort cleanup
  }
});
