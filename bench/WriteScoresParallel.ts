/**
 * Benchmark: writeScores parallelisation with async ensureDir.
 *
 * Issue #2315: Measures the cost of writeScores at production scale to
 * determine whether parallelising directory creation and file writes
 * provides meaningful improvement.
 *
 * Compares:
 * 1. Current implementation: ensureDirSync + async file writes via Promise.all
 * 2. Fully async: ensureDir (async) + async file writes via Promise.all
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env bench/WriteScoresParallel.ts
 */

import { ensureDir, ensureDirSync } from "@std/fs";
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

const TEMP_BASE = Deno.makeTempDirSync({
  prefix: "neat_writescores_parallel_",
});
let dirCounter = 0;

function makeTempDir(suffix: string): string {
  dirCounter++;
  const dir = `${TEMP_BASE}/${suffix}_${dirCounter}`;
  ensureDirSync(dir);
  return dir;
}

/** Build a population of creatures for benchmarking. */
function buildPopulation(size: number, complexity: number): Creature[] {
  const creatures: Creature[] = [];
  for (let i = 0; i < size; i++) {
    const c = new Creature(3, 1, { layers: [{ count: complexity }] });
    creatureValidate(c);
    c.score = -1.0 + i * (2.0 / size);
    // Pre-compute UUID so it's cached (realistic: UUIDs are computed earlier)
    CreatureUtil.makeUUID(c);
    creatures.push(c);
  }
  return creatures;
}

// ============================================
// Current: ensureDirSync + Promise.all writes
// ============================================

async function writeScoresSync(
  creatures: Creature[],
  baseStorePath: string,
): Promise<void> {
  const writes: Promise<void>[] = [];
  const createdDirs = new Set<string>();

  for (const creature of creatures) {
    const name = CreatureUtil.makeUUID(creature);
    const dirPath = baseStorePath + name.substring(0, 3);

    if (!createdDirs.has(dirPath)) {
      ensureDirSync(dirPath);
      createdDirs.add(dirPath);
    }

    const filePath = `${dirPath}/${name.substring(3)}.txt`;
    const scoreText = `${creature.score}`;

    writes.push(Deno.writeTextFile(filePath, scoreText));
  }

  await Promise.all(writes);
}

// ============================================
// Improved: two-phase async (group dirs, then writes)
// ============================================

async function writeScoresTwoPhase(
  creatures: Creature[],
  baseStorePath: string,
): Promise<void> {
  // Phase 1: Group creatures by directory and create dirs concurrently
  const dirGroups = new Map<
    string,
    { filePath: string; scoreText: string }[]
  >();

  for (const creature of creatures) {
    const name = CreatureUtil.makeUUID(creature);
    const dirPath = baseStorePath + name.substring(0, 3);
    const filePath = `${dirPath}/${name.substring(3)}.txt`;
    const scoreText = `${creature.score}`;

    if (!dirGroups.has(dirPath)) {
      dirGroups.set(dirPath, []);
    }
    dirGroups.get(dirPath)!.push({ filePath, scoreText });
  }

  // Create all unique directories concurrently
  await Promise.all(
    Array.from(dirGroups.keys()).map((dir) => ensureDir(dir)),
  );

  // Phase 2: Write all files concurrently
  const writes: Promise<void>[] = [];
  for (const entries of dirGroups.values()) {
    for (const entry of entries) {
      writes.push(Deno.writeTextFile(entry.filePath, entry.scoreText));
    }
  }
  await Promise.all(writes);
}

// ============================================
// Improved: inline async ensureDir per directory
// ============================================

async function writeScoresInlineAsync(
  creatures: Creature[],
  baseStorePath: string,
): Promise<void> {
  const writes: Promise<void>[] = [];
  const dirPromises = new Map<string, Promise<void>>();

  for (const creature of creatures) {
    const name = CreatureUtil.makeUUID(creature);
    const dirPath = baseStorePath + name.substring(0, 3);

    if (!dirPromises.has(dirPath)) {
      dirPromises.set(dirPath, ensureDir(dirPath));
    }

    const filePath = `${dirPath}/${name.substring(3)}.txt`;
    const scoreText = `${creature.score}`;

    // Chain the file write after its directory is created
    writes.push(
      dirPromises.get(dirPath)!.then(() =>
        Deno.writeTextFile(filePath, scoreText)
      ),
    );
  }

  await Promise.all(writes);
}

// ============================================
// Benchmarks
// ============================================

const pop200 = buildPopulation(200, 5);
const pop500 = buildPopulation(500, 5);

Deno.bench({
  name: "writeScores ensureDirSync (200 creatures)",
  group: "200 creatures",
  baseline: true,
  async fn() {
    const dir = makeTempDir("sync200");
    await writeScoresSync(pop200, dir + "/score/");
  },
});

Deno.bench({
  name: "writeScores two-phase async (200 creatures)",
  group: "200 creatures",
  async fn() {
    const dir = makeTempDir("twophase200");
    await writeScoresTwoPhase(pop200, dir + "/score/");
  },
});

Deno.bench({
  name: "writeScores inline async ensureDir (200 creatures)",
  group: "200 creatures",
  async fn() {
    const dir = makeTempDir("inline200");
    await writeScoresInlineAsync(pop200, dir + "/score/");
  },
});

Deno.bench({
  name: "writeScores ensureDirSync (500 creatures)",
  group: "500 creatures",
  baseline: true,
  async fn() {
    const dir = makeTempDir("sync500");
    await writeScoresSync(pop500, dir + "/score/");
  },
});

Deno.bench({
  name: "writeScores two-phase async (500 creatures)",
  group: "500 creatures",
  async fn() {
    const dir = makeTempDir("twophase500");
    await writeScoresTwoPhase(pop500, dir + "/score/");
  },
});

Deno.bench({
  name: "writeScores inline async ensureDir (500 creatures)",
  group: "500 creatures",
  async fn() {
    const dir = makeTempDir("inline500");
    await writeScoresInlineAsync(pop500, dir + "/score/");
  },
});
