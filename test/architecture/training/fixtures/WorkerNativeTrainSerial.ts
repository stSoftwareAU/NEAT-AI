// Two training tasks sent to one real worker must not overlap in the native
// trainer (Issue #4126). The stand-in prints NATIVE_TRAIN_ENTERED when a call
// starts and NATIVE_TRAIN_FINISHED when it returns; the parent test checks the
// order of those lines.
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { initWasmForTests } from "../../../_initWasm.ts";

async function waitForFile(path: string): Promise<void> {
  for (;;) {
    try {
      // deno-lint-ignore no-await-in-loop
      await Deno.stat(path);
      return;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    // deno-lint-ignore no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

if (import.meta.main) {
  await initWasmForTests();
  const input = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../fixtures/native-backprop/ffi-response-new-completed.json",
        import.meta.url,
      ),
    ),
  );
  const creature = Creature.fromJSON(JSON.parse(input.bestCreatureJson));
  const dir = makeDataDir([
    { input: new Float32Array([0.5]), output: new Float32Array([1]) },
  ], 1);
  // Hold a read/write end so each release byte waits in the pipe for the next
  // native call rather than being dropped when no reader has it open.
  const release = await Deno.open(Deno.env.get("NEAT_TEST_RELEASE")!, {
    read: true,
    write: true,
  });
  const worker = new WorkerHandler(dir, "MSE", false);
  try {
    await worker.waitUntilReady();
    const options = {
      iterations: 1,
      disableRandomSamples: true,
      sparseRatio: 1,
      hardDeadlineTS: 4_102_444_800_000,
    };
    const first = worker.train(creature, options);
    const second = worker.train(creature, options);
    await waitForFile(Deno.env.get("NEAT_TEST_STARTED")!);
    // Give a second task that is not queued time to enter the native trainer too.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await release.write(new Uint8Array([1]));
    const firstResponse = await first;
    await release.write(new Uint8Array([1]));
    const secondResponse = await second;
    for (const response of [firstResponse, secondResponse]) {
      assertEquals(response.error, undefined, JSON.stringify(response));
      assert(response.train);
    }
    console.log("SERIAL_TRAINING_DONE");
  } finally {
    worker.terminate();
    release.close();
    await Deno.remove(dir, { recursive: true });
  }
}
