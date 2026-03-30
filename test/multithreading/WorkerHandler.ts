/**
 * Tests for the multithreading WorkerHandler class.
 *
 * Issue #1698: Validates WorkerHandler construction, echo communication,
 * and lifecycle management using direct (MockWorker) mode.
 */
import { assertEquals, assertExists } from "@std/assert";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

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
