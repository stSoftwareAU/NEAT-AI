import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
} from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { AddConnection } from "../../src/mutate/AddConnection.ts";

/**
 * Test suite for creative thinking creature creation optimisation.
 *
 * Issue #1040: Performance - Reduce JSON cloning in creative thinking creature creation.
 *
 * The creative thinking process in Neat.evolve() creates a clone of the fittest
 * creature to add random connections. Previously this used expensive JSON
 * serialisation/deserialisation:
 *   const creativeThinking = Creature.fromJSON(n.exportJSON());
 *
 * This has been optimised to use shallowClone():
 *   const creativeThinking = n.shallowClone();
 *
 * These tests verify that:
 * 1. shallowClone produces functionally equivalent results to JSON clone
 * 2. Deleting memetic from the clone doesn't affect the original
 * 3. Adding connections to the clone doesn't affect the original
 * 4. The optimisation provides a measurable performance improvement
 */

Deno.test("CreativeThinkingClone: shallowClone produces equivalent structure to JSON clone", () => {
  const original = new Creature(5, 3, {
    layers: [{ count: 10 }, { count: 8 }],
  });
  original.uuid = "creative-thinking-test";
  original.score = 0.95;
  original.memetic = {
    generation: 10,
    weights: {},
    biases: {},
    score: 0.9,
  };
  creatureValidate(original);

  // Create both types of clones
  const shallowClone = original.shallowClone();
  const jsonClone = Creature.fromJSON(original.exportJSON());

  // Verify structural equivalence
  assertEquals(
    shallowClone.input,
    jsonClone.input,
    "Input count should match",
  );
  assertEquals(
    shallowClone.output,
    jsonClone.output,
    "Output count should match",
  );
  assertEquals(
    shallowClone.neurons.length,
    jsonClone.neurons.length,
    "Neuron count should match",
  );
  assertEquals(
    shallowClone.synapses.length,
    jsonClone.synapses.length,
    "Synapse count should match",
  );

  // Verify neuron properties match
  for (let i = 0; i < shallowClone.neurons.length; i++) {
    assertEquals(
      shallowClone.neurons[i].uuid,
      jsonClone.neurons[i].uuid,
      `Neuron ${i} UUID should match`,
    );
    assertEquals(
      shallowClone.neurons[i].type,
      jsonClone.neurons[i].type,
      `Neuron ${i} type should match`,
    );
    if (shallowClone.neurons[i].type !== "input") {
      assertEquals(
        shallowClone.neurons[i].bias,
        jsonClone.neurons[i].bias,
        `Neuron ${i} bias should match`,
      );
      assertEquals(
        shallowClone.neurons[i].squash,
        jsonClone.neurons[i].squash,
        `Neuron ${i} squash should match`,
      );
    }
  }

  // Verify synapse properties match
  for (let i = 0; i < shallowClone.synapses.length; i++) {
    assertEquals(
      shallowClone.synapses[i].from,
      jsonClone.synapses[i].from,
      `Synapse ${i} from should match`,
    );
    assertEquals(
      shallowClone.synapses[i].to,
      jsonClone.synapses[i].to,
      `Synapse ${i} to should match`,
    );
    assertEquals(
      shallowClone.synapses[i].weight,
      jsonClone.synapses[i].weight,
      `Synapse ${i} weight should match`,
    );
  }
});

Deno.test("CreativeThinkingClone: deleting memetic from clone does not affect original", () => {
  const original = new Creature(3, 2, {
    layers: [{ count: 5 }],
  });
  creatureValidate(original);

  // Get a real neuron UUID from the creature for the memetic data
  const hiddenNeuronUUID = original.neurons[original.input].uuid;
  original.memetic = {
    generation: 5,
    weights: {},
    biases: { [hiddenNeuronUUID]: 0.1 },
    score: 0.8,
  };

  // Verify original has memetic
  assert(original.memetic !== undefined, "Original should have memetic");
  assertEquals(
    original.memetic.generation,
    5,
    "Original memetic generation should be 5",
  );

  // Create shallow clone and delete memetic
  const clone = original.shallowClone();
  assert(clone.memetic !== undefined, "Clone should initially have memetic");
  delete clone.memetic;

  // Verify original memetic is unchanged
  assert(
    original.memetic !== undefined,
    "Original memetic should not be deleted",
  );
  assertEquals(
    original.memetic.generation,
    5,
    "Original memetic generation should still be 5",
  );
  assertEquals(
    original.memetic.biases[hiddenNeuronUUID],
    0.1,
    "Original memetic biases should be unchanged",
  );

  // Verify clone has no memetic
  assertEquals(
    clone.memetic,
    undefined,
    "Clone memetic should be deleted",
  );
});

