/**
 * Resolution of `trainingGainLog` options (Issue #3934).
 *
 * The log is opt-in run infrastructure that writes to disk, so the two
 * properties worth locking are that the default resolves to off and that an
 * invalid bound is refused rather than clamped — a `maxRecords` typo corrected
 * to 1 would publish a rank-versus-gain correlation over a single event.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import {
  DEFAULT_TRAINING_GAIN_LOG_CONFIG,
  resolveTrainingGainLogConfig,
} from "@config/TrainingGainLogConfig.ts";

Deno.test("trainingGainLog - defaults to off, writing nothing", () => {
  const resolved = resolveTrainingGainLogConfig();
  assertEquals(resolved.enabled, false);
  assertEquals(resolved.directory, DEFAULT_TRAINING_GAIN_LOG_CONFIG.directory);
  assertEquals(
    resolved.maxRecords,
    DEFAULT_TRAINING_GAIN_LOG_CONFIG.maxRecords,
  );
  assert(resolved.runId.length > 0, "a runId is always present");
});

Deno.test("trainingGainLog - every run gets its own runId", () => {
  const first = resolveTrainingGainLogConfig();
  const second = resolveTrainingGainLogConfig();
  assert(first.runId !== second.runId, "runIds must not collide");
});

Deno.test("trainingGainLog - caller overrides win", () => {
  const resolved = resolveTrainingGainLogConfig({
    enabled: true,
    directory: "/tmp/gain",
    maxRecords: 7,
    runId: "run-7",
  });
  assertEquals(resolved, {
    enabled: true,
    directory: "/tmp/gain",
    maxRecords: 7,
    runId: "run-7",
  });
});

Deno.test("trainingGainLog - a CLI string maxRecords is parsed, not rejected", () => {
  const resolved = resolveTrainingGainLogConfig(
    { maxRecords: "500" } as unknown as { maxRecords: number },
  );
  assertEquals(resolved.maxRecords, 500);
});

Deno.test("trainingGainLog - refuses a maxRecords below one", () => {
  const error = assertThrows(
    () => resolveTrainingGainLogConfig({ maxRecords: 0 }),
    ConfigurationError,
  );
  assertEquals(error.reason, "OUT_OF_RANGE");
});

Deno.test("trainingGainLog - an unparseable maxRecords names what it was given", () => {
  const thrown = assertThrows(
    () =>
      resolveTrainingGainLogConfig({
        maxRecords: "abc" as unknown as number,
      }),
    ConfigurationError,
  );
  // A refusal that says "got NaN" tells the operator nothing about what they
  // typed; the documented parse helper quotes the input back.
  assertStringIncludes(thrown.message, '"abc"');
});

Deno.test("trainingGainLog - refuses a fractional maxRecords", () => {
  assertThrows(
    () => resolveTrainingGainLogConfig({ maxRecords: 12.5 }),
    ConfigurationError,
  );
});

Deno.test("trainingGainLog - refuses an empty directory", () => {
  const error = assertThrows(
    () => resolveTrainingGainLogConfig({ directory: "   " }),
    ConfigurationError,
  );
  assertEquals(error.reason, "INVALID_TYPE");
});

Deno.test("trainingGainLog - refuses an empty runId", () => {
  assertThrows(
    () => resolveTrainingGainLogConfig({ runId: "" }),
    ConfigurationError,
  );
});
