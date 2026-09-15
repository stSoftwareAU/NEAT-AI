import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  collectTestFiles,
  DEFAULT_TIMINGS_PATH,
  loadTimings,
  partitionTestFiles,
  planShards,
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

/**
 * Cost-weighted sharding (Issue #4017). Round-robin balances the *number* of
 * files per shard, not their cost, so a shard that collects several heavy
 * `evolve()` suites ran ~7m while the cheapest finished in ~1m15. These tests
 * exercise the longest-processing-time-first planner that replaces it.
 */

/** Total recorded cost of a slice, ignoring files with no recorded timing. */
function sliceCost(
  slice: string[],
  timings: Record<string, number>,
): number {
  return slice.reduce((sum, file) => sum + (timings[file] ?? 0), 0);
}

function maxShardCost(
  plan: string[][],
  timings: Record<string, number>,
): number {
  return Math.max(...plan.map((slice) => sliceCost(slice, timings)));
}

// One very heavy file plus a long tail — the shape that makes round-robin
// lopsided in CI.
const SKEWED_FILES = Array.from(
  { length: 24 },
  (_v, index) => `test/f${String(index).padStart(2, "0")}.ts`,
);
const SKEWED_TIMINGS: Record<string, number> = Object.fromEntries(
  SKEWED_FILES.map((file, index) => [file, index % 6 === 0 ? 60 : 1]),
);

Deno.test("planShards - without timings reproduces the round-robin partition", () => {
  const plan = planShards(SAMPLE, 3);
  for (let shard = 0; shard < 3; shard++) {
    assertEquals(plan[shard], partitionTestFiles(SAMPLE, 3, shard));
  }
});

Deno.test("planShards - cost-weighted plan is far flatter than round-robin", () => {
  const total = 4;
  const roundRobin = planShards(SKEWED_FILES, total);
  const weighted = planShards(SKEWED_FILES, total, SKEWED_TIMINGS);
  const before = maxShardCost(roundRobin, SKEWED_TIMINGS);
  const after = maxShardCost(weighted, SKEWED_TIMINGS);
  const totalCost = sliceCost(SKEWED_FILES, SKEWED_TIMINGS);
  assert(
    after < before,
    `weighted max shard (${after}s) must beat round-robin (${before}s)`,
  );
  // The theoretical floor is the larger of the perfect split and the single
  // heaviest file; LPT must land within 15% of it.
  const floor = Math.max(totalCost / total, 60);
  assert(
    after <= floor * 1.15,
    `weighted max shard ${after}s must be near the ${floor}s floor`,
  );
});

Deno.test("planShards - every file is assigned exactly once when weighted", () => {
  const plan = planShards(SKEWED_FILES, 5, SKEWED_TIMINGS);
  const union = plan.flat();
  assertEquals(union.length, SKEWED_FILES.length, "no duplicates, no gaps");
  assertEquals([...union].sort(), [...SKEWED_FILES].sort());
});

Deno.test("planShards - untimed files fall back to round-robin", () => {
  // Only the first file has a timing; the rest must land by sorted index.
  const timings = { [SKEWED_FILES[0]]: 5 };
  const total = 4;
  const plan = planShards(SKEWED_FILES, total, timings);
  const untimed = SKEWED_FILES.slice(1);
  untimed.forEach((file, index) => {
    assert(
      plan[index % total].includes(file),
      `${file} must round-robin onto shard ${index % total}`,
    );
  });
});

Deno.test("planShards - spreads zero-cost files instead of piling them up", () => {
  // Fixtures and helpers that declare no test measure 0s. They carry no signal
  // for the packer, so they must be dealt round-robin rather than all landing
  // on whichever shard is momentarily cheapest.
  const free = Array.from({ length: 16 }, (_v, i) => `test/free${i}.ts`);
  const timings: Record<string, number> = {
    ...SKEWED_TIMINGS,
    ...Object.fromEntries(free.map((file) => [file, 0])),
  };
  const total = 4;
  const plan = planShards([...SKEWED_FILES, ...free].sort(), total, timings);
  const perShard = plan.map((slice) =>
    slice.filter((file) => file.startsWith("test/free")).length
  );
  assert(
    Math.max(...perShard) - Math.min(...perShard) <= 1,
    `zero-cost files must spread evenly, got ${perShard}`,
  );
});

Deno.test("planShards - charges an unmeasured file the mean, not the median", () => {
  // Long-tailed costs: median 1s against a mean of 8.25s. Charging the median
  // would leave the new file's shard looking almost empty, so the cheap tail
  // would pile on top of it; charging the mean reserves the room.
  const timings = {
    "test/heavy.ts": 30,
    "test/t1.ts": 1,
    "test/t2.ts": 1,
    "test/t3.ts": 1,
  };
  const files = [...Object.keys(timings), "test/brand-new.ts"].sort();
  const plan = planShards(files, 3, timings);
  const fresh = plan.find((slice) => slice.includes("test/brand-new.ts"))!;
  assertEquals(
    fresh,
    ["test/brand-new.ts"],
    "a shard holding an unmeasured file must not also take the cheap tail",
  );
});

Deno.test("planShards - fails loud on a corrupt timing entry", () => {
  assertThrows(
    () => planShards(SAMPLE, 2, { [SAMPLE[0]]: -1 }),
    Error,
    "non-negative",
  );
  assertThrows(
    () => planShards(SAMPLE, 2, { [SAMPLE[0]]: Number.NaN }),
    Error,
  );
});

