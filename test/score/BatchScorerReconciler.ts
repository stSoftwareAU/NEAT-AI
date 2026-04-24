import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  BatchScorerError,
  reconcileBatchScorerOutput,
} from "../../src/score/BatchScorerReconciler.ts";

/**
 * Integration-style tests for batch scorer reconciliation (Issue #2423).
 *
 * These tests exercise the reconciler against realistic scorer payloads to
 * cover the happy-path, key-mismatch path, and malformed-result path required
 * by the issue's acceptance criteria.
 */

/** Typed wrapper: `assertThrows` returns `unknown` in this std version. */
function expectBatchError(fn: () => unknown): BatchScorerError {
  return assertThrows(fn, BatchScorerError) as BatchScorerError;
}

const expectedStems = ["creature-a", "creature-b", "creature-c"];

function validPayload(): string {
  return JSON.stringify({
    "creature-a": { score: 0.92, error: 0.08, recordCount: 128 },
    "creature-b": { score: 0.81, error: 0.19, recordCount: 128 },
    "creature-c": { score: 0.77, error: 0.23, recordCount: 128 },
  });
}

Deno.test("BatchScorerReconciler - happy path parses and returns a map", () => {
  const results = reconcileBatchScorerOutput(validPayload(), expectedStems);
  assertEquals(results.size, 3);
  const a = results.get("creature-a");
  assert(a !== undefined, "creature-a should be present");
  assertEquals(a.score, 0.92);
  assertEquals(a.error, 0.08);
  assertEquals(a.recordCount, 128);
});

Deno.test("BatchScorerReconciler - accepts pre-parsed object payload", () => {
  const parsed = {
    "creature-a": { score: 1, error: 0, recordCount: 10 },
    "creature-b": { score: 2, error: 0.5, recordCount: 10 },
    "creature-c": { score: 3, error: 1, recordCount: 10 },
  };
  const results = reconcileBatchScorerOutput(parsed, expectedStems);
  assertEquals(results.size, 3);
  assertEquals(results.get("creature-b")?.error, 0.5);
});

Deno.test("BatchScorerReconciler - fails fast on invalid JSON string", () => {
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput("not json at all", expectedStems)
  );
  assertEquals(err.reason, "INVALID_JSON");
  assert(
    err.message.toLowerCase().includes("json"),
    `message should mention JSON; got: ${err.message}`,
  );
});

Deno.test("BatchScorerReconciler - rejects non-object payloads", () => {
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput("[1,2,3]", expectedStems)
  );
  assertEquals(err.reason, "NOT_AN_OBJECT");
});

Deno.test("BatchScorerReconciler - rejects null payload", () => {
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput("null", expectedStems)
  );
  assertEquals(err.reason, "NOT_AN_OBJECT");
});

Deno.test("BatchScorerReconciler - fails fast when a key is missing", () => {
  const payload = JSON.stringify({
    "creature-a": { score: 0.5, error: 0.5, recordCount: 10 },
    "creature-b": { score: 0.5, error: 0.5, recordCount: 10 },
    // creature-c missing
  });
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput(payload, expectedStems)
  );
  assertEquals(err.reason, "MISSING_KEYS");
  assertEquals(err.missingKeys, ["creature-c"]);
  assert(
    err.message.includes("creature-c"),
    `message should include missing key; got: ${err.message}`,
  );
});

Deno.test("BatchScorerReconciler - fails fast when an extra key is present", () => {
  const payload = JSON.stringify({
    "creature-a": { score: 0.5, error: 0.5, recordCount: 10 },
    "creature-b": { score: 0.5, error: 0.5, recordCount: 10 },
    "creature-c": { score: 0.5, error: 0.5, recordCount: 10 },
    "creature-ghost": { score: 0.5, error: 0.5, recordCount: 10 },
  });
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput(payload, expectedStems)
  );
  assertEquals(err.reason, "EXTRA_KEYS");
  assertEquals(err.extraKeys, ["creature-ghost"]);
  assert(
    err.message.includes("creature-ghost"),
    `message should include extra key; got: ${err.message}`,
  );
});

Deno.test("BatchScorerReconciler - reports both missing and extra keys together", () => {
  const payload = JSON.stringify({
    "creature-a": { score: 0.5, error: 0.5, recordCount: 10 },
    "creature-b": { score: 0.5, error: 0.5, recordCount: 10 },
    "creature-zombie": { score: 0.5, error: 0.5, recordCount: 10 },
  });
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput(payload, expectedStems)
  );
  // Missing-keys check runs first; either reason is acceptable but the message
  // must surface both problems so operators can fix them in one pass.
  assert(
    err.reason === "MISSING_KEYS" || err.reason === "EXTRA_KEYS",
    `unexpected reason ${err.reason}`,
  );
  assert(
    err.message.includes("creature-c") &&
      err.message.includes("creature-zombie"),
    `message should mention both mismatched keys; got: ${err.message}`,
  );
});

Deno.test("BatchScorerReconciler - rejects result that is not an object", () => {
  const payload = JSON.stringify({
    "creature-a": 0.5,
    "creature-b": { score: 0.5, error: 0.5, recordCount: 10 },
    "creature-c": { score: 0.5, error: 0.5, recordCount: 10 },
  });
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput(payload, expectedStems)
  );
  assertEquals(err.reason, "MALFORMED_RESULT");
  assert(err.malformedKeys?.includes("creature-a"));
});

