import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
} from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "../src/Creature.ts";
import { creatureValidate } from "../src/architecture/CreatureValidate.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Test suite for Creature.shallowClone() method.
 *
 * Issue #1025: Performance optimisation - implement shallow copy for fittest
 * creature instead of JSON clone (exportJSON/fromJSON).
 *
 * The shallow clone should:
 * 1. Create a new Creature instance with the same structure references
 * 2. Copy mutable state (score, uuid, memetic, tags)
 * 3. Produce identical activation outputs as the original
 * 4. Be significantly faster than JSON-based cloning for large creatures
 * 5. Ensure the clone is independent - mutations don't affect the original
 */

Deno.test("shallowClone - basic structure preservation", () => {
  const original = new Creature(3, 2, {
    layers: [{ count: 4 }],
  });
  creatureValidate(original);

  const clone = original.shallowClone();
  creatureValidate(clone);

  // Basic structure should match
  assertEquals(clone.input, original.input, "Input count mismatch");
  assertEquals(clone.output, original.output, "Output count mismatch");
  assertEquals(
    clone.neurons.length,
    original.neurons.length,
    "Neuron count mismatch",
  );
  assertEquals(
    clone.synapses.length,
    original.synapses.length,
    "Synapse count mismatch",
  );
});

Deno.test("shallowClone - activation output equivalence", () => {
  const original = new Creature(3, 2, {
    layers: [{ count: 5 }, { count: 3 }],
  });
  creatureValidate(original);

  const clone = original.shallowClone();

  // Test multiple random inputs
  for (let i = 0; i < 20; i++) {
    const input = new Float32Array([
      Math.random(),
      Math.random(),
      Math.random(),
    ]);

    // Clear state to ensure clean activation
    original.clearState();
    clone.clearState();

    const originalOutput = original.activate(input);
    const cloneOutput = clone.activate(input);

    for (let j = 0; j < originalOutput.length; j++) {
      assertAlmostEquals(
        originalOutput[j],
        cloneOutput[j],
        1e-10,
        `Output mismatch at index ${j} for input ${i}`,
      );
    }
  }
});

Deno.test("shallowClone - mutable state copying", () => {
  const original = new Creature(2, 1, {
    layers: [{ count: 3 }],
  });

  // Set up mutable state
  original.uuid = "test-uuid-12345";
  original.score = 0.95;
  original.memetic = {
    generation: 5,
    weights: {},
    biases: {},
    score: 0.95,
  };
  addTag(original, "test-tag", "test-value");
  addTag(original, "error", "0.05");

  const clone = original.shallowClone();

  // Check mutable state is copied
  assertEquals(clone.uuid, original.uuid, "UUID should be copied");
  assertEquals(clone.score, original.score, "Score should be copied");
  assertEquals(clone.memetic?.generation, 5, "Memetic should be copied");

  const tagValue = getTag(clone, "test-tag");
  assertEquals(tagValue, "test-value", "Tags should be copied");
});

Deno.test("shallowClone - independence from original (neuron modification)", () => {
  const original = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });
  creatureValidate(original);

  // Record original neuron biases
  const originalBiases = original.neurons.map((n) => n.bias);

  const clone = original.shallowClone();
  creatureValidate(clone);

  // Modify clone's neuron biases
  for (let i = original.input; i < clone.neurons.length; i++) {
    clone.neurons[i].bias += 10;
  }

  // Original should be unchanged
  for (let i = 0; i < original.neurons.length; i++) {
    assertEquals(
      original.neurons[i].bias,
      originalBiases[i],
      `Original neuron ${i} bias was modified unexpectedly`,
    );
  }
});

Deno.test("shallowClone - independence from original (synapse modification)", () => {
  const original = new Creature(2, 2, {
    layers: [{ count: 3 }],
  });
  creatureValidate(original);

  // Record original synapse weights
  const originalWeights = original.synapses.map((s) => s.weight);

  const clone = original.shallowClone();
  creatureValidate(clone);

  // Modify clone's synapse weights
  for (const synapse of clone.synapses) {
    synapse.weight *= 2;
  }

  // Original should be unchanged
  for (let i = 0; i < original.synapses.length; i++) {
    assertEquals(
      original.synapses[i].weight,
      originalWeights[i],
      `Original synapse ${i} weight was modified unexpectedly`,
    );
  }
});

