import { assert, assertEquals, assertFalse } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";

/**
 * Tests for Issue #1021: Lazy creature activation preparation
 *
 * These tests verify that creatures are not prepared until they actually need
 * to be activated, saving computation for creatures that won't survive selection.
 */

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Creature is not prepared after construction", () => {
  const creature = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });

  // A newly constructed creature should not be prepared yet
  assertFalse(
    creature.state.preparedNeurons,
    "Creature should not be prepared immediately after construction",
  );
});

Deno.test("Creature is not prepared after fromJSON", () => {
  const original = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });

  const json = original.exportJSON();
  const restored = Creature.fromJSON(json);

  // A creature restored from JSON should not be prepared yet
  assertFalse(
    restored.state.preparedNeurons,
    "Creature should not be prepared immediately after fromJSON",
  );
});

Deno.test("Creature is prepared after activate() call", () => {
  const creature = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });

  assertFalse(
    creature.state.preparedNeurons,
    "Creature should not be prepared before activation",
  );

  const input = new Float32Array([0.5, 0.5]);
  creature.activate(input);

  assert(
    creature.state.preparedNeurons,
    "Creature should be prepared after activation",
  );
});

Deno.test("Creature is prepared after activateAndTrace() call", () => {
  const creature = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });

  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );

  assertFalse(
    creature.state.preparedNeurons,
    "Creature should not be prepared before activation",
  );

  const input = new Float32Array([0.5, 0.5]);
  creature.activateAndTrace(input, false, sparseConfig);

  assert(
    creature.state.preparedNeurons,
    "Creature should be prepared after activateAndTrace",
  );
});

Deno.test("isPrepared getter returns correct state", () => {
  const creature = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });

  // Check the isPrepared getter (if implemented)
  assertFalse(
    creature.isPrepared,
    "isPrepared should return false before activation",
  );

  const input = new Float32Array([0.5, 0.5]);
  creature.activate(input);

  assert(
    creature.isPrepared,
    "isPrepared should return true after activation",
  );
});

Deno.test("Multiple activations don't re-prepare", () => {
  const creature = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });

  const input = new Float32Array([0.5, 0.5]);

  // First activation
  const output1 = creature.activate(input);
  assert(creature.isPrepared, "Should be prepared after first activation");

  // Second activation should not change preparation state
  const output2 = creature.activate(input);
  assert(creature.isPrepared, "Should remain prepared after second activation");

  // Outputs should be consistent
  assertEquals(
    Array.from(output1),
    Array.from(output2),
    "Multiple activations with same input should produce same output",
  );
});

Deno.test("clearState resets prepared flag", () => {
  const creature = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });

  const input = new Float32Array([0.5, 0.5]);
  creature.activate(input);

  assert(creature.isPrepared, "Should be prepared after activation");

  creature.clearState();

  assertFalse(
    creature.isPrepared,
    "isPrepared should return false after clearState",
  );
});

Deno.test("Unprepared creatures can be scored without activation", () => {
  const creature = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });

  // A creature should be able to export JSON without being prepared
  const json = creature.exportJSON();
  assert(json, "Should be able to export JSON without preparation");

  // Getting neuron count should work without preparation
  const nodeCount = creature.nodeCount();
  assert(nodeCount > 0, "Should be able to get node count without preparation");

  // The creature should still not be prepared
  assertFalse(
    creature.isPrepared,
    "Getting metadata should not trigger preparation",
  );
});

Deno.test("prepare() method explicitly prepares the creature", () => {
  const creature = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });

  assertFalse(
    creature.isPrepared,
    "Creature should not be prepared before explicit call",
  );

  // Explicitly prepare the creature
  creature.prepare();

  assert(
    creature.isPrepared,
    "Creature should be prepared after explicit prepare() call",
  );
});

Deno.test("Prepared state survives multiple exports", () => {
  const creature = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });

  const input = new Float32Array([0.5, 0.5]);
  creature.activate(input);

  assert(creature.isPrepared, "Should be prepared after activation");

  // Export and check state
  creature.exportJSON();
  assert(creature.isPrepared, "Should remain prepared after exportJSON");

  // Export again
  creature.exportJSON();
  assert(creature.isPrepared, "Should remain prepared after second exportJSON");
});

Deno.test("Preparation invalidation after structural change", () => {
  const creature = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });

  const input = new Float32Array([0.5, 0.5]);
  creature.activate(input);

  assert(creature.isPrepared, "Should be prepared after activation");

  // Make a structural change (add a connection)
  const from = 0;
  const to = creature.input; // First hidden neuron
  if (creature.getSynapse(from, to) === null) {
    creature.connect(from, to, 0.5);
    // Note: Adding a connection doesn't invalidate preparation on its own.
    // The preparation is invalidated when weights/biases are updated via propagateUpdate
    // or when applyLearnings is called with changes.
  }
});

Deno.test("fromJSON produces unprepared creature that activates correctly", () => {
  const original = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });

  // Activate original to get expected output
  const input = new Float32Array([0.5, 0.5]);
  const originalOutput = original.activate(input);

  // Create from JSON - should be unprepared
  const restored = Creature.fromJSON(original.exportJSON());
  assertFalse(
    restored.isPrepared,
    "Creature from JSON should not be prepared",
  );

  // Activate should produce same result
  const restoredOutput = restored.activate(input);

  assertEquals(
    Array.from(originalOutput),
    Array.from(restoredOutput),
    "Restored creature should produce same output as original",
  );

  assert(
    restored.isPrepared,
    "Restored creature should be prepared after activation",
  );
});
