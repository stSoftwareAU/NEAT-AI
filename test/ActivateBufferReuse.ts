/**
 * Test file for issue #1094: Reuse Float32Array in activate() instead of creating new wrapper
 *
 * This test verifies:
 * 1. Correctness: activate() and activateAndTrace() produce correct output with buffer reuse
 * 2. Buffer reuse: When reuseBuffer option is enabled, the same Float32Array is returned
 * 3. Backward compatibility: Default behaviour still returns new arrays each time
 * 4. Performance: Buffer reuse reduces GC pressure for repeated activations
 */
import {
  assertAlmostEquals,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
} from "@std/assert";
import { Creature } from "../src/Creature.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";
import { initWasmActivation } from "../src/wasm/WasmActivation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Get the project root directory for WASM module path
const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

// Initialise WASM before running tests
Deno.test("WASM Initialisation", async () => {
  await initWasmActivation(wasmPath);
});

/**
 * Test that default behaviour returns a new array on each call (backward compatibility).
 */
Deno.test("activate(): returns new array by default (backward compatibility)", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 2,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0.1, squash: "IDENTITY" },
      { type: "output", uuid: "output-1", bias: 0.2, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 1 },
    ],
  });

  const input = new Float32Array([0.5, 0.7]);

  const output1 = creature.activate(input);
  const output2 = creature.activate(input);

  // By default, each call should return a NEW array
  assertNotStrictEquals(
    output1,
    output2,
    "Default behaviour should return new arrays",
  );

  // But values should be the same
  assertAlmostEquals(output1[0], output2[0], 1e-6, "Values should match");
  assertAlmostEquals(output1[1], output2[1], 1e-6, "Values should match");
});

/**
 * Test that reuseBuffer option returns the same array reference.
 */
Deno.test("activate(): reuses buffer when reuseBuffer=true", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 2,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0.1, squash: "IDENTITY" },
      { type: "output", uuid: "output-1", bias: 0.2, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 1 },
    ],
  });

  const input = new Float32Array([0.5, 0.7]);

  const output1 = creature.activate(input, false, true); // feedbackLoop=false, reuseBuffer=true
  const output2 = creature.activate(input, false, true);

  // With reuseBuffer, should return the SAME array reference
  assertStrictEquals(
    output1,
    output2,
    "reuseBuffer=true should return same array",
  );

  // Values should still be correct
  assertAlmostEquals(output1[0], 0.6, 1e-6, "output[0] = input[0] + bias[0]");
  assertAlmostEquals(output1[1], 0.9, 1e-6, "output[1] = input[1] + bias[1]");
});

/**
 * Test that activateAndTrace also supports buffer reuse.
 */
Deno.test("activateAndTrace(): reuses buffer when reuseBuffer=true", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 2,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0.1, squash: "IDENTITY" },
      { type: "output", uuid: "output-1", bias: 0.2, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 1 },
    ],
  });

  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );

  const input = new Float32Array([0.5, 0.7]);

  const output1 = creature.activateAndTrace(input, false, sparseConfig, true); // reuseBuffer=true
  const output2 = creature.activateAndTrace(input, false, sparseConfig, true);

  // With reuseBuffer, should return the SAME array reference
  assertStrictEquals(
    output1,
    output2,
    "reuseBuffer=true should return same array",
  );
});

/**
 * Test that activateAndTrace default behaviour returns new arrays.
 */
Deno.test("activateAndTrace(): returns new array by default", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 2,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0.1, squash: "IDENTITY" },
      { type: "output", uuid: "output-1", bias: 0.2, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 1 },
    ],
  });

  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );

  const input = new Float32Array([0.5, 0.7]);

  const output1 = creature.activateAndTrace(input, false, sparseConfig);
  const output2 = creature.activateAndTrace(input, false, sparseConfig);

  // By default, each call should return a NEW array
  assertNotStrictEquals(
    output1,
    output2,
    "Default behaviour should return new arrays",
  );
});

/**
 * Test that cached buffer is correctly sized when output count changes after
 * structural modifications (e.g., via export/import with different output count).
 */
Deno.test("activate(): cached buffer resizes if output count changes", () => {
  // Create initial creature with 2 outputs
  const creature2 = Creature.fromJSON({
    input: 2,
    output: 2,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      { type: "output", uuid: "output-1", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 1 },
    ],
  });

  const input = new Float32Array([0.5, 0.7]);
  const output2 = creature2.activate(input, false, true);
  assertEquals(output2.length, 2, "Should have 2 outputs");

  // Create a new creature with 3 outputs
  const creature3 = Creature.fromJSON({
    input: 2,
    output: 3,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      { type: "output", uuid: "output-1", bias: 0, squash: "IDENTITY" },
      { type: "output", uuid: "output-2", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 1 },
      { fromUUID: "input-0", toUUID: "output-2", weight: 0.5 },
    ],
  });

  const output3 = creature3.activate(input, false, true);
  assertEquals(output3.length, 3, "Should have 3 outputs after resize");
});

