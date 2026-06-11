/**
 * Tests for the multithreading WorkerHandler class.
 *
 * Issue #1698: Validates WorkerHandler construction, echo communication,
 * and lifecycle management using direct (MockWorker) mode.
 */
import { assertEquals, assertExists } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import {
  CURRENT_GENERATION_TAG,
  WARMUP_GENERATIONS_TAG,
} from "@architecture/CreatureFactory.ts";

Deno.test("WorkerHandler: constructs in direct mode and initialises", async () => {
  const handler = new WorkerHandler(
    await Deno.makeTempDir(),
    "MSE",
    true, // direct mode uses MockWorker
  );

  await handler.waitUntilReady();
  assertEquals(handler.isBusy(), false);
  handler.terminate();
});

Deno.test("WorkerHandler: echo round-trip in direct mode", async () => {
  const handler = new WorkerHandler(
    await Deno.makeTempDir(),
    "MSE",
    true,
  );

  await handler.waitUntilReady();

  const response = await handler.echo("test-message", 0);
  assertExists(response.echo);
  assertEquals(response.echo?.message, "test-message");

  handler.terminate();
});

Deno.test("WorkerHandler: reports busy during echo and idle after", async () => {
  const handler = new WorkerHandler(
    await Deno.makeTempDir(),
    "MSE",
    true,
  );

  await handler.waitUntilReady();

  let idleFired = false;
  handler.addIdleListener(() => {
    idleFired = true;
  });

  const promise = handler.echo("busy-test", 0);
  assertEquals(handler.isBusy(), true);

  await promise;
  assertEquals(handler.isBusy(), false);
  assertEquals(idleFired, true);

  handler.terminate();
});

Deno.test("WorkerHandler: terminate cleans up without error", async () => {
  const handler = new WorkerHandler(
    await Deno.makeTempDir(),
    "MSE",
    true,
  );

  await handler.waitUntilReady();
  handler.terminate();

  // Should not throw after termination
  assertEquals(handler.isBusy(), false);
});

Deno.test("WorkerHandler.train: does NOT carry warm-up tags in train payload (Issue #2911)", async () => {
  const handler = new WorkerHandler(
    await Deno.makeTempDir(),
    "MSE",
    true,
  );
  await handler.waitUntilReady();

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  addTag(creature, WARMUP_GENERATIONS_TAG, "1440");
  addTag(creature, CURRENT_GENERATION_TAG, "12");
  addTag(creature, "error", "0.5");
  creature.score = 1.23;

  let captured:
    | {
      train?: { creature?: { tags?: Array<{ name: string; value: string }> } };
    }
    | undefined;

  const originalMakePromiseDeferred = (handler as unknown as {
    makePromiseDeferred: (
      data: unknown,
      clearAfterPost?: () => void,
    ) => Promise<unknown>;
  }).makePromiseDeferred;

  (handler as unknown as {
    makePromiseDeferred: (
      data: unknown,
      clearAfterPost?: () => void,
    ) => Promise<unknown>;
  }).makePromiseDeferred = (data: unknown) => {
    captured = data as typeof captured;
    return Promise.resolve({ train: { ID: "mock", creature: {} } });
  };

  try {
    await handler.train(creature, {} as TrainOptions);
  } finally {
    (handler as unknown as {
      makePromiseDeferred: (
        data: unknown,
        clearAfterPost?: () => void,
      ) => Promise<unknown>;
    }).makePromiseDeferred = originalMakePromiseDeferred;
    handler.terminate();
  }

  const tags = captured?.train?.creature?.tags;
  // The Neat-level counter is the single source of truth mid-run — the
  // training round-trip must not carry the two warm-up tags.
  assertEquals(
    tags?.find((t) => t.name === WARMUP_GENERATIONS_TAG),
    undefined,
  );
  assertEquals(
    tags?.find((t) => t.name === CURRENT_GENERATION_TAG),
    undefined,
  );
  // Existing training context tags should still be present.
  assertEquals(tags?.find((t) => t.name === "untrained-error")?.value, "0.5");
});
