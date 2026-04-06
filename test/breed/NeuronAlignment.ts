/**
 * Tests for input-weight cosine similarity neuron alignment.
 *
 * Issue #2174: Verifies that:
 * 1. Input weight vectors are correctly built from creature synapses
 * 2. Cosine similarity is computed correctly for sparse vectors
 * 3. Similarity-based alignment correctly matches functionally similar neurons
 * 4. Neurons with no meaningful input connections fall back gracefully
 * 5. The alignment integrates correctly with editParentByIndex
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature, type CreatureExport } from "../../mod.ts";
import { editParentByIndex } from "@breed/EditParentByIndex.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import {
  buildInputWeightVector,
  computeSimilarityAlignment,
  cosineSimilarity,
} from "@breed/NeuronAlignment.ts";

// --- Unit tests for buildInputWeightVector ---

Deno.test(
  "buildInputWeightVector: extracts input connections for a hidden neuron",
  () => {
    const synapses: CreatureExport["synapses"] = [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-a", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "hidden-b", weight: 0.7 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 1.0 },
    ];

    const vec = buildInputWeightVector("hidden-a", synapses, 3);

    assertEquals(vec.size, 2);
    assertEquals(vec.get("input-0"), 0.5);
    assertEquals(vec.get("input-1"), -0.3);
  },
);

Deno.test(
  "buildInputWeightVector: returns empty map for neuron with no input connections",
  () => {
    const synapses: CreatureExport["synapses"] = [
      { fromUUID: "hidden-a", toUUID: "hidden-b", weight: 0.5 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 1.0 },
    ];

    const vec = buildInputWeightVector("hidden-b", synapses, 2);

    assertEquals(vec.size, 0);
  },
);

Deno.test(
  "buildInputWeightVector: ignores connections from non-input neurons",
  () => {
    const synapses: CreatureExport["synapses"] = [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 },
      { fromUUID: "hidden-x", toUUID: "hidden-a", weight: 0.9 },
    ];

    const vec = buildInputWeightVector("hidden-a", synapses, 2);

    assertEquals(vec.size, 1);
    assertEquals(vec.get("input-0"), 0.5);
  },
);

// --- Unit tests for cosineSimilarity ---

Deno.test("cosineSimilarity: identical vectors return 1", () => {
  const a = new Map([["input-0", 1.0], ["input-1", 2.0]]);
  const b = new Map([["input-0", 1.0], ["input-1", 2.0]]);

  const sim = cosineSimilarity(a, b);
  assertAlmostEquals(sim, 1.0, 1e-10);
});

Deno.test("cosineSimilarity: opposite vectors return -1", () => {
  const a = new Map([["input-0", 1.0], ["input-1", 2.0]]);
  const b = new Map([["input-0", -1.0], ["input-1", -2.0]]);

  const sim = cosineSimilarity(a, b);
  assertAlmostEquals(sim, -1.0, 1e-10);
});

Deno.test("cosineSimilarity: orthogonal vectors return 0", () => {
  const a = new Map([["input-0", 1.0]]);
  const b = new Map([["input-1", 1.0]]);

  const sim = cosineSimilarity(a, b);
  assertEquals(sim, 0);
});

Deno.test("cosineSimilarity: empty vectors return 0", () => {
  const a = new Map<string, number>();
  const b = new Map([["input-0", 1.0]]);

  assertEquals(cosineSimilarity(a, b), 0);
  assertEquals(cosineSimilarity(b, a), 0);
  assertEquals(cosineSimilarity(a, a), 0);
});

Deno.test("cosineSimilarity: proportional vectors return 1", () => {
  const a = new Map([["input-0", 1.0], ["input-1", 2.0]]);
  const b = new Map([["input-0", 3.0], ["input-1", 6.0]]);

  const sim = cosineSimilarity(a, b);
  assertAlmostEquals(sim, 1.0, 1e-10);
});

// --- Unit tests for computeSimilarityAlignment ---

Deno.test(
  "computeSimilarityAlignment: matches neurons with similar input weights",
  () => {
    // Parent has two hidden neurons with distinct input weight patterns
    const parentExport: CreatureExport = {
      input: 3,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "parent-A",
          bias: 0,
          squash: "LOGISTIC",
        },
        {
          type: "hidden",
          uuid: "parent-B",
          bias: 0,
          squash: "LOGISTIC",
        },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        // parent-A gets input-0 strongly, input-1 weakly
        { fromUUID: "input-0", toUUID: "parent-A", weight: 0.9 },
        { fromUUID: "input-1", toUUID: "parent-A", weight: 0.1 },
        // parent-B gets input-1 strongly, input-2 weakly
        { fromUUID: "input-1", toUUID: "parent-B", weight: 0.8 },
        { fromUUID: "input-2", toUUID: "parent-B", weight: 0.2 },
        { fromUUID: "parent-A", toUUID: "output-0", weight: 1.0 },
        { fromUUID: "parent-B", toUUID: "output-0", weight: 1.0 },
      ],
    };

    // Target has two hidden neurons — target-X is similar to parent-A,
    // target-Y is similar to parent-B
    const targetExport: CreatureExport = {
      input: 3,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "target-X",
          bias: 0,
          squash: "LOGISTIC",
        },
        {
          type: "hidden",
          uuid: "target-Y",
          bias: 0,
          squash: "LOGISTIC",
        },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        // target-X has similar pattern to parent-A
        { fromUUID: "input-0", toUUID: "target-X", weight: 0.85 },
        { fromUUID: "input-1", toUUID: "target-X", weight: 0.15 },
        // target-Y has similar pattern to parent-B
        { fromUUID: "input-1", toUUID: "target-Y", weight: 0.75 },
        { fromUUID: "input-2", toUUID: "target-Y", weight: 0.25 },
        { fromUUID: "target-X", toUUID: "output-0", weight: 1.0 },
        { fromUUID: "target-Y", toUUID: "output-0", weight: 1.0 },
      ],
    };

    const parentSet = new Set(["parent-A", "parent-B"]);
    const targetSet = new Set([
      "target-X",
      "target-Y",
      "output-0",
    ]);

    const result = computeSimilarityAlignment(
      parentExport,
      targetExport,
      parentSet,
      targetSet,
    );

    // target-X should align with parent-A (both weight input-0 heavily)
    assertEquals(result.mapping.get("target-X"), "parent-A");
    // target-Y should align with parent-B (both weight input-1 heavily)
    assertEquals(result.mapping.get("target-Y"), "parent-B");
  },
);

Deno.test(
  "computeSimilarityAlignment: returns empty mapping when no unmatched neurons",
  () => {
    const creature: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "shared-1",
          bias: 0,
          squash: "LOGISTIC",
        },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "shared-1", weight: 0.5 },
        { fromUUID: "shared-1", toUUID: "output-0", weight: 1.0 },
      ],
    };

    // All neurons already matched
    const parentSet = new Set(["shared-1"]);
    const targetSet = new Set(["shared-1", "output-0"]);

    const result = computeSimilarityAlignment(
      creature,
      creature,
      parentSet,
      targetSet,
    );

    assertEquals(result.mapping.size, 0);
  },
);

Deno.test(
  "computeSimilarityAlignment: handles neurons with no input connections gracefully",
  () => {
    const parentExport: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "parent-deep",
          bias: 0,
          squash: "LOGISTIC",
        },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        // parent-deep has no direct input connections
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "parent-deep", toUUID: "output-0", weight: 1.0 },
      ],
    };

    const targetExport: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "target-deep",
          bias: 0,
          squash: "LOGISTIC",
        },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "target-deep", toUUID: "output-0", weight: 1.0 },
      ],
    };

    const parentSet = new Set(["parent-deep"]);
    const targetSet = new Set(["target-deep", "output-0"]);

    const result = computeSimilarityAlignment(
      parentExport,
      targetExport,
      parentSet,
      targetSet,
    );

    // No similarity can be computed — mapping should be empty
    assertEquals(result.mapping.size, 0);
  },
);

// --- Integration test: editParentByIndex uses similarity-based alignment ---

Deno.test(
  "editParentByIndex: aligns neurons by input-weight similarity, not sequential order",
  () => {
    // Create parent with 3 inputs, 2 hidden neurons, 1 output
    // parent-A connects strongly to input-0
    // parent-B connects strongly to input-2
    const parentJson: CreatureExport = {
      input: 3,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "parent-A",
          bias: 0.1,
          squash: "LOGISTIC",
        },
        {
          type: "hidden",
          uuid: "parent-B",
          bias: 0.2,
          squash: "LOGISTIC",
        },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "parent-A", weight: 0.9 },
        { fromUUID: "input-1", toUUID: "parent-A", weight: 0.1 },
        { fromUUID: "input-1", toUUID: "parent-B", weight: 0.1 },
        { fromUUID: "input-2", toUUID: "parent-B", weight: 0.9 },
        { fromUUID: "parent-A", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "parent-B", toUUID: "output-0", weight: 0.5 },
      ],
    };

    // Target has 2 hidden neurons in REVERSE functional order:
    // target-1 (listed first) connects strongly to input-2 (like parent-B)
    // target-2 (listed second) connects strongly to input-0 (like parent-A)
    //
    // Sequential mapping would incorrectly map:
    //   target-1 -> parent-A (WRONG: target-1 is functionally similar to parent-B)
    //   target-2 -> parent-B (WRONG: target-2 is functionally similar to parent-A)
    //
    // Similarity-based mapping should correctly map:
    //   target-1 -> parent-B (both weight input-2)
    //   target-2 -> parent-A (both weight input-0)
    const targetJson: CreatureExport = {
      input: 3,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "target-1",
          bias: 0.1,
          squash: "LOGISTIC",
        },
        {
          type: "hidden",
          uuid: "target-2",
          bias: 0.2,
          squash: "LOGISTIC",
        },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-1", toUUID: "target-1", weight: 0.1 },
        { fromUUID: "input-2", toUUID: "target-1", weight: 0.9 },
        { fromUUID: "input-0", toUUID: "target-2", weight: 0.9 },
        { fromUUID: "input-1", toUUID: "target-2", weight: 0.1 },
        { fromUUID: "target-1", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "target-2", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const parent = Creature.fromJSON(parentJson);
    const target = Creature.fromJSON(targetJson);

    const child = editParentByIndex(parent, target);
    creatureValidate(child);

    const childExport = child.exportJSON();
    const hiddenNeurons = childExport.neurons.filter((n) =>
      n.type === "hidden"
    );

    // Verify the similarity-based alignment occurred
    // target-1 (input-2 heavy) should be remapped to parent-B (input-2 heavy)
    // target-2 (input-0 heavy) should be remapped to parent-A (input-0 heavy)
    const neuronUuids = new Set(hiddenNeurons.map((n) => n.uuid));
    assert(
      neuronUuids.has("parent-A"),
      "Should contain parent-A UUID",
    );
    assert(
      neuronUuids.has("parent-B"),
      "Should contain parent-B UUID",
    );

    // Check that the neuron mapped from target-1 got parent-B's UUID
    // (not parent-A, which would be the sequential fallback)
    for (const neuron of hiddenNeurons) {
      const alias = getTag(neuron, "alias");
      if (alias === "target-1") {
        assertEquals(
          neuron.uuid,
          "parent-B",
          "target-1 (input-2 heavy) should align with parent-B (input-2 heavy)",
        );
      }
      if (alias === "target-2") {
        assertEquals(
          neuron.uuid,
          "parent-A",
          "target-2 (input-0 heavy) should align with parent-A (input-0 heavy)",
        );
      }
    }
  },
);

Deno.test(
  "editParentByIndex: falls back to sequential for neurons without input connections",
  () => {
    // Parent has a deep hidden neuron with no direct input connections
    const parentJson: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "parent-layer1",
          bias: 0.1,
          squash: "LOGISTIC",
        },
        {
          type: "hidden",
          uuid: "parent-deep",
          bias: 0.2,
          squash: "LOGISTIC",
        },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "parent-layer1", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "parent-layer1", weight: 0.5 },
        // parent-deep has no direct input connections
        { fromUUID: "parent-layer1", toUUID: "parent-deep", weight: 0.5 },
        { fromUUID: "parent-deep", toUUID: "output-0", weight: 1.0 },
      ],
    };

    const targetJson: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "target-layer1",
          bias: 0.1,
          squash: "LOGISTIC",
        },
        {
          type: "hidden",
          uuid: "target-deep",
          bias: 0.2,
          squash: "LOGISTIC",
        },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "target-layer1", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "target-layer1", weight: 0.5 },
        { fromUUID: "target-layer1", toUUID: "target-deep", weight: 0.5 },
        { fromUUID: "target-deep", toUUID: "output-0", weight: 1.0 },
      ],
    };

    const parent = Creature.fromJSON(parentJson);
    const target = Creature.fromJSON(targetJson);

    const child = editParentByIndex(parent, target);
    creatureValidate(child);

    const childExport = child.exportJSON();
    const hiddenNeurons = childExport.neurons.filter((n) =>
      n.type === "hidden"
    );

    // Both neurons should be remapped (one by similarity, one by fallback)
    assertEquals(hiddenNeurons.length, 2, "Should have 2 hidden neurons");

    // The layer1 neurons have matching input weights, so they should align
    // The deep neurons have no input connections, so they fall back to sequential
    const neuronUuids = new Set(hiddenNeurons.map((n) => n.uuid));
    assert(
      neuronUuids.has("parent-layer1"),
      "Layer-1 neuron should be aligned by similarity",
    );
    assert(
      neuronUuids.has("parent-deep"),
      "Deep neuron should be aligned by sequential fallback",
    );
  },
);

Deno.test(
  "editParentByIndex: similarity alignment produces valid creature with asymmetric sizes",
  () => {
    // Parent has 3 hidden neurons, target has 2 — simulates inter-species size mismatch
    const parentJson: CreatureExport = {
      input: 3,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "parent-1",
          bias: 0.1,
          squash: "LOGISTIC",
        },
        {
          type: "hidden",
          uuid: "parent-2",
          bias: 0.2,
          squash: "LOGISTIC",
        },
        {
          type: "hidden",
          uuid: "parent-3",
          bias: 0.3,
          squash: "LOGISTIC",
        },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "parent-1", weight: 0.9 },
        { fromUUID: "input-1", toUUID: "parent-2", weight: 0.9 },
        { fromUUID: "input-2", toUUID: "parent-3", weight: 0.9 },
        { fromUUID: "parent-1", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "parent-2", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "parent-3", toUUID: "output-0", weight: 0.5 },
      ],
    };

    // Target has only 2 hidden neurons that match parent-1 and parent-3
    const targetJson: CreatureExport = {
      input: 3,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "target-A",
          bias: 0.1,
          squash: "LOGISTIC",
        },
        {
          type: "hidden",
          uuid: "target-B",
          bias: 0.2,
          squash: "LOGISTIC",
        },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        // target-A is similar to parent-3 (input-2)
        { fromUUID: "input-2", toUUID: "target-A", weight: 0.85 },
        // target-B is similar to parent-1 (input-0)
        { fromUUID: "input-0", toUUID: "target-B", weight: 0.85 },
        { fromUUID: "target-A", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "target-B", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const parent = Creature.fromJSON(parentJson);
    const target = Creature.fromJSON(targetJson);

    const child = editParentByIndex(parent, target);
    creatureValidate(child);

    const childExport = child.exportJSON();
    const hiddenNeurons = childExport.neurons.filter((n) =>
      n.type === "hidden"
    );

    // target has 2 hidden neurons; parent has 3 — child should still have 2
    assertEquals(hiddenNeurons.length, 2, "Child should have 2 hidden neurons");

    // Check similarity-based alignment
    for (const neuron of hiddenNeurons) {
      const alias = getTag(neuron, "alias");
      if (alias === "target-A") {
        assertEquals(
          neuron.uuid,
          "parent-3",
          "target-A (input-2 heavy) should align with parent-3 (input-2 heavy)",
        );
      }
      if (alias === "target-B") {
        assertEquals(
          neuron.uuid,
          "parent-1",
          "target-B (input-0 heavy) should align with parent-1 (input-0 heavy)",
        );
      }
    }
  },
);
