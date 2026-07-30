import { assert, assertEquals } from "@std/assert";
import {
  evaluateCoverageMergeGate,
  isCoverageShardDir,
  isShardStatusFile,
  scanCoverageMergeInputs,
} from "../../scripts/coverage_merge_gate.ts";

/**
 * Unit tests for the coverage merge gate (Issue #3550).
 *
 * The sharded coverage workflow used to treat "no shard coverage directories
 * found" as a clean skip: it printed a message, exited 0, and the Codecov
 * upload was skipped by its `hashFiles` guard. Coverage was silently lost.
 *
 * The gate makes that case loud: when at least one shard uploaded a status it
 * ran tests, so at least one coverage directory MUST be present — an empty
 * glob is a defect, not a skip.
 *
 * These are "what" tests: they call the real decision function with test data
 * and assert on the returned outcome.
 */

Deno.test("merge gate merges when shards reported status and coverage arrived", () => {
  const result = evaluateCoverageMergeGate({
    coverageDirs: ["coverage-0", "coverage-1"],
    statusFiles: ["shard-status-0.txt", "shard-status-1.txt"],
  });
  assertEquals(result.status, "merge");
});

Deno.test("merge gate fails loud when shards reported status but no coverage arrived", () => {
  const result = evaluateCoverageMergeGate({
    coverageDirs: [],
    statusFiles: ["shard-status-0.txt", "shard-status-1.txt"],
  });
  assertEquals(
    result.status,
    "fail",
    "missing coverage after shards ran is a defect, not a skip",
  );
  assert(
    result.message.includes("shard-status"),
    `failure message should name the evidence that shards ran: ${result.message}`,
  );
});

Deno.test("merge gate fails loud when a single shard reported status without coverage", () => {
  const result = evaluateCoverageMergeGate({
    coverageDirs: [],
    statusFiles: ["shard-status-3.txt"],
  });
  assertEquals(result.status, "fail");
});

Deno.test("merge gate skips when no shard uploaded anything at all", () => {
  // Every shard crashed before writing a status: the shard-status gate reports
  // that failure, so the coverage step skips rather than double-reporting.
  const result = evaluateCoverageMergeGate({
    coverageDirs: [],
    statusFiles: [],
  });
  assertEquals(result.status, "skip");
});

Deno.test("merge gate merges coverage that arrived without any status file", () => {
  const result = evaluateCoverageMergeGate({
    coverageDirs: ["coverage-2"],
    statusFiles: [],
  });
  assertEquals(result.status, "merge");
});

Deno.test("merge gate reports the coverage directories it will merge", () => {
  const result = evaluateCoverageMergeGate({
    coverageDirs: ["coverage-5"],
    statusFiles: ["shard-status-5.txt"],
  });
  assert(
    result.message.includes("coverage-5"),
    `merge message should name the directories: ${result.message}`,
  );
});

Deno.test("coverage shard directories are recognised only when non-hidden", () => {
  assert(isCoverageShardDir("coverage-0"));
  assert(isCoverageShardDir("coverage-11"));
  // The root cause of Issue #3550: a dot-prefixed directory is a hidden path,
  // which actions/upload-artifact drops by default. Such a directory can never
  // reach the merge job, so it must not be counted as coverage.
  assert(
    !isCoverageShardDir(".coverage-0"),
    "hidden (dot-prefixed) shard dirs are never uploaded and must not count",
  );
  assert(!isCoverageShardDir("coverage"));
  assert(!isCoverageShardDir("coverage-abc"));
  assert(!isCoverageShardDir("coverage-0.lcov"));
});

Deno.test("shard status files are recognised by index", () => {
  assert(isShardStatusFile("shard-status-0.txt"));
  assert(isShardStatusFile("shard-status-7.txt"));
  assert(!isShardStatusFile("shard-status.txt"));
  assert(!isShardStatusFile("shard-status-0.json"));
  assert(!isShardStatusFile("junit-0.xml"));
});

Deno.test("scanning a real directory drives the gate to fail loud on lost coverage", async () => {
  const dir = await Deno.makeTempDir({ prefix: "coverage-merge-gate-" });
  try {
    await Deno.writeTextFile(`${dir}/shard-status-0.txt`, "passed");
    await Deno.writeTextFile(`${dir}/junit-0.xml`, "<testsuites/>");
    // A hidden coverage dir is exactly what the old workflow produced — it never
    // survives the artifact upload, so scanning must not count it.
    await Deno.mkdir(`${dir}/.coverage-0`);

    const lost = await scanCoverageMergeInputs(dir);
    assertEquals(lost.coverageDirs, []);
    assertEquals(lost.statusFiles, ["shard-status-0.txt"]);
    assertEquals(evaluateCoverageMergeGate(lost).status, "fail");

    await Deno.mkdir(`${dir}/coverage-0`);
    const found = await scanCoverageMergeInputs(dir);
    assertEquals(found.coverageDirs, ["coverage-0"]);
    assertEquals(evaluateCoverageMergeGate(found).status, "merge");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
