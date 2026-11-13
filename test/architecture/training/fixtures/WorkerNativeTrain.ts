// Exercises the production WorkerHandler → WorkerProcessor → trainDirAsync path.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { initWasmForTests } from "../../../_initWasm.ts";

if (import.meta.main) {
  await initWasmForTests();
  const input = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../fixtures/native-backprop/ffi-response-new-timed-out-expired.json",
        import.meta.url,
      ),
    ),
  );
  const creature = Creature.fromJSON(JSON.parse(input.bestCreatureJson));
  const dir = makeDataDir([
    { input: new Float32Array([0.5]), output: new Float32Array([1]) },
  ], 1);
  const worker = new WorkerHandler(dir, "MSE", false);
  try {
    await worker.waitUntilReady();
    const response = await worker.train(creature, {
      iterations: 1,
      disableRandomSamples: true,
      sparseRatio: 1,
      hardDeadlineTS: 4_102_444_800_000,
    });
    const requestPath = Deno.env.get("NEAT_TEST_REQUEST")!;
    if (Deno.args.includes("--error")) {
      assert(response.error, JSON.stringify(response));
      assertStringIncludes(
        response.error.message,
        "native fixture rejected training",
      );
      assertStringIncludes(
        response.error.message,
        Deno.args.includes("--cli") ? "exit 3" : "status 2",
      );
      assertEquals(response.train, undefined);
    } else {
      const expected = JSON.parse(
        await Deno.readTextFile(Deno.env.get("NEAT_TEST_RESPONSE")!),
      );
      assertEquals(response.error, undefined);
      assert(response.train);
      assertEquals(response.train.error, expected.bestMse);
      assertEquals(response.train.timedOut, expected.timedOut);
      assertEquals(response.train.bestMeasure, expected.bestMeasure?.kind);
      const trained = Creature.fromJSON(response.train.creature);
      const golden = Creature.fromJSON(JSON.parse(expected.bestCreatureJson));
      // Training also adds provenance tags; the learned genome matches the capture.
      assertEquals(trained.exportJSON().neurons, golden.exportJSON().neurons);
      assertEquals(trained.exportJSON().synapses, golden.exportJSON().synapses);
      assertEquals(trained.semanticVersion, golden.semanticVersion);
    }
    if (!Deno.args.includes("--cli")) {
      const request = JSON.parse(await Deno.readTextFile(requestPath));
      assertEquals(
        "deadlineEpochMs" in request,
        !Deno.args.includes("--legacy"),
      );
      // Completed and failed calls release the bridge's own working directory.
      let removed = false;
      try {
        await Deno.stat(request.outputDir);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
        removed = true;
      }
      assertEquals(removed, true);
    }
    console.log("WORKER_RESULT_VERIFIED");
  } finally {
    worker.terminate();
    await Deno.remove(dir, { recursive: true });
  }
}
