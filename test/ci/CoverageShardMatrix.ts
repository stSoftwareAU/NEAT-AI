import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Verifies the sharded structure of `.github/workflows/coverage.yaml`
 * (Issue #3173). The coverage suite is partitioned across a parallel matrix
 * of shards, then a merge job aggregates the partial coverage + JUnit reports
 * into a single Codecov coverage report and one consolidated Test Results
 * check.
 *
 * The critical invariant is parity: the workflow-level `SHARD_TOTAL` env MUST
 * equal the number of matrix shards, and the shard indices MUST be exactly
 * `0 … SHARD_TOTAL-1`. A mismatch would make scripts/shard_test_files.ts
 * partition into the wrong number of buckets, silently dropping or
 * double-running test files.
 *
 * This is a "what" test: it parses the committed workflow YAML and asserts on
 * the resulting configuration.
 */

interface Strategy {
  "fail-fast"?: boolean;
  matrix?: { shard?: number[] };
}

interface Job {
  name?: string;
  needs?: string | string[];
  "if"?: string;
  strategy?: Strategy;
}

interface Workflow {
  env?: Record<string, string>;
  jobs?: Record<string, Job>;
}

const COVERAGE_WORKFLOW = ".github/workflows/coverage.yaml";

async function readWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(COVERAGE_WORKFLOW);
  return parse(text) as Workflow;
}

Deno.test("coverage.yaml coverage job runs a shard matrix", async () => {
  const wf = await readWorkflow();
  const job = wf.jobs?.coverage;
  assert(job, "coverage.yaml must declare a `coverage` job");
  const shards = job.strategy?.matrix?.shard;
  assert(
    Array.isArray(shards) && shards.length > 1,
    "coverage job must declare a strategy.matrix.shard list with >1 entry",
  );
  assertEquals(
    job.strategy?.["fail-fast"],
    false,
    "fail-fast must be false so every shard runs and the parity gate is honest",
  );
});

Deno.test("coverage.yaml SHARD_TOTAL matches the matrix length (parity)", async () => {
  const wf = await readWorkflow();
  const shards = wf.jobs?.coverage?.strategy?.matrix?.shard ?? [];
  const shardTotal = Number(wf.env?.SHARD_TOTAL);
  assert(
    Number.isInteger(shardTotal) && shardTotal > 0,
    `workflow-level SHARD_TOTAL must be a positive integer, got ${wf.env?.SHARD_TOTAL}`,
  );
  assertEquals(
    shardTotal,
    shards.length,
    "SHARD_TOTAL must equal the number of matrix shards (no gaps/double-runs)",
  );
});

Deno.test("coverage.yaml shard indices are exactly 0..SHARD_TOTAL-1", async () => {
  const wf = await readWorkflow();
  const shards = [...(wf.jobs?.coverage?.strategy?.matrix?.shard ?? [])];
  shards.sort((a, b) => a - b);
  const expected = shards.map((_v, index) => index);
  assertEquals(
    shards,
    expected,
    "shard indices must be the contiguous range 0..N-1",
  );
});

Deno.test("coverage.yaml declares a merge job that depends on coverage", async () => {
  const wf = await readWorkflow();
  const merge = wf.jobs?.merge;
  assert(merge, "coverage.yaml must declare a `merge` aggregation job");
  const needs = Array.isArray(merge.needs) ? merge.needs : [merge.needs];
  assert(
    needs.includes("coverage"),
    "merge job must declare `needs: coverage`",
  );
  assert(
    typeof merge["if"] === "string" && merge["if"].includes("cancelled"),
    "merge job should run unless cancelled so results are always published",
  );
});
