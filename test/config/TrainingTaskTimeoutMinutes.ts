/**
 * Tests for the `trainingTaskTimeoutMinutes` per-task cap option (Issue #3053).
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  createNeatConfig,
  DEFAULT_TRAINING_TASK_TIMEOUT_MINUTES,
} from "@config/NeatConfig.ts";

Deno.test("trainingTaskTimeoutMinutes - defaults to the engine cap", () => {
  const config = createNeatConfig({});
  assertEquals(
    config.trainingTaskTimeoutMinutes,
    DEFAULT_TRAINING_TASK_TIMEOUT_MINUTES,
  );
});

Deno.test("trainingTaskTimeoutMinutes - consumer can override", () => {
  const config = createNeatConfig({ trainingTaskTimeoutMinutes: 2 });
  assertEquals(config.trainingTaskTimeoutMinutes, 2);
});

Deno.test("trainingTaskTimeoutMinutes - 0 disables the cap", () => {
  const config = createNeatConfig({ trainingTaskTimeoutMinutes: 0 });
  assertEquals(config.trainingTaskTimeoutMinutes, 0);
});

Deno.test("trainingTaskTimeoutMinutes - accepts string from CLI", () => {
  const config = createNeatConfig({
    trainingTaskTimeoutMinutes: "3" as unknown as number,
  });
  assertEquals(config.trainingTaskTimeoutMinutes, 3);
});

Deno.test("trainingTaskTimeoutMinutes - rejects negative values", () => {
  assertThrows(
    () => createNeatConfig({ trainingTaskTimeoutMinutes: -1 }),
    Error,
  );
});