Deno.test("BatchScorerReconciler - rejects missing numeric field", () => {
  const payload = JSON.stringify({
    "creature-a": { score: 0.5, error: 0.5 }, // missing recordCount
    "creature-b": { score: 0.5, error: 0.5, recordCount: 10 },
    "creature-c": { score: 0.5, error: 0.5, recordCount: 10 },
  });
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput(payload, expectedStems)
  );
  assertEquals(err.reason, "MALFORMED_RESULT");
  assert(err.malformedKeys?.includes("creature-a"));
  assert(
    err.message.includes("recordCount"),
    `message should name missing field; got: ${err.message}`,
  );
});

Deno.test("BatchScorerReconciler - rejects NaN for a numeric field", () => {
  // JSON doesn't support NaN literally; use a string that won't parse to a number.
  const payload = JSON.stringify({
    "creature-a": { score: "not-a-number", error: 0.5, recordCount: 10 },
    "creature-b": { score: 0.5, error: 0.5, recordCount: 10 },
    "creature-c": { score: 0.5, error: 0.5, recordCount: 10 },
  });
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput(payload, expectedStems)
  );
  assertEquals(err.reason, "MALFORMED_RESULT");
  assert(err.malformedKeys?.includes("creature-a"));
});

Deno.test("BatchScorerReconciler - rejects infinite error field", () => {
  // Build pre-parsed input because JSON can't represent Infinity.
  const parsed = {
    "creature-a": {
      score: 0.5,
      error: Number.POSITIVE_INFINITY,
      recordCount: 10,
    },
    "creature-b": { score: 0.5, error: 0.5, recordCount: 10 },
    "creature-c": { score: 0.5, error: 0.5, recordCount: 10 },
  };
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput(parsed, expectedStems)
  );
  assertEquals(err.reason, "MALFORMED_RESULT");
  assert(err.malformedKeys?.includes("creature-a"));
});

Deno.test("BatchScorerReconciler - rejects negative recordCount", () => {
  const payload = JSON.stringify({
    "creature-a": { score: 0.5, error: 0.5, recordCount: -1 },
    "creature-b": { score: 0.5, error: 0.5, recordCount: 10 },
    "creature-c": { score: 0.5, error: 0.5, recordCount: 10 },
  });
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput(payload, expectedStems)
  );
  assertEquals(err.reason, "MALFORMED_RESULT");
  assert(err.malformedKeys?.includes("creature-a"));
});

Deno.test("BatchScorerReconciler - rejects non-integer recordCount", () => {
  const payload = JSON.stringify({
    "creature-a": { score: 0.5, error: 0.5, recordCount: 10.5 },
    "creature-b": { score: 0.5, error: 0.5, recordCount: 10 },
    "creature-c": { score: 0.5, error: 0.5, recordCount: 10 },
  });
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput(payload, expectedStems)
  );
  assertEquals(err.reason, "MALFORMED_RESULT");
  assert(err.malformedKeys?.includes("creature-a"));
});

Deno.test("BatchScorerReconciler - empty expected set with empty payload is accepted", () => {
  const results = reconcileBatchScorerOutput("{}", []);
  assertEquals(results.size, 0);
});

Deno.test("BatchScorerReconciler - duplicate expected stems are deduplicated", () => {
  const results = reconcileBatchScorerOutput(validPayload(), [
    "creature-a",
    "creature-a",
    "creature-b",
    "creature-c",
  ]);
  assertEquals(results.size, 3);
});

Deno.test("BatchScorerReconciler - reports all malformed creatures in one pass", () => {
  const payload = JSON.stringify({
    "creature-a": { score: 0.5, error: 0.5 }, // missing recordCount
    "creature-b": { score: "bad", error: 0.5, recordCount: 10 }, // bad score
    "creature-c": { score: 0.5, error: 0.5, recordCount: 10 },
  });
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput(payload, expectedStems)
  );
  assertEquals(err.reason, "MALFORMED_RESULT");
  assertEquals(err.malformedKeys?.slice().sort(), ["creature-a", "creature-b"]);
});

Deno.test("BatchScorerReconciler - preserves extra optional numeric fields", () => {
  const payload = JSON.stringify({
    "creature-a": {
      score: 0.9,
      error: 0.1,
      recordCount: 50,
      durationMs: 123,
    },
    "creature-b": { score: 0.5, error: 0.5, recordCount: 50 },
    "creature-c": { score: 0.5, error: 0.5, recordCount: 50 },
  });
  const results = reconcileBatchScorerOutput(payload, expectedStems);
  const a = results.get("creature-a");
  assert(a !== undefined);
  assertEquals((a as unknown as Record<string, unknown>).durationMs, 123);
});

Deno.test("BatchScorerReconciler - rejects array-typed result", () => {
  const payload = JSON.stringify({
    "creature-a": [0.5, 0.5, 10],
    "creature-b": { score: 0.5, error: 0.5, recordCount: 10 },
    "creature-c": { score: 0.5, error: 0.5, recordCount: 10 },
  });
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput(payload, expectedStems)
  );
  assertEquals(err.reason, "MALFORMED_RESULT");
  assert(err.malformedKeys?.includes("creature-a"));
});

Deno.test("BatchScorerError exposes reason for programmatic handling", () => {
  const err = expectBatchError(() =>
    reconcileBatchScorerOutput("not json", expectedStems)
  );
  assertEquals(err.name, "BatchScorerError");
  assertEquals(err.reason, "INVALID_JSON");
  assert(err instanceof Error, "BatchScorerError extends Error");
});