Deno.test("shallowClone - independence from original (tags modification)", () => {
  const original = new Creature(2, 1);
  addTag(original, "original-tag", "original-value");

  const clone = original.shallowClone();

  // Modify clone's tags
  addTag(clone, "clone-tag", "clone-value");

  // Original should not have the clone's tag
  // Note: getTag returns null (not undefined) when tag doesn't exist
  const originalCloneTag = getTag(original, "clone-tag");
  assertEquals(
    originalCloneTag,
    null,
    "Original should not have clone's tag",
  );

  // Clone should have both tags
  const cloneOriginalTag = getTag(clone, "original-tag");
  const cloneCloneTag = getTag(clone, "clone-tag");
  assertEquals(
    cloneOriginalTag,
    "original-value",
    "Clone should have original tag",
  );
  assertEquals(cloneCloneTag, "clone-value", "Clone should have its own tag");
});

Deno.test("shallowClone - large creature activation equivalence", () => {
  // Create a larger creature to test with
  const original = new Creature(50, 10, {
    layers: [
      { count: 100 },
      { count: 50 },
    ],
  });
  creatureValidate(original);

  const clone = original.shallowClone();
  creatureValidate(clone);

  // Test with multiple inputs
  for (let i = 0; i < 10; i++) {
    const input = new Float32Array(50);
    for (let j = 0; j < 50; j++) {
      input[j] = Math.random();
    }

    original.clearState();
    clone.clearState();

    const originalOutput = original.activate(input);
    const cloneOutput = clone.activate(input);

    for (let j = 0; j < originalOutput.length; j++) {
      assertAlmostEquals(
        originalOutput[j],
        cloneOutput[j],
        1e-10,
        `Large creature output mismatch at index ${j}`,
      );
    }
  }
});

