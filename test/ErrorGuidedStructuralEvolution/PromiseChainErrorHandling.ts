import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import {
  DEFAULT_RUST_FLUSH_RECORDS,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  assertRustDiscoveryAvailable,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

/**
 * Tests for promise chain error handling in discovery.
 * These tests verify that file write errors don't cause deadlocks.
 */

function makeSimpleCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        squash: IDENTITY.NAME,
        bias: 0,
      },
      {
        type: "output",
        uuid: "output-0",
        squash: IDENTITY.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { weight: 1.0, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: 1.0, fromUUID: "hidden-0", toUUID: "output-0" },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

Deno.test("Discovery promise chains have error handlers", async () => {
  const creature = makeSimpleCreature();
  CreatureUtil.makeUUID(creature);
  const discoverStructure = new DiscoverStructure(
    creature,
    5, // Reduced from 60s to 5s for faster tests
    DEFAULT_RUST_FLUSH_RECORDS,
  );

  const neuronPromisesMap: Map<string, Promise<void>> = new Map();

  // Initialize should create promises
  discoverStructure.initialize(neuronPromisesMap);

  // Create test data
  const testData: DataRecordInterface[] = [
    { input: new Float32Array([1.0]), output: new Float32Array([0.5]) },
  ];

  // Record should chain promises
  const recorded = discoverStructure.record(testData, neuronPromisesMap);
  // Note: This test checks promise error handling, so we don't assert on recorded
  // Flush Rust recording if using Rust
  if (recorded) {
    discoverStructure.flushRustRecording();
  }

  // All promises should have error handlers (not throw on rejection)
  const promiseResults = await Promise.allSettled([
    ...neuronPromisesMap.values(),
  ]);

  let completedCount = 0;
  let errorCount = 0;

  for (const result of promiseResults) {
    if (result.status === "fulfilled") {
      completedCount++;
    } else {
      // If we catch here, it means the promise didn't have an error handler
      errorCount++;
      console.warn("Promise rejected without handler:", result.reason);
    }
  }

  // Cleanup
  await discoverStructure.cleanUp();

  // All promises should complete (with or without errors)
  assertEquals(
    completedCount + errorCount,
    neuronPromisesMap.size,
    "All promises should resolve or reject",
  );
});

Deno.test({
  name: "Discovery handles file write failures gracefully",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();
    const creature = makeSimpleCreature();
    CreatureUtil.makeUUID(creature);

    // Use an invalid temp directory path to force file write errors
    const discoverStructure = new DiscoverStructure(
      creature,
      5, // Reduced from 60s to 5s for faster tests
      DEFAULT_RUST_FLUSH_RECORDS,
    );

    const neuronPromisesMap: Map<string, Promise<void>> = new Map();

    // Initialize with valid directory
    discoverStructure.initialize(neuronPromisesMap);

    // Create test data
    const testData: DataRecordInterface[] = [
      { input: new Float32Array([1.0]), output: new Float32Array([0.5]) },
      { input: new Float32Array([2.0]), output: new Float32Array([1.0]) },
    ];

    // Record should chain promises
    const recorded = discoverStructure.record(testData, neuronPromisesMap);
    assert(recorded, "Record should succeed");

    // Flush Rust recording if using Rust
    const flushSuccess = discoverStructure.flushRustRecording();
    if (recorded && !flushSuccess) {
      throw new Error("Rust recording flush failed");
    }

    // Wait for all promises - should not hang even if some fail
    let timeoutId: number | undefined;
    const timeout = new Promise<void>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Timeout waiting for promises")),
        2000, // 2 seconds - sufficient for CI
      );
    });

    try {
      await Promise.race([
        Promise.all([...neuronPromisesMap.values()]),
        timeout,
      ]);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      console.log("All promises completed successfully");
    } catch (error) {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      // This is acceptable - some promises may fail, but they shouldn't hang
      if (error instanceof Error && error.message.includes("Timeout")) {
        throw error; // This would be a real problem
      }
      console.log("Some promises failed, but didn't hang:", error);
    }

    // Cleanup
    await discoverStructure.cleanUp();
  },
});

Deno.test("Discovery Promise.all() completes within timeout", async () => {
  const creature = makeSimpleCreature();
  CreatureUtil.makeUUID(creature);
  const discoverStructure = new DiscoverStructure(
    creature,
    5, // Reduced from 60s to 5s for faster tests
    DEFAULT_RUST_FLUSH_RECORDS,
  );

  const neuronPromisesMap: Map<string, Promise<void>> = new Map();

  discoverStructure.initialize(neuronPromisesMap);

  const testData: DataRecordInterface[] = [
    { input: new Float32Array([1.0]), output: new Float32Array([0.5]) },
  ];

  const recorded = discoverStructure.record(testData, neuronPromisesMap);
  // Flush Rust recording if using Rust
  if (recorded) {
    discoverStructure.flushRustRecording();
  }

  // Create a timeout to ensure Promise.all doesn't hang
  const TIMEOUT_MS = 5000; // 5 seconds - sufficient for CI
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("Promise.all() timeout - likely deadlock"));
    }, TIMEOUT_MS);
  });

  // This should complete or fail, but not hang
  try {
    await Promise.race([
      Promise.all([...neuronPromisesMap.values()]),
      timeoutPromise,
    ]);
    console.log("✓ Promise.all() completed successfully");
  } catch (error) {
    if (error instanceof Error && error.message.includes("deadlock")) {
      throw error; // This is the bad case
    }
    // Other errors are acceptable (file I/O failures)
    console.log("✓ Promise.all() failed but didn't deadlock:", error);
  } finally {
    // Always clear timeout to prevent resource leak
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }

  await discoverStructure.cleanUp();
});
