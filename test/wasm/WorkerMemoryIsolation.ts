/**
 * Worker Memory Isolation Tests
 *
 * Issue #1505 - Memory leak detection tests for WASM activation lifecycle.
 *
 * Verifies that:
 * 1. Workers can activate creatures and terminate cleanly
 * 2. Multiple worker spawn/terminate cycles complete without errors
 * 3. Worker WASM activation is independent of the parent process cache
 */

import { assert, assertEquals } from "@std/assert";

/**
 * Helper to spawn a worker that activates a creature and returns the result.
 */
async function spawnActivationWorker(
  srcRoot: string,
): Promise<{ success: boolean; output: number[] }> {
  const workerSource = `
import { Creature } from "${srcRoot}Creature.ts";
try {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "LOGISTIC" }],
    outputLayer: { squash: "IDENTITY" },
  });
  const input = new Float32Array([0.5, 0.8]);
  const output = creature.activate(input);

  // Dispose WASM resources before reporting
  creature.disposeWasm();
  creature.dispose();

  self.postMessage({ success: true, output: Array.from(output) });
} catch (error) {
  self.postMessage({ success: false, output: [], error: String(error) });
}
`;

  const tmpPath = await Deno.makeTempFile({ suffix: ".ts" });
  await Deno.writeTextFile(tmpPath, workerSource);

  try {
    const worker = new Worker(new URL(`file://${tmpPath}`).href, {
      type: "module",
    });

    const result = await new Promise<{ success: boolean; output: number[] }>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error("Worker timed out after 30 seconds"));
        }, 30_000);

        worker.onmessage = (e: MessageEvent) => {
          clearTimeout(timeout);
          resolve(e.data);
        };

        worker.onerror = (e: Event) => {
          clearTimeout(timeout);
          reject(new Error(`Worker error: ${(e as ErrorEvent).message}`));
        };
      },
    );

    worker.terminate();
    return result;
  } finally {
    try {
      await Deno.remove(tmpPath);
    } catch {
      // Best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// Worker spawn/terminate lifecycle
// ---------------------------------------------------------------------------

Deno.test("WorkerMemoryIsolation: worker activates creature and terminates cleanly", async () => {
  const srcRoot = new URL("../../src/", import.meta.url).href;
  const result = await spawnActivationWorker(srcRoot);

  assertEquals(
    result.success,
    true,
    "Worker should activate creature successfully",
  );
  assertEquals(result.output.length, 1, "Should have 1 output");
  assert(
    Number.isFinite(result.output[0]),
    `Output should be finite, got: ${result.output[0]}`,
  );
});

Deno.test("WorkerMemoryIsolation: multiple worker cycles complete without errors", async () => {
  const srcRoot = new URL("../../src/", import.meta.url).href;
  const CYCLES = 3;

  const results = await Promise.all(
    Array.from({ length: CYCLES }, () => spawnActivationWorker(srcRoot)),
  );

  for (let i = 0; i < CYCLES; i++) {
    const result = results[i];
    assertEquals(
      result.success,
      true,
      `Worker cycle ${i} should succeed`,
    );
    assertEquals(result.output.length, 1, `Cycle ${i}: should have 1 output`);
    assert(
      Number.isFinite(result.output[0]),
      `Cycle ${i}: output should be finite, got: ${result.output[0]}`,
    );
  }
});

Deno.test("WorkerMemoryIsolation: worker dispose does not affect parent WASM state", async () => {
  const srcRoot = new URL("../../src/", import.meta.url).href;

  // Import in parent to establish WASM state
  const { Creature } = await import("../../src/Creature.ts");

  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "LOGISTIC" }],
    outputLayer: { squash: "IDENTITY" },
  });
  const input = new Float32Array([0.5, 0.8]);

  try {
    // Activate in parent
    const parentOutput = creature.activate(input);
    assert(
      creature.cachedWasmActivation !== undefined,
      "Parent should have cached WASM before worker",
    );

    // Spawn worker that activates and disposes its own creature
    const workerResult = await spawnActivationWorker(srcRoot);
    assertEquals(workerResult.success, true, "Worker should succeed");

    // Parent's cached activation should still be intact
    assert(
      creature.cachedWasmActivation !== undefined,
      "Parent cached WASM should survive worker termination",
    );

    // Parent should still produce the same output
    const parentOutputAfter = creature.activate(input);
    assertEquals(
      parentOutputAfter.length,
      parentOutput.length,
      "Parent output length should remain consistent",
    );
    for (let i = 0; i < parentOutput.length; i++) {
      assertEquals(
        parentOutputAfter[i],
        parentOutput[i],
        `Parent output[${i}] should remain consistent after worker termination`,
      );
    }
  } finally {
    creature.dispose();
  }
});
