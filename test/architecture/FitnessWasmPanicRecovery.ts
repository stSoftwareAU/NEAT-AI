/**
 * Tests verifying Fitness handles WASM panic errors gracefully.
 *
 * Issue #2211: When a worker encounters a WASM RuntimeError: unreachable
 * (e.g. under memory pressure), the worker returns POSITIVE_INFINITY as the
 * error value. Fitness must assign the worst possible score (-Infinity) to
 * such creatures instead of crashing the entire evolution with an assertion
 * failure in Score.calculate().
 */
import { assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Fitness } from "@architecture/Fitness.ts";
import { Creature } from "@creature";

Deno.test("Fitness calculate - WASM panic returns -Infinity score instead of crashing", async () => {
  const creature = new Creature(2, 1);
  creature.score = undefined;

  // Simulate a worker that returns POSITIVE_INFINITY error (as the real
  // worker does when WASM panics with RuntimeError: unreachable).
  const mockWorker = {
    evaluate: () =>
      Promise.resolve({
        taskID: 1,
        duration: 10,
        error: {
          name: "RuntimeError",
          message: "unreachable",
          stack: "at wasm://...",
        },
        evaluate: { error: Number.POSITIVE_INFINITY },
      }),
  };

  const fitness = new Fitness(
    // deno-lint-ignore no-explicit-any
    [mockWorker as any],
    0.0001,
    false,
  );

  // Should NOT throw — the creature gets the worst score gracefully.
  await fitness.calculate([creature]);

  assertEquals(creature.score, -Infinity);
  assertEquals(getTag(creature, "error"), "Infinity");
  assertEquals(getTag(creature, "score"), "-Infinity");
});

Deno.test("Fitness calculate - NaN error returns -Infinity score instead of crashing", async () => {
  const creature = new Creature(2, 1);
  creature.score = undefined;

  const mockWorker = {
    evaluate: () =>
      Promise.resolve({
        taskID: 1,
        duration: 10,
        evaluate: { error: Number.NaN },
      }),
  };

  const fitness = new Fitness(
    // deno-lint-ignore no-explicit-any
    [mockWorker as any],
    0.0001,
    false,
  );

  await fitness.calculate([creature]);

  assertEquals(creature.score, -Infinity);
});

Deno.test("Fitness calculate - negative error returns -Infinity score instead of crashing", async () => {
  const creature = new Creature(2, 1);
  creature.score = undefined;

  const mockWorker = {
    evaluate: () =>
      Promise.resolve({
        taskID: 1,
        duration: 10,
        evaluate: { error: -1 },
      }),
  };

  const fitness = new Fitness(
    // deno-lint-ignore no-explicit-any
    [mockWorker as any],
    0.0001,
    false,
  );

  await fitness.calculate([creature]);

  assertEquals(creature.score, -Infinity);
});

Deno.test("Fitness calculate - valid error still scores normally", async () => {
  const creature = new Creature(2, 1);
  creature.score = undefined;

  const mockWorker = {
    evaluate: () =>
      Promise.resolve({
        taskID: 1,
        duration: 10,
        evaluate: { error: 0.5 },
      }),
  };

  const fitness = new Fitness(
    // deno-lint-ignore no-explicit-any
    [mockWorker as any],
    0.0001,
    false,
  );

  await fitness.calculate([creature]);

  // Score should be finite and less than 1 (since error = 0.5)
  assertEquals(typeof creature.score, "number");
  assertEquals(Number.isFinite(creature.score!), true);
  assertEquals(creature.score! < 1, true);
});
