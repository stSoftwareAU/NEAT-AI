import { assert } from "https://deno.land/std@0.137.0/testing/asserts.ts";
import { WorkerHandler } from "../src/multithreading/workers/WorkerHandler.ts";

Deno.test("busy", async () => {
  const w = new WorkerHandler("/tmp", "ABC", false);

  const p = w.echo("hello", 1000);

  assert(w.isBusy(), "should be busy");
  await p;

  assert(!w.isBusy(), "should no longer be busy");

  w.terminate();
});

Deno.test("busy-direct", async () => {
  const w = new WorkerHandler("/tmp", "ABC", true);

  const p = w.echo("hello", 1000);

  assert(w.isBusy(), "should be busy");
  await p;

  assert(!w.isBusy(), "should no longer be busy");

  w.terminate();
});
