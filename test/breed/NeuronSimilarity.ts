/**
 * Tests for input-weight cosine similarity neuron alignment.
 *
 * Issue #2174: Verifies that:
 * 1. Input weight vectors are correctly built from synapses
 * 2. Cosine similarity computes correctly for sparse vectors
 * 3. Similarity-based alignment maps functionally similar neurons
 * 4. Sequential fallback handles neurons with no meaningful connections
 * 5. Empty/degenerate cases are handled gracefully
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  buildInputWeightVector,
  computeSimilarityAlignment,
  cosineSimilarity,
} from "@breed/NeuronSimilarity.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

Deno.test(
  "buildInputWeightVector: builds correct sparse vector from synapses",
  () => {
    const synapses: CreatureExport["synapses"] = [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: -0.3 },
      { fromUUID: "input-0", toUUID: "hidden-2", weight: 0.8 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.2 },
    ];

    const vec = buildInputWeightVector("hidden-1", synapses);
    assertEquals(vec.size, 2, "hidden-1 has 2 incoming connections");
    assertEquals(vec.get("input-0"), 0.5);
    assertEquals(vec.get("input-1"), -0.3);
  },
);

Deno.test(
  "buildInputWeightVector: returns empty vector for neuron with no inputs",
  () => {
    const synapses: CreatureExport["synapses"] = [
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
    ];

    const vec = buildInputWeightVector("hidden-1", synapses);
    assertEquals(vec.size, 0, "Neuron with no inputs should have empty vector");
  },
);

Deno.test("cosineSimilarity: identical vectors return 1", () => {
  const a = new Map([["input-0", 0.5], ["input-1", 0.3]]);
  const b = new Map([["input-0", 0.5], ["input-1", 0.3]]);

  assertAlmostEquals(cosineSimilarity(a, b), 1.0, 1e-10);
});

Deno.test("cosineSimilarity: orthogonal vectors return 0", () => {
  const a = new Map([["input-0", 1.0]]);
  const b = new Map([["input-1", 1.0]]);

  assertEquals(cosineSimilarity(a, b), 0);
});

Deno.test("cosineSimilarity: opposite vectors return -1", () => {
  const a = new Map([["input-0", 1.0], ["input-1", 0.0]]);
  const b = new Map([["input-0", -1.0], ["input-1", 0.0]]);

  // With zero entries filtered, only input-0 matters
  // a = [1], b = [-1] => cosine = -1
  assertAlmostEquals(cosineSimilarity(a, b), -1.0, 1e-10);
});

Deno.test("cosineSimilarity: empty vectors return 0", () => {
  const a: Map<string, number> = new Map();
  const b = new Map([["input-0", 1.0]]);

  assertEquals(cosineSimilarity(a, b), 0);
  assertEquals(cosineSimilarity(b, a), 0);
  assertEquals(cosineSimilarity(a, a), 0);
});

Deno.test("cosineSimilarity: proportional vectors return 1", () => {
  const a = new Map([["input-0", 1.0], ["input-1", 2.0]]);
  const b = new Map([["input-0", 3.0], ["input-1", 6.0]]);

  assertAlmostEquals(cosineSimilarity(a, b), 1.0, 1e-10);
});

Deno.test(
  "computeSimilarityAlignment: aligns neurons with similar input weights",
  () => {
    // Parent has two hidden neurons with distinct input weight patterns
    const parentExport: CreatureExport = {
      input: 3,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "parent-A", bias: 0, squash: "LOGISTIC" },
        { type: "hidden", uuid: "parent-B", bias: 0, squash: "LOGISTIC" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        // parent-A: strong connection from input-0, weak from input-1
        { fromUUID: "input-0", toUUID: "parent-A", weight: 0.9 },
        { fromUUID: "input-1", toUUID: "parent-A", weight: 0.1 },
        // parent-B: weak connection from input-0, strong from input-1
        { fromUUID: "input-0", toUUID: "parent-B", weight: 0.1 },
        { fromUUID: "input-1", toUUID: "parent-B", weight: 0.9 },
        // connections to output
        { fromUUID: "parent-A", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "parent-B", toUUID: "output-0", weight: 0.5 },
      ],
    };

    // Target has two hidden neurons — target-X is similar to parent-A,
    // target-Y is similar to parent-B
    const targetExport: CreatureExport = {
      input: 3,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "target-X", bias: 0, squash: "LOGISTIC" },
        { type: "hidden", uuid: "target-Y", bias: 0, squash: "LOGISTIC" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        // target-X: similar to parent-A (strong input-0, weak input-1)
        { fromUUID: "input-0", toUUID: "target-X", weight: 0.85 },
        { fromUUID: "input-1", toUUID: "target-X", weight: 0.15 },
        // target-Y: similar to parent-B (weak input-0, strong input-1)
        { fromUUID: "input-0", toUUID: "target-Y", weight: 0.15 },
        { fromUUID: "input-1", toUUID: "target-Y", weight: 0.85 },
        // connections to output
        { fromUUID: "target-X", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "target-Y", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const result = computeSimilarityAlignment(
      parentExport,
      targetExport,
      ["parent-A", "parent-B"],
      ["target-X", "target-Y"],
    );

    // target-X should align to parent-A (both strong on input-0)
    assertEquals(
      result.alignmentMap.get("target-X"),
      "parent-A",
      "target-X should align to parent-A based on similar input weights",
    );

    // target-Y should align to parent-B (both strong on input-1)
    assertEquals(
      result.alignmentMap.get("target-Y"),
      "parent-B",
      "target-Y should align to parent-B based on similar input weights",
    );

    assertEquals(result.remainingParentUuids.length, 0);
    assertEquals(result.remainingTargetUuids.length, 0);
  },
);

Deno.test(
  "computeSimilarityAlignment: unmatched neurons fall through to remaining",
  () => {
    // Parent and target neurons have no shared input connections
    const parentExport: CreatureExport = {
      input: 4,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "parent-A", bias: 0, squash: "LOGISTIC" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "parent-A", weight: 0.5 },
        { fromUUID: "parent-A", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const targetExport: CreatureExport = {
      input: 4,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "target-X", bias: 0, squash: "LOGISTIC" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        // target-X only connects from input-2, parent-A only from input-0
        // They share no input keys — orthogonal vectors
        { fromUUID: "input-2", toUUID: "target-X", weight: 0.5 },
        { fromUUID: "target-X", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const result = computeSimilarityAlignment(
      parentExport,
      targetExport,
      ["parent-A"],
      ["target-X"],
    );

    // No similarity found — both should remain for sequential fallback
    assertEquals(result.alignmentMap.size, 0);
    assertEquals(result.remainingParentUuids.length, 1);
    assertEquals(result.remainingTargetUuids.length, 1);
  },
);

Deno.test(
  "computeSimilarityAlignment: handles empty unmatched lists gracefully",
  () => {
    const parentExport: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [],
    };

    const result = computeSimilarityAlignment(
      parentExport,
      parentExport,
      [],
      [],
    );

    assertEquals(result.alignmentMap.size, 0);
    assertEquals(result.remainingParentUuids.length, 0);
    assertEquals(result.remainingTargetUuids.length, 0);
  },
);

Deno.test(
  "computeSimilarityAlignment: asymmetric neuron counts leave extras in remaining",
  () => {
    // Parent has 3 neurons, target has 1 — only one can be matched
    const parentExport: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "parent-A", bias: 0, squash: "LOGISTIC" },
        { type: "hidden", uuid: "parent-B", bias: 0, squash: "LOGISTIC" },
        { type: "hidden", uuid: "parent-C", bias: 0, squash: "LOGISTIC" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "parent-A", weight: 0.9 },
        { fromUUID: "input-0", toUUID: "parent-B", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "parent-C", weight: 0.9 },
        { fromUUID: "parent-A", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "parent-B", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "parent-C", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const targetExport: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "target-X", bias: 0, squash: "LOGISTIC" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "target-X", weight: 0.85 },
        { fromUUID: "target-X", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const result = computeSimilarityAlignment(
      parentExport,
      targetExport,
      ["parent-A", "parent-B", "parent-C"],
      ["target-X"],
    );

    // target-X should align to parent-A (highest similarity: both strong on input-0)
    assertEquals(result.alignmentMap.size, 1);
    assertEquals(
      result.alignmentMap.get("target-X"),
      "parent-A",
      "target-X should align to the most similar parent neuron",
    );

    // 2 parent neurons remain unmatched
    assertEquals(result.remainingParentUuids.length, 2);
    assertEquals(result.remainingTargetUuids.length, 0);
  },
);
