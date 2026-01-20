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
import { initWasmActivation } from "../src/wasm/WasmActivation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Get the project root directory for WASM module path
const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

Deno.test("WASM Initialisation", async () => {
  await initWasmActivation(wasmPath);
});

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

/**
 * Test suite for ensuring breeding/mutation processes cannot modify the fittest creature.
 *
 * The reviewer's concern: "Please make sure that later mutating/breeding processes
 * can never modify the 'fittest' creature. The 'fittest' creature should be frozen
 * logically if not actually. Breeding/Mutating leads to a new creature, never
 * modifies in any way the fittest creature."
 *
 * These tests verify that once a shallow clone is made (as used in Neat.evolve()),
 * the original creature remains completely unchanged regardless of what operations
 * are performed on the clone.
 */
Deno.test("shallowClone - fittest creature protection: mutation cannot affect original", async (t) => {
  const original = new Creature(3, 2, {
    layers: [{ count: 4 }],
  });
  original.uuid = "fittest-creature-uuid";
  original.score = 0.95;
  creatureValidate(original);

  // Record original state
  const originalJSON = JSON.stringify(original.exportJSON());
  const originalBiases = original.neurons.map((n) => n.bias);
  const originalWeights = original.synapses.map((s) => s.weight);

  // Create a clone (simulating what happens in Neat.evolve())
  const clone = original.shallowClone();

  await t.step("heavy mutation of clone preserves original", () => {
    // Heavily mutate the clone
    for (let i = original.input; i < clone.neurons.length; i++) {
      clone.neurons[i].bias = Math.random() * 100 - 50;
      clone.neurons[i].squash = "RELU";
    }
    for (const synapse of clone.synapses) {
      synapse.weight = Math.random() * 100 - 50;
    }
    clone.uuid = "mutated-clone-uuid";
    clone.score = 0.01;
    clone.fix();

    // Verify original is unchanged
    assertEquals(
      original.uuid,
      "fittest-creature-uuid",
      "Original UUID was modified",
    );
    assertEquals(original.score, 0.95, "Original score was modified");

    for (let i = 0; i < original.neurons.length; i++) {
      assertEquals(
        original.neurons[i].bias,
        originalBiases[i],
        `Original neuron ${i} bias was modified`,
      );
    }

    for (let i = 0; i < original.synapses.length; i++) {
      assertEquals(
        original.synapses[i].weight,
        originalWeights[i],
        `Original synapse ${i} weight was modified`,
      );
    }

    // Verify original export hasn't changed
    assertEquals(
      JSON.stringify(original.exportJSON()),
      originalJSON,
      "Original export JSON was modified",
    );
  });

  await t.step("structural changes to clone preserve original", () => {
    // Add neurons and synapses to clone
    const newClone = original.shallowClone();
    newClone.neurons.push(newClone.neurons[newClone.neurons.length - 1]);
    newClone.synapses.push(newClone.synapses[newClone.synapses.length - 1]);

    // Verify original structure unchanged
    assertEquals(
      JSON.stringify(original.exportJSON()),
      originalJSON,
      "Original structure was modified when clone structure changed",
    );
  });
});

Deno.test("shallowClone - fittest creature protection: breeding produces new creature", () => {
  const fittest = new Creature(3, 2, {
    layers: [{ count: 4 }],
  });
  fittest.uuid = "fittest-uuid";
  fittest.score = 0.95;
  creatureValidate(fittest);

  const otherCreature = new Creature(3, 2, {
    layers: [{ count: 4 }],
  });
  otherCreature.uuid = "other-uuid";
  otherCreature.score = 0.85;
  creatureValidate(otherCreature);

  // Record fittest state
  const fittestJSON = JSON.stringify(fittest.exportJSON());
  const fittestBiases = fittest.neurons.map((n) => n.bias);
  const fittestWeights = fittest.synapses.map((s) => s.weight);

  // Simulate breeding: create clones and combine them
  const fittestClone = fittest.shallowClone();
  const otherClone = otherCreature.shallowClone();

  // "Breed" by averaging weights (simplified simulation)
  for (let i = 0; i < fittestClone.synapses.length; i++) {
    if (i < otherClone.synapses.length) {
      fittestClone.synapses[i].weight =
        (fittestClone.synapses[i].weight + otherClone.synapses[i].weight) / 2;
    }
  }
  fittestClone.uuid = undefined;
  fittestClone.score = undefined;
  fittestClone.fix();

  // Verify fittest is unchanged
  assertEquals(
    fittest.uuid,
    "fittest-uuid",
    "Fittest UUID was modified during breeding",
  );
  assertEquals(
    fittest.score,
    0.95,
    "Fittest score was modified during breeding",
  );

  for (let i = 0; i < fittest.neurons.length; i++) {
    assertEquals(
      fittest.neurons[i].bias,
      fittestBiases[i],
      `Fittest neuron ${i} bias was modified during breeding`,
    );
  }

  for (let i = 0; i < fittest.synapses.length; i++) {
    assertEquals(
      fittest.synapses[i].weight,
      fittestWeights[i],
      `Fittest synapse ${i} weight was modified during breeding`,
    );
  }

  assertEquals(
    JSON.stringify(fittest.exportJSON()),
    fittestJSON,
    "Fittest export JSON was modified during breeding",
  );
});

Deno.test("shallowClone - fittest creature protection: compact operation preserves original", () => {
  const fittest = new Creature(3, 2, {
    layers: [{ count: 4 }],
  });
  fittest.uuid = "fittest-compact-test";
  fittest.score = 0.95;
  creatureValidate(fittest);

  // Record fittest state
  const fittestJSON = JSON.stringify(fittest.exportJSON());

  // Create clone and run compact on it (simulating what fineTuneImprovement does)
  const clone = fittest.shallowClone();
  const compacted = clone.compact(false);

  // Verify fittest is unchanged regardless of compact result
  assertEquals(
    JSON.stringify(fittest.exportJSON()),
    fittestJSON,
    "Fittest was modified by compact operation on clone",
  );

  // Also verify the clone can be compacted independently
  if (compacted) {
    creatureValidate(compacted);
  }
});