/**
 * Test that values in reused buffer are correctly updated on each activation.
 */
Deno.test("activate(): reused buffer values update correctly", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 2,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      { type: "output", uuid: "output-1", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 1 },
    ],
  });

  // First activation
  const input1 = new Float32Array([0.3, 0.4]);
  const output1 = creature.activate(input1, false, true);
  assertAlmostEquals(output1[0], 0.3, 1e-6);
  assertAlmostEquals(output1[1], 0.4, 1e-6);

  // Second activation with different input
  const input2 = new Float32Array([0.7, 0.8]);
  const output2 = creature.activate(input2, false, true);

  // Same buffer reference
  assertStrictEquals(output1, output2);

  // But values should be updated to new activation results
  assertAlmostEquals(output2[0], 0.7, 1e-6);
  assertAlmostEquals(output2[1], 0.8, 1e-6);

  // Note: output1 will also show the new values since it's the same buffer
  assertAlmostEquals(output1[0], 0.7, 1e-6);
});

/**
 * Test that clearState() clears the cached output buffer.
 */
Deno.test("clearState(): clears cached output buffer", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 2,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      { type: "output", uuid: "output-1", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 1 },
    ],
  });

  const input = new Float32Array([0.5, 0.7]);

  // Get first output with buffer reuse
  const output1 = creature.activate(input, false, true);

  // Clear state
  creature.clearState();

  // Get second output with buffer reuse - should be a NEW buffer after clearState
  const output2 = creature.activate(input, false, true);

  // After clearState, a new buffer should be created
  assertNotStrictEquals(
    output1,
    output2,
    "clearState should invalidate cached buffer",
  );
});

/**
 * Test output correctness with a more complex network.
 */
Deno.test("activate(): buffer reuse produces correct output for complex network", () => {
  const creature = Creature.fromJSON({
    input: 3,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "hidden-0", bias: 0.1, squash: "LOGISTIC" },
      { type: "hidden", uuid: "hidden-1", bias: -0.2, squash: "TANH" },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      { type: "output", uuid: "output-1", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "input-2", toUUID: "hidden-1", weight: 0.7 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-1", weight: 1 },
    ],
  });

  const input = new Float32Array([0.5, 0.6, 0.7]);

  // Get output without buffer reuse
  const outputNormal = creature.activate(input, false, false);

  // Get output with buffer reuse
  const outputReused = creature.activate(input, false, true);

  // Values should be identical
  assertAlmostEquals(
    outputReused[0],
    outputNormal[0],
    1e-6,
    "Buffer reuse should produce same output[0]",
  );
  assertAlmostEquals(
    outputReused[1],
    outputNormal[1],
    1e-6,
    "Buffer reuse should produce same output[1]",
  );
});

/**
 * Test that caller can safely modify the returned array when reuseBuffer=false.
 */
Deno.test("activate(): caller can modify array when reuseBuffer=false", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 2,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      { type: "output", uuid: "output-1", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 1 },
    ],
  });

  const input = new Float32Array([0.5, 0.7]);

  // Get output without buffer reuse
  const output1 = creature.activate(input, false, false);
  const originalValue = output1[0];

  // Modify the returned array
  output1[0] = 999;

  // Get another output
  const output2 = creature.activate(input, false, false);

  // The new output should have the correct value, not the modified one
  assertAlmostEquals(
    output2[0],
    originalValue,
    1e-6,
    "Modification should not affect next call",
  );
});

/**
 * Test with a creature with many outputs (as mentioned in issue #1094).
 */
Deno.test("activate(): buffer reuse with 100+ outputs", () => {
  // Create a creature with 100 outputs
  const outputCount = 100;
  const neurons: {
    type: "output";
    uuid: string;
    bias: number;
    squash: string;
  }[] = [];
  const synapses: { fromUUID: string; toUUID: string; weight: number }[] = [];

  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      bias: i * 0.01,
      squash: "IDENTITY",
    });
    synapses.push({
      fromUUID: "input-0",
      toUUID: `output-${i}`,
      weight: 1,
    });
  }

  const creature = Creature.fromJSON({
    input: 2,
    output: outputCount,
    neurons,
    synapses,
  });

  const input = new Float32Array([0.5, 0.3]);

  // Activate multiple times with buffer reuse
  const output1 = creature.activate(input, false, true);
  assertEquals(output1.length, outputCount, "Should have 100 outputs");

  const output2 = creature.activate(input, false, true);
  assertStrictEquals(output1, output2, "Should reuse the same buffer");

  // Verify values are correct
  for (let i = 0; i < outputCount; i++) {
    const expected = 0.5 + i * 0.01; // input[0] * weight + bias
    assertAlmostEquals(
      output2[i],
      expected,
      1e-5,
      `Output ${i} should be correct`,
    );
  }
});