Deno.test("shallowClone - uuid generation after modification", () => {
  const original = new Creature(2, 1, {
    layers: [{ count: 3 }],
  });
  original.uuid = "original-uuid";

  const clone = original.shallowClone();
  assertEquals(clone.uuid, "original-uuid", "Initial UUID should match");

  // Modifying the clone should clear its UUID
  clone.neurons[original.input].bias += 1;
  clone.fix();

  // Clone's UUID should be different or cleared after modification
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

Deno.test("shallowClone - semantic version preservation", () => {
  const original = new Creature(2, 1);
  original.semanticVersion = "4.1.2";

  const clone = original.shallowClone();

  assertEquals(
    clone.semanticVersion,
    "4.1.2",
    "Semantic version should be preserved",
  );
});

Deno.test("shallowClone - forwardOnly flag preservation", () => {
  const original = new Creature(2, 1);
  original.forwardOnly = true;

  const clone = original.shallowClone();

  assertEquals(
    clone.forwardOnly,
    true,
    "forwardOnly flag should be preserved",
  );
});

Deno.test("shallowClone - activateAndTrace equivalence", () => {
  const original = new Creature(3, 2, {
    layers: [{ count: 4 }],
  });
  creatureValidate(original);

  const clone = original.shallowClone();
  creatureValidate(clone);

  const sparseConfigOriginal = new SparseConfig(
    original.exportJSON(),
    createBackPropagationConfig({}),
  );
  const sparseConfigClone = new SparseConfig(
    clone.exportJSON(),
    createBackPropagationConfig({}),
  );

  for (let i = 0; i < 10; i++) {
    const input = new Float32Array([
      Math.random(),
      Math.random(),
      Math.random(),
    ]);

    original.clearState();
    clone.clearState();

    const originalOutput = original.activateAndTrace(
      input,
      false,
      sparseConfigOriginal,
    );
    const cloneOutput = clone.activateAndTrace(input, false, sparseConfigClone);

    for (let j = 0; j < originalOutput.length; j++) {
      assertAlmostEquals(
        originalOutput[j],
        cloneOutput[j],
        1e-10,
        `activateAndTrace output mismatch at index ${j}`,
      );
    }
  }
});

Deno.test("shallowClone - performance benchmark vs JSON clone", () => {
  // Create a reasonably large creature
  const original = new Creature(100, 20, {
    layers: [
      { count: 200 },
      { count: 100 },
    ],
  });
  original.uuid = "benchmark-uuid";
  original.score = 0.99;
  addTag(original, "benchmark", "true");

  const iterations = 100;

  // Benchmark JSON clone
  performance.mark("json-start");
  for (let i = 0; i < iterations; i++) {
    const jsonClone = Creature.fromJSON(original.exportJSON());
    jsonClone.uuid = original.uuid;
    jsonClone.score = original.score;
  }
  performance.mark("json-end");
  const jsonDuration = performance.measure("json", "json-start", "json-end")
    .duration;

  // Benchmark shallow clone
  performance.mark("shallow-start");
  for (let i = 0; i < iterations; i++) {
    const _shallowClone = original.shallowClone();
  }
  performance.mark("shallow-end");
  const shallowDuration = performance.measure(
    "shallow",
    "shallow-start",
    "shallow-end",
  ).duration;

  const speedup = jsonDuration / shallowDuration;
  console.info(
    `Performance: JSON clone: ${jsonDuration.toFixed(2)}ms, ` +
      `Shallow clone: ${shallowDuration.toFixed(2)}ms, ` +
      `Speedup: ${speedup.toFixed(2)}x`,
  );

  // Shallow clone should be faster
  assert(
    shallowDuration < jsonDuration,
    `Shallow clone (${shallowDuration}ms) should be faster than JSON clone (${jsonDuration}ms)`,
  );
});

Deno.test("shallowClone - structural equivalence with fromJSON", () => {
  // Create a creature with a modern semantic version that won't be upgraded
  const original = new Creature(5, 3, {
    layers: [{ count: 10 }],
    semanticVersion: "1.0.0",
  });
  original.uuid = "equivalence-test";
  original.score = 0.88;
  addTag(original, "method", "shallow");

  const shallowClone = original.shallowClone();
  const jsonClone = Creature.fromJSON(original.exportJSON());
  jsonClone.uuid = original.uuid;
  jsonClone.score = original.score;

  // Compare structural properties (not exports which may differ in version)
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

  // Compare neuron properties
  for (let i = 0; i < shallowClone.neurons.length; i++) {
    const shallowNeuron = shallowClone.neurons[i];
    const jsonNeuron = jsonClone.neurons[i];
    assertEquals(
      shallowNeuron.uuid,
      jsonNeuron.uuid,
      `Neuron ${i} UUID mismatch`,
    );
    assertEquals(
      shallowNeuron.type,
      jsonNeuron.type,
      `Neuron ${i} type mismatch`,
    );
    if (shallowNeuron.type !== "input") {
      assertEquals(
        shallowNeuron.bias,
        jsonNeuron.bias,
        `Neuron ${i} bias mismatch`,
      );
      assertEquals(
        shallowNeuron.squash,
        jsonNeuron.squash,
        `Neuron ${i} squash mismatch`,
      );
    }
  }

  // Compare synapse properties
  for (let i = 0; i < shallowClone.synapses.length; i++) {
    const shallowSynapse = shallowClone.synapses[i];
    const jsonSynapse = jsonClone.synapses[i];
    assertEquals(
      shallowSynapse.from,
      jsonSynapse.from,
      `Synapse ${i} from mismatch`,
    );
    assertEquals(shallowSynapse.to, jsonSynapse.to, `Synapse ${i} to mismatch`);
    assertEquals(
      shallowSynapse.weight,
      jsonSynapse.weight,
      `Synapse ${i} weight mismatch`,
    );
    assertEquals(
      shallowSynapse.type,
      jsonSynapse.type,
      `Synapse ${i} type mismatch`,
    );
  }
});