Deno.test("CreativeThinkingClone: adding connections to clone does not affect original", () => {
  const original = new Creature(5, 3, {
    layers: [{ count: 8 }],
  });
  creatureValidate(original);

  // Record original synapse count
  const originalSynapseCount = original.synapses.length;
  const originalWeights = original.synapses.map((s) => s.weight);

  // Create shallow clone and add connections (simulating creative thinking)
  const clone = original.shallowClone();
  const addConnection = new AddConnection(clone);

  // Add multiple connections
  for (let i = 0; i < 5; i++) {
    addConnection.mutate(undefined, { weightScale: 0.1 });
  }

  // Verify original is unchanged
  assertEquals(
    original.synapses.length,
    originalSynapseCount,
    "Original synapse count should be unchanged",
  );

  for (let i = 0; i < original.synapses.length; i++) {
    assertEquals(
      original.synapses[i].weight,
      originalWeights[i],
      `Original synapse ${i} weight should be unchanged`,
    );
  }

  // Clone may or may not have more synapses depending on available connections
  // Just verify both are valid
  creatureValidate(original);
  creatureValidate(clone);
});

Deno.test("CreativeThinkingClone: full creative thinking workflow preserves original", () => {
  // This test simulates the full creative thinking workflow from Neat.evolve()
  const fittest = new Creature(5, 3, {
    layers: [{ count: 10 }, { count: 8 }],
  });
  fittest.uuid = "fittest-creature";
  fittest.score = 0.99;
  creatureValidate(fittest);

  // Use real neuron UUIDs for the memetic data
  const hiddenNeuronUUID = fittest.neurons[fittest.input].uuid;
  fittest.memetic = {
    generation: 15,
    weights: {},
    biases: { [hiddenNeuronUUID]: 0.1 },
    score: 0.98,
  };

  // Record original state
  const originalJSON = JSON.stringify(fittest.exportJSON());
  const originalUUID = fittest.uuid;
  const originalScore = fittest.score;
  const originalMemeticGeneration = fittest.memetic?.generation;

  // Simulate creative thinking workflow using shallowClone (the optimisation)
  // This matches the actual implementation in Neat.evolve()
  const creativeThinking = fittest.shallowClone();
  delete creativeThinking.memetic;
  // Clear score to match behaviour of previous JSON clone approach
  // (exportJSON doesn't export score, so fromJSON wouldn't have it)
  delete creativeThinking.score;

  const weightScale = 1 / Math.max(creativeThinking.synapses.length, 1);
  const addConnection = new AddConnection(creativeThinking);

  // Add connections (simulating creativeThinkingConnectionCount iterations)
  for (let i = 0; i < 3; i++) {
    addConnection.mutate(undefined, { weightScale: weightScale });
  }

  // Verify the creative thinking creature is valid and has no memetic or score
  creatureValidate(creativeThinking);
  assertEquals(
    creativeThinking.memetic,
    undefined,
    "Creative thinking creature should have no memetic",
  );
  assertEquals(
    creativeThinking.score,
    undefined,
    "Creative thinking creature should have no score (to match JSON clone behaviour)",
  );

  // CRITICAL: Verify original fittest is completely unchanged
  assertEquals(
    fittest.uuid,
    originalUUID,
    "Fittest UUID should be unchanged",
  );
  assertEquals(
    fittest.score,
    originalScore,
    "Fittest score should be unchanged",
  );
  assertEquals(
    fittest.memetic?.generation,
    originalMemeticGeneration,
    "Fittest memetic generation should be unchanged",
  );
  assertEquals(
    JSON.stringify(fittest.exportJSON()),
    originalJSON,
    "Fittest export should be unchanged",
  );
});

