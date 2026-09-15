import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildTimings,
  countJunitFailures,
  extractFileDurations,
  mergeJunitXml,
} from "../../scripts/merge_junit.ts";

/**
 * Tests for the JUnit merge helper used by the sharded coverage workflow to
 * consolidate `junit-<shard>.xml` reports into a single document (Issue
 * #3173).
 */

const SHARD_A = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="2" failures="0" errors="0" skipped="0" time="1.5">
  <testsuite name="a.ts" tests="2" failures="0" errors="0" skipped="0" time="1.5">
    <testcase name="one" time="1.0"/>
    <testcase name="two" time="0.5"/>
  </testsuite>
</testsuites>`;

const SHARD_B = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="3" failures="1" errors="0" skipped="1" time="2.0">
  <testsuite name="b.ts" tests="3" failures="1" errors="0" skipped="1" time="2.0">
    <testcase name="three" time="0.5"/>
    <testcase name="four" time="0.5"><failure>boom</failure></testcase>
    <testcase name="five" time="1.0"/>
  </testsuite>
</testsuites>`;

Deno.test("mergeJunitXml - produces a single testsuites root", () => {
  const merged = mergeJunitXml([SHARD_A, SHARD_B]);
  const roots = merged.match(/<testsuites\b/g) ?? [];
  assertEquals(roots.length, 1, "must have exactly one <testsuites> root");
  const closing = merged.match(/<\/testsuites>/g) ?? [];
  assertEquals(closing.length, 1, "must have exactly one closing root");
});

Deno.test("mergeJunitXml - keeps every child testsuite", () => {
  const merged = mergeJunitXml([SHARD_A, SHARD_B]);
  assertStringIncludes(merged, 'name="a.ts"');
  assertStringIncludes(merged, 'name="b.ts"');
  const suites = merged.match(/<testsuite\b/g) ?? [];
  assertEquals(suites.length, 2, "both shard suites must be preserved");
});

Deno.test("mergeJunitXml - recomputes aggregate counts", () => {
  const merged = mergeJunitXml([SHARD_A, SHARD_B]);
  const root = merged.match(/<testsuites\b[^>]*>/)?.[0] ?? "";
  assertStringIncludes(root, 'tests="5"');
  assertStringIncludes(root, 'failures="1"');
  assertStringIncludes(root, 'skipped="1"');
  assertStringIncludes(root, 'errors="0"');
});

Deno.test("mergeJunitXml - ignores blank inputs", () => {
  const merged = mergeJunitXml(["", SHARD_A, "   "]);
  const suites = merged.match(/<testsuite\b/g) ?? [];
  assertEquals(suites.length, 1);
  assertStringIncludes(merged, 'tests="2"');
});

Deno.test("mergeJunitXml - empty input yields a valid empty document", () => {
  const merged = mergeJunitXml([]);
  assertStringIncludes(merged, "<testsuites");
  assertStringIncludes(merged, "</testsuites>");
  assert(merged.startsWith("<?xml"));
});

Deno.test("countJunitFailures - sums failures and errors across shards", () => {
  const result = countJunitFailures([SHARD_A, SHARD_B]);
  assertEquals(result.failures, 1);
  assertEquals(result.errors, 0);
});

Deno.test("countJunitFailures - reports zero for all-passing shards", () => {
  const result = countJunitFailures([SHARD_A, SHARD_A]);
  assertEquals(result.failures, 0);
  assertEquals(result.errors, 0);
});

/**
 * Per-file duration extraction (Issue #4017). The merge job already parses
 * every shard's JUnit report, so it is the natural place to publish the
 * per-file cost map the cost-weighted shard planner consumes.
 */

const DENO_SHAPED = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="deno test" tests="3" failures="0" errors="0" time="0.0">
  <testsuite name="./test/NEAT/Slow.ts" tests="2" disabled="0" errors="0" failures="0">
    <testcase name="one" classname="./test/NEAT/Slow.ts" time="12.500" line="1" col="6">
    </testcase>
    <testcase name="two" classname="./test/NEAT/Slow.ts" time="0.250" line="9" col="6">
    </testcase>
  </testsuite>
  <testsuite name="./test/unit/Fast.ts" tests="1" disabled="0" errors="0" failures="0">
    <testcase name="three" classname="./test/unit/Fast.ts" time="0.004" line="1" col="6">
    </testcase>
  </testsuite>
</testsuites>`;

Deno.test("extractFileDurations - sums testcase times per suite", () => {
  const durations = extractFileDurations([DENO_SHAPED]);
  assertEquals(durations.get("test/NEAT/Slow.ts"), 12.75);
  assertEquals(durations.get("test/unit/Fast.ts"), 0.004);
});

Deno.test("extractFileDurations - strips the ./ prefix from suite names", () => {
  const durations = extractFileDurations([DENO_SHAPED]);
  assert(
    [...durations.keys()].every((name) => !name.startsWith("./")),
    `suite names must be repo-relative, got ${[...durations.keys()]}`,
  );
});

Deno.test("extractFileDurations - accumulates a file split across documents", () => {
  const durations = extractFileDurations([DENO_SHAPED, DENO_SHAPED]);
  assertEquals(durations.get("test/NEAT/Slow.ts"), 25.5);
});

Deno.test("extractFileDurations - falls back to the testsuite time attribute", () => {
  // Older/other reporters emit a suite-level time with no testcase children.
  const durations = extractFileDurations([SHARD_A]);
  assertEquals(durations.get("a.ts"), 1.5);
});

Deno.test("extractFileDurations - records an empty self-closing suite as zero", () => {
  const xml =
    `<testsuites><testsuite name="./test/Empty.ts" tests="0"/></testsuites>`;
  assertEquals(extractFileDurations([xml]).get("test/Empty.ts"), 0);
});

Deno.test("extractFileDurations - ignores blank documents", () => {
  assertEquals(extractFileDurations(["", "  "]).size, 0);
});

Deno.test("extractFileDurations - leaves an unreadable testcase time unmeasured", () => {
  // A truncated or garbled report must never be recorded as 0s: the planner
  // would read that as "measured and free" and under-load the shard forever.
  const xml =
    `<testsuites><testsuite name="test/x.ts" tests="2"><testcase name="a" time="1.0"/>` +
    `<testcase name="b"/></testsuite></testsuites>`;
  assertEquals(extractFileDurations([xml]).has("test/x.ts"), false);
});

Deno.test("extractFileDurations - leaves a suite with no duration at all unmeasured", () => {
  const xml =
    `<testsuites><testsuite name="test/x.ts" tests="3"/></testsuites>`;
  assertEquals(extractFileDurations([xml]).has("test/x.ts"), false);
});

Deno.test("buildTimings - emits sorted, rounded seconds with a schema header", () => {
  const timings = buildTimings([DENO_SHAPED], "2026-01-01T00:00:00.000Z");
  assertEquals(timings.version, 1);
  assertEquals(timings.unit, "seconds");
  assertEquals(timings.generated, "2026-01-01T00:00:00.000Z");
  assertEquals(Object.keys(timings.files), [
    "test/NEAT/Slow.ts",
    "test/unit/Fast.ts",
  ]);
  assertEquals(timings.files["test/NEAT/Slow.ts"], 12.75);
});

Deno.test("buildTimings - rounds sub-millisecond noise to three decimals", () => {
  const xml =
    `<testsuites><testsuite name="test/x.ts"><testcase name="a" time="0.0004"/>` +
    `<testcase name="b" time="0.0004"/></testsuite></testsuites>`;
  assertEquals(buildTimings([xml]).files["test/x.ts"], 0.001);
});
