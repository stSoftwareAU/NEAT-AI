/**
 * Patch coverage: ensure the Intelligent Design barrel exports are exercised.
 *
 * These tests are intentionally lightweight; importing the modules executes the
 * re-export wiring so Codecov counts the added lines.
 */

import { assertEquals } from "@std/assert";

Deno.test("mod.ts exports Intelligent Design symbols", async () => {
  const neat = await import("../../mod.ts");

  assertEquals(typeof neat.scanForSquashImprovements, "function");
  assertEquals(typeof neat.combineImprovements, "function");
  assertEquals(typeof neat.applyNeuronChanges, "function");
  assertEquals(typeof neat.IntelligentDesignWorkerHandler, "function");
});

Deno.test("src/intelligentDesign/mod.ts exports key utilities", async () => {
  const id = await import("../../src/intelligentDesign/mod.ts");

  assertEquals(typeof id.scanForSquashImprovements, "function");
  assertEquals(typeof id.combineImprovements, "function");
  assertEquals(typeof id.safeWriteText, "function");
  assertEquals(typeof id.WorkerHandler, "function");
});