Deno.test("planShards - ignores timings for files that are not in the list", () => {
  const timings = { "test/deleted.ts": 999, [SAMPLE[0]]: 3 };
  const plan = planShards(SAMPLE, 3, timings);
  assert(
    !plan.flat().includes("test/deleted.ts"),
    "a stale timing entry must never introduce a file",
  );
  assertEquals(plan.flat().length, SAMPLE.length);
});

Deno.test("planShards - is deterministic with timings", () => {
  assertEquals(
    planShards(SKEWED_FILES, 3, SKEWED_TIMINGS),
    planShards(SKEWED_FILES, 3, SKEWED_TIMINGS),
  );
});

Deno.test("planShards - rejects a non-positive total", () => {
  assertThrows(() => planShards(SAMPLE, 0), Error);
  assertThrows(() => planShards(SAMPLE, 2.5), Error);
});

Deno.test("partitionTestFiles - weighted slice equals the planned shard", () => {
  const plan = planShards(SKEWED_FILES, 4, SKEWED_TIMINGS);
  for (let shard = 0; shard < 4; shard++) {
    assertEquals(
      partitionTestFiles(SKEWED_FILES, 4, shard, SKEWED_TIMINGS),
      plan[shard],
    );
  }
});

Deno.test("verifyShardCoverage - holds for the cost-weighted partition", () => {
  verifyShardCoverage(SKEWED_FILES, 8, SKEWED_TIMINGS);
  verifyShardCoverage(SKEWED_FILES, 1, SKEWED_TIMINGS);
  verifyShardCoverage(SKEWED_FILES, SKEWED_FILES.length + 3, SKEWED_TIMINGS);
});

Deno.test("loadTimings - reads a committed timings document", async () => {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        version: 1,
        unit: "seconds",
        files: { "test/a.ts": 1.25 },
      }),
    );
    assertEquals(await loadTimings(path), { "test/a.ts": 1.25 });
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("loadTimings - fails loud on a malformed document", async () => {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(path, JSON.stringify({ files: "not-a-map" }));
    await assertRejects(() => loadTimings(path), Error);
    await Deno.writeTextFile(
      path,
      JSON.stringify({ files: { "test/a.ts": "slow" } }),
    );
    await assertRejects(() => loadTimings(path), Error);
    await Deno.writeTextFile(path, "{ not json");
    await assertRejects(() => loadTimings(path), Error);
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("loadTimings - refuses a document in another unit or version", async () => {
  // A future document that switched to milliseconds, or changed layout, would
  // otherwise misplan in silence.
  const path = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(
      path,
      JSON.stringify({ version: 1, unit: "ms", files: { "test/a.ts": 1 } }),
    );
    await assertRejects(() => loadTimings(path), Error, "seconds");
    await Deno.writeTextFile(
      path,
      JSON.stringify({ version: 2, unit: "seconds", files: {} }),
    );
    await assertRejects(() => loadTimings(path), Error, "version");
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("loadTimings - fails loud when the file is missing", async () => {
  await assertRejects(
    () => loadTimings("scripts/does-not-exist-timings.json"),
    Deno.errors.NotFound,
  );
});

Deno.test("committed timings flatten the real 8-shard partition", async () => {
  const files = await collectTestFiles("test");
  const timings = await loadTimings(DEFAULT_TIMINGS_PATH);
  const roundRobin = planShards(files, 8);
  const weighted = planShards(files, 8, timings);
  verifyShardCoverage(files, 8, timings);
  const before = maxShardCost(roundRobin, timings);
  const after = maxShardCost(weighted, timings);
  // `<=`, not `<`: a map that has drifted so far that nothing listed is still
  // on disk degrades to round-robin, which is a slow build, never a red one.
  assert(
    after <= before,
    `weighted max shard (${after.toFixed(1)}s) must not be worse than ` +
      `round-robin (${before.toFixed(1)}s)`,
  );
  // The floor is the heaviest single file — no split can beat it — so compare
  // against that rather than an absolute wall-clock budget.
  const heaviest = Math.max(...files.map((f) => timings[f] ?? 0));
  const totalCost = sliceCost(files, timings);
  const floor = Math.max(heaviest, totalCost / 8);
  // 4/3 is the proven worst case for longest-processing-time-first against the
  // optimum, so this holds for any timings data rather than only today's.
  assert(
    after <= floor * (4 / 3),
    `weighted max shard ${after.toFixed(1)}s must be within the LPT bound of ` +
      `the ${floor.toFixed(1)}s floor`,
  );
  // Isolating the one heaviest file is not enough on its own: the shards that
  // do NOT hold it must be flat too, or the second-slowest shard becomes the
  // next bottleneck the moment that file is split up (#4026).
  const costs = weighted.map((slice) => sliceCost(slice, timings));
  const heaviestShard = costs.indexOf(Math.max(...costs));
  const rest = costs.filter((_cost, shard) => shard !== heaviestShard);
  const restEven = rest.reduce((sum, cost) => sum + cost, 0) / rest.length;
  assert(
    Math.max(...rest) <= restEven * 1.5,
    `the remaining shards must be flat: ${
      rest.map((c) => c.toFixed(0)).join(", ")
    } against an even ${restEven.toFixed(0)}s`,
  );
});
