/**
 * Evaluation-archive configuration resolution (Issue #3929).
 *
 * The archive is off by default and its retention bound is rejected rather than
 * clamped — a `maxRecords` typo quietly corrected to 1 would throw away the
 * very data the archive exists to keep.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import {
  DEFAULT_EVALUATION_ARCHIVE_CONFIG,
  resolveEvaluationArchiveConfig,
} from "@config/EvaluationArchiveConfig.ts";

Deno.test("evaluation archive config - defaults are off and bounded", () => {
  const config = resolveEvaluationArchiveConfig();
  assertEquals(config.enabled, false);
  assertEquals(config.directory, ".evaluation-archive");
  assertEquals(config.fileName, "evaluations.jsonl");
  assertEquals(config.maxRecords, 100_000);
  assert(config.runId.length > 0, "a run id is always present");
  assertEquals(
    DEFAULT_EVALUATION_ARCHIVE_CONFIG.enabled,
    false,
    "the published default must agree with the resolver",
  );
});

Deno.test("evaluation archive config - each run gets its own id unless one is given", () => {
  const first = resolveEvaluationArchiveConfig();
  const second = resolveEvaluationArchiveConfig();
  assert(first.runId !== second.runId, "run ids distinguish runs");

  const pinned = resolveEvaluationArchiveConfig({ runId: "grq-2026-08" });
  assertEquals(pinned.runId, "grq-2026-08");
});

Deno.test("evaluation archive config - overrides layer over the defaults", () => {
  const config = resolveEvaluationArchiveConfig({
    enabled: true,
    maxRecords: 25,
  });
  assertEquals(config.enabled, true);
  assertEquals(config.maxRecords, 25);
  assertEquals(config.directory, ".evaluation-archive");
});

Deno.test("evaluation archive config - an unusable retention bound is rejected", () => {
  for (const maxRecords of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const error = assertThrows(
      () => resolveEvaluationArchiveConfig({ maxRecords }),
      ConfigurationError,
    ) as ConfigurationError;
    assertEquals(error.reason, "OUT_OF_RANGE");
  }
});

Deno.test("evaluation archive config - a file name may not escape its directory", () => {
  for (const fileName of ["", "   ", "../outside.jsonl", "nested/file.jsonl"]) {
    const error = assertThrows(
      () => resolveEvaluationArchiveConfig({ fileName }),
      ConfigurationError,
    ) as ConfigurationError;
    assertEquals(error.reason, "INVALID_TYPE");
  }
});

Deno.test("evaluation archive config - an empty directory or run id is rejected", () => {
  assertThrows(
    () => resolveEvaluationArchiveConfig({ directory: "  " }),
    ConfigurationError,
  );
  assertThrows(
    () => resolveEvaluationArchiveConfig({ runId: "" }),
    ConfigurationError,
  );
});