Deno.test("CreativeThinkingClone: clone activation matches original before modifications", () => {
  const original = new Creature(4, 2, {
    layers: [{ count: 6 }],
  });
  creatureValidate(original);

  const clone = original.shallowClone();

  // Test multiple inputs before any modifications
  for (let i = 0; i < 10; i++) {
    const input = new Float32Array([
      Math.random(),
      Math.random(),
      Math.random(),
      Math.random(),
    ]);

    original.clearState();
    clone.clearState();

    const originalOutput = original.activate(input);
    const cloneOutput = clone.activate(input);

    for (let j = 0; j < originalOutput.length; j++) {
      assertAlmostEquals(
        originalOutput[j],
        cloneOutput[j],
        1e-10,
        `Output ${j} should match for input ${i}`,
      );
    }
  }
});

Deno.test("CreativeThinkingClone: clone UUID changes after modification", () => {
  const original = new Creature(3, 2, {
    layers: [{ count: 4 }],
  });
  original.uuid = "original-uuid";
  creatureValidate(original);

  const clone = original.shallowClone();
  assertEquals(
    clone.uuid,
    "original-uuid",
    "Clone UUID should initially match original",
  );

  // Modify clone (simulating adding connection)
  const addConnection = new AddConnection(clone);
  addConnection.mutate(undefined, { weightScale: 0.1 });
  clone.fix();

  // Clone UUID should change, original should not
  assertNotEquals(
    clone.uuid,
    "original-uuid",
    "Clone UUID should change after modification",
  );
  assertEquals(
    original.uuid,
    "original-uuid",
    "Original UUID should remain unchanged",
  );
});

Deno.test("CreativeThinkingClone: performance improvement over JSON clone", () => {
  // Create a moderately sized creature for performance testing
  const original = new Creature(50, 10, {
    layers: [{ count: 100 }, { count: 50 }],
  });
  original.uuid = "perf-test";
  original.score = 0.95;
  original.memetic = {
    generation: 20,
    weights: {},
    biases: {},
    score: 0.9,
  };
  creatureValidate(original);

  const iterations = 50;

  // Benchmark JSON clone (old method)
  performance.mark("json-start");
  for (let i = 0; i < iterations; i++) {
    const jsonClone = Creature.fromJSON(original.exportJSON());
    delete jsonClone.memetic;
    // Validate to ensure it's a proper clone
    creatureValidate(jsonClone);
  }
  performance.mark("json-end");
  const jsonDuration = performance.measure("json", "json-start", "json-end")
    .duration;

  // Benchmark shallow clone (new method)
  performance.mark("shallow-start");
  for (let i = 0; i < iterations; i++) {
    const shallowClone = original.shallowClone();
    delete shallowClone.memetic;
    // Validate to ensure it's a proper clone
    creatureValidate(shallowClone);
  }
  performance.mark("shallow-end");
  const shallowDuration = performance.measure(
    "shallow",
    "shallow-start",
    "shallow-end",
  ).duration;

  const speedup = jsonDuration / shallowDuration;
  console.info(
    `Creative Thinking Clone Performance: JSON clone: ${
      jsonDuration.toFixed(2)
    }ms, ` +
      `Shallow clone: ${shallowDuration.toFixed(2)}ms, ` +
      `Speedup: ${speedup.toFixed(2)}x`,
  );

  // Shallow clone should be faster
  assert(
    shallowDuration < jsonDuration,
    `Shallow clone (${
      shallowDuration.toFixed(2)
    }ms) should be faster than JSON clone (${jsonDuration.toFixed(2)}ms)`,
  );
});

Deno.test("CreativeThinkingClone: forwardOnly flag preserved through creative thinking", () => {
  const original = new Creature(3, 2, {
    layers: [{ count: 4 }],
  });
  original.forwardOnly = true;
  creatureValidate(original);

  // Simulate creative thinking workflow
  const creativeThinking = original.shallowClone();
  delete creativeThinking.memetic;

  // Verify forwardOnly is preserved
  assertEquals(
    creativeThinking.forwardOnly,
    true,
    "forwardOnly flag should be preserved in creative thinking clone",
  );

  // Add connection and verify still valid
  const addConnection = new AddConnection(creativeThinking);
  addConnection.mutate(undefined, { weightScale: 0.1 });
  creatureValidate(creativeThinking);

  // Original should still be forwardOnly
  assertEquals(
    original.forwardOnly,
    true,
    "Original forwardOnly should be unchanged",
  );
});
