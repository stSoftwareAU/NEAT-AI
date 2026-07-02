import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  countJunitFailures,
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
