import { assert, assertEquals } from "@std/assert";
import { WorkerHandler } from "../src/multithreading/workers/WorkerHandler.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("busyWorker", async () => {
  const w = new WorkerHandler("/tmp", "MSE", false);

  await checkWorker(w);
});

async function checkWorker(w: WorkerHandler) {
  const p = w.echo("hello", 1000);
  const p2 = w.echo("hello", 1000);

  assert(w.isBusy(), "should be busy");
  await p;
  assert(w.isBusy(), "should be busy");
  await p2;
  assert(!w.isBusy(), "should no longer be busy");

  w.terminate();
}

Deno.test("busyDirect", async () => {
  const w = new WorkerHandler("/tmp", "MSE", true);
  await checkWorker(w);
});

Deno.test("idleListener is called when worker becomes idle", async () => {
  const w = new WorkerHandler("/tmp", "MSE", true);

  let idleCallCount = 0;
  w.addIdleListener(() => {
    idleCallCount++;
  });

  // Queue two echo requests
  const p1 = w.echo("first", 10);
  const p2 = w.echo("second", 10);

  // Both should be pending
  assert(w.isBusy(), "should be busy with two pending requests");

  // Wait for first
  await p1;
  assert(w.isBusy(), "should still be busy after first completes");
  assertEquals(idleCallCount, 0, "idle listener should not be called yet");

  // Wait for second
  await p2;
  assert(!w.isBusy(), "should no longer be busy");
  assertEquals(idleCallCount, 1, "idle listener should be called once");

  w.terminate();
});

Deno.test("deferred requests are queued while worker initializes", async () => {
  const w = new WorkerHandler("/tmp", "MSE", true);

  // Immediately queue requests before init completes
  const p1 = w.echo("queued-1", 5);
  const p2 = w.echo("queued-2", 5);

  // Both should show as busy immediately (deferred queue behavior)
  assert(w.isBusy(), "should be busy immediately after queueing");

  // Wait for both to complete
  const [r1, r2] = await Promise.all([p1, p2]);

  assertEquals(r1.echo?.message, "queued-1");
  assertEquals(r2.echo?.message, "queued-2");
  assert(!w.isBusy(), "should no longer be busy");

  w.terminate();
});
