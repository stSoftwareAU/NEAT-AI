import { assert } from "https://deno.land/std@0.165.0/testing/asserts.ts";
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
