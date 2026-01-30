/**
 * Issue #1258 - WASM activation could not be loaded in Deno Worker context.
 *
 * Verifies that Creature.activate() works correctly when called from a
 * Deno Worker, without requiring caller-set environment variables or
 * API options. The library should either load WASM successfully in the
 * worker or fall back to JS activation transparently.
 */
import { assertEquals } from "@std/assert";

Deno.test("Creature.activate() works in a Deno Worker without env vars", async () => {
  // Build the worker source as a string so the test runner does not pick up
  // a separate file as its own test module.
  const srcRoot = new URL("../../src/", import.meta.url).href;
  const workerSource = `
import { Creature } from "${srcRoot}Creature.ts";
try {
  const creature = new Creature(2, 2, { layers: [{ count: 4 }] });
  const input = new Float32Array([0.5, -0.3]);
  const output = creature.activate(input);
  self.postMessage({ success: true, output: Array.from(output) });
} catch (error) {
  self.postMessage({ success: false, output: [], error: String(error) });
}
`;

  // Write to a temporary file so the Worker can load it as a module.
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

    assertEquals(
      result.success,
      true,
      "Worker should activate creature successfully",
    );
    assertEquals(result.output.length, 2, "Should have 2 outputs");
    // Verify outputs are finite numbers (not NaN, not Infinity)
    for (const v of result.output) {
      assertEquals(
        Number.isFinite(v),
        true,
        `Output should be finite, got: ${v}`,
      );
    }
  } finally {
    try {
      await Deno.remove(tmpPath);
    } catch {
      // Best-effort cleanup
    }
  }
});
