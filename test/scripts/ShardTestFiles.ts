import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  collectTestFiles,
  partitionTestFiles,
  verifyShardCoverage,
} from "../../scripts/shard_test_files.ts";

/**
 * Tests for the CI shard partitioner (Issue #3173). These exercise the real
 * functions used by `.github/workflows/coverage.yaml` to split the
 * `test/**\/*.ts` suite across parallel matrix shards.
 */

const SAMPLE = [
  "test/a.ts",
  "test/b.ts",
  "test/c.ts",
  "test/d.ts",
  "test/e.ts",
  "test/f.ts",
  "test/g.ts",
];

Deno.test("partitionTestFiles - round-robin covers every file exactly once", () => {
  const total = 3;
  const union: string[] = [];
  for (let shard = 0; shard < total; shard++) {
    union.push(...partitionTestFiles(SAMPLE, total, shard));
  }
  union.sort();
  assertEquals(union, [...SAMPLE].sort(), "union of shards must equal input");
  assertEquals(
    new Set(union).size,
    SAMPLE.length,
    "no file may appear in more than one shard",
  );
});

Deno.test("partitionTestFiles - slices are balanced to within one file", () => {
  const total = 4;
  const sizes: number[] = [];
  for (let shard = 0; shard < total; shard++) {
    sizes.push(partitionTestFiles(SAMPLE, total, shard).length);
  }
  const max = Math.max(...sizes);
  const min = Math.min(...sizes);
  assert(max - min <= 1, `slice sizes must differ by <=1, got ${sizes}`);
});

Deno.test("partitionTestFiles - is deterministic", () => {
  const first = partitionTestFiles(SAMPLE, 3, 1);
  const second = partitionTestFiles(SAMPLE, 3, 1);
  assertEquals(first, second);
});

Deno.test("partitionTestFiles - shard 0 of 1 returns all files", () => {
  assertEquals(partitionTestFiles(SAMPLE, 1, 0), SAMPLE);
});

Deno.test("partitionTestFiles - rejects out-of-range shard/total", () => {
  assertThrows(() => partitionTestFiles(SAMPLE, 3, 3), Error);
  assertThrows(() => partitionTestFiles(SAMPLE, 3, -1), Error);
  assertThrows(() => partitionTestFiles(SAMPLE, 0, 0), Error);
  assertThrows(() => partitionTestFiles(SAMPLE, 1.5, 0), Error);
});

Deno.test("verifyShardCoverage - passes for a valid partition", () => {
  verifyShardCoverage(SAMPLE, 3);
  verifyShardCoverage(SAMPLE, 1);
  verifyShardCoverage(SAMPLE, SAMPLE.length);
});

Deno.test("verifyShardCoverage - rejects a non-positive total", () => {
  assertThrows(() => verifyShardCoverage(SAMPLE, 0), Error);
});

Deno.test("verifyShardCoverage - handles more shards than files (empty shards)", () => {
  // With total > file count, trailing shards are empty but every file is
  // still covered exactly once.
  verifyShardCoverage(SAMPLE, SAMPLE.length + 3);
});

Deno.test("collectTestFiles - discovers the real test suite, sorted", async () => {
  const files = await collectTestFiles("test");
  assert(files.length > 100, `expected the real suite, got ${files.length}`);
  assert(
    files.every((f) => f.endsWith(".ts")),
    "every discovered file must be a .ts module",
  );
  assert(
    files.includes("test/scripts/ShardTestFiles.ts"),
    "this test file itself should be discovered",
  );
  const sorted = [...files].sort();
  assertEquals(files, sorted, "collectTestFiles must return a sorted list");
});

Deno.test("collectTestFiles + verifyShardCoverage - real suite has no gaps or double-runs across 8 shards", async () => {
  const files = await collectTestFiles("test");
  // Mirrors the CI file-count parity gate: every test/**/*.ts runs exactly once.
  verifyShardCoverage(files, 8);
});
