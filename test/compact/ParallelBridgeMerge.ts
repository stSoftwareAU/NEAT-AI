import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { compactCreature } from "../../src/compact/CompactCreature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { mergeParallelBridges } from "../../src/compact/ParallelBridgeMerge.ts";

/**
 * Tests for parallel bridge neuron merging extended to COMPLEMENT squash
 * functions (issue #1948).
 *
 * Mathematical basis:
 *
 * IDENTITY: f(x) = x is linear, so f(a + b) = f(a) + f(b).
 * Parallel bridge neurons can be merged directly.
 *
 * COMPLEMENT: f(x) = 1 - x is affine. It can be algebraically converted
 * to IDENTITY by negating inbound weights and adjusting bias:
 *   1 - (w*x + b) = (-w)*x + (1 - b) = IDENTITY with w' = -w, b' = 1 - b.
 * After conversion, standard IDENTITY merging applies.
 *
 * Non-linear squashes (LOGISTIC, TANH, ReLU, ABSOLUTE, etc.) do NOT
 * satisfy f(a + b) = f(a) + f(b), so parallel merging is NOT safe.
 *
 * Aggregation squashes (MAXIMUM, MINIMUM, IF) are also excluded because
 * they process inputs non-additively.
 */

Deno.test("parallel bridge merge: two COMPLEMENT bridge neurons are merged", () => {
  // Two COMPLEMENT bridge neurons feeding the same output.
  // COMPLEMENT: f(x) = 1 - x
  //
  // Before merge:
  //   h0: COMPLEMENT(0.5 * x0 + 0) = 1 - 0.5*x0 → output gets 2.0 * (1 - 0.5*x0) = 2.0 - x0
  //   h1: COMPLEMENT(0.3 * x1 + 0) = 1 - 0.3*x1 → output gets 1.5 * (1 - 0.3*x1) = 1.5 - 0.45*x1
  //   Total contribution: 3.5 - x0 - 0.45*x1
  //
  // After converting COMPLEMENT to IDENTITY:
  //   h0: IDENTITY(-0.5 * x0 + 1) = -0.5*x0 + 1 → output gets 2.0 * (-0.5*x0 + 1) = -x0 + 2.0
  //   h1: IDENTITY(-0.3 * x1 + 1) = -0.3*x1 + 1 → output gets 1.5 * (-0.3*x1 + 1) = -0.45*x1 + 1.5
  //   Merged: w_in_0 = 2.0*(-0.5) = -1.0, w_in_1 = 1.5*(-0.3) = -0.45
  //           bias = 2.0*1 + 1.5*1 = 3.5, w_out = 1
  //   Output = 1 * (-x0 - 0.45*x1 + 3.5) = -x0 - 0.45*x1 + 3.5 ✓
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", id: 5000, squash: "COMPLEMENT", bias: 0 },
      { type: "hidden", uuid: "h1", id: 5001, squash: "COMPLEMENT", bias: 0 },
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const result = mergeParallelBridges(json);
  assert(result.removedNeurons > 0, "Expected COMPLEMENT neurons to be merged");

  const hiddenNeurons = json.neurons.filter((n) => n.type === "hidden");
  assert(
    hiddenNeurons.length < 2,
    `Expected fewer than 2 hidden neurons, got ${hiddenNeurons.length}`,
  );

  // The kept neuron should now be IDENTITY after conversion.
  assertEquals(
    hiddenNeurons[0].squash,
    "IDENTITY",
    "Merged neuron should be converted to IDENTITY",
  );
});

Deno.test("parallel bridge merge: COMPLEMENT weight calculation is correct", () => {
  // Before merge:
  //   h0: COMPLEMENT(0.5*x0 + 0.1) → w_out=2.0 → 2.0*(1 - 0.5*x0 - 0.1) = 2.0*(0.9 - 0.5*x0)
  //     = 1.8 - x0
  //   h1: COMPLEMENT(0.3*x1 + 0.2) → w_out=1.5 → 1.5*(1 - 0.3*x1 - 0.2) = 1.5*(0.8 - 0.3*x1)
  //     = 1.2 - 0.45*x1
  //   Total: 3.0 - x0 - 0.45*x1
  //
  // After converting to IDENTITY:
  //   h0: IDENTITY(-0.5*x0 + (1 - 0.1)) = -0.5*x0 + 0.9
  //     → w_out=2.0 → contribution = 2.0*(-0.5*x0 + 0.9) = -x0 + 1.8
  //   h1: IDENTITY(-0.3*x1 + (1 - 0.2)) = -0.3*x1 + 0.8
  //     → w_out=1.5 → contribution = 1.5*(-0.3*x1 + 0.8) = -0.45*x1 + 1.2
  //
  // Merged neuron (IDENTITY, w_out=1):
  //   w_in_0 = 2.0*(-0.5) = -1.0
  //   w_in_1 = 1.5*(-0.3) = -0.45
  //   bias = 2.0*0.9 + 1.5*0.8 = 1.8 + 1.2 = 3.0
  //   Output = -x0 - 0.45*x1 + 3.0 ✓
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", id: 5000, squash: "COMPLEMENT", bias: 0.1 },
      { type: "hidden", uuid: "h1", id: 5001, squash: "COMPLEMENT", bias: 0.2 },
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const result = mergeParallelBridges(json);
  assert(result.removedNeurons > 0, "Expected merging to occur");

  const hiddenNeurons = json.neurons.filter((n) => n.type === "hidden");
  assertEquals(hiddenNeurons.length, 1, "One hidden neuron should remain");

  const kept = hiddenNeurons[0];
  assertEquals(kept.squash, "IDENTITY", "Kept neuron should be IDENTITY");

  // Merged bias: 2.0*(1-0.1) + 1.5*(1-0.2) = 1.8 + 1.2 = 3.0
  assertAlmostEquals(kept.bias, 3.0, 1e-12, "Merged bias incorrect");

  // Inbound synapses to the kept neuron
  const inboundToKept = json.synapses.filter((s) => s.toId === kept.id);
  assertEquals(inboundToKept.length, 2, "Should have 2 inbound synapses");

  const wByFrom = new Map(
    inboundToKept.map((s) => [s.fromId, s.weight] as const),
  );
  // input-0 weight: 2.0 * (-0.5) = -1.0
  assertAlmostEquals(wByFrom.get(0) ?? NaN, -1.0, 1e-12);
  // input-1 weight: 1.5 * (-0.3) = -0.45
  assertAlmostEquals(wByFrom.get(1) ?? NaN, -0.45, 1e-12);

  // Outbound synapse from kept to output
  const outboundFromKept = json.synapses.filter(
    (s) => s.fromId === kept.id,
  );
  assertEquals(outboundFromKept.length, 1, "Should have 1 outbound synapse");
  assertAlmostEquals(
    outboundFromKept[0].weight,
    1.0,
    1e-12,
    "Outbound weight should be 1",
  );
});

Deno.test("parallel bridge merge: mixed IDENTITY and COMPLEMENT are NOT merged together", () => {
  // An IDENTITY and a COMPLEMENT bridge neuron feeding the same target.
  // These have different squash functions so they should NOT be in the same
  // merge group — only neurons with the same squash can be grouped.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", id: 5000, squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h1", id: 5001, squash: "COMPLEMENT", bias: 0 },
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const result = mergeParallelBridges(json);
  // Each squash type only has 1 neuron, so no group of 2+ exists.
  assertEquals(
    result.removedNeurons,
    0,
    "Should not merge neurons with different squash functions",
  );
});

Deno.test("parallel bridge merge: LOGISTIC neurons are not merged", () => {
  // LOGISTIC: f(x) = 1/(1+e^(-x)) is non-linear.
  // f(a+b) ≠ f(a) + f(b), so parallel merging is NOT safe.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", id: 5000, squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "h1", id: 5001, squash: "LOGISTIC", bias: 0 },
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const result = mergeParallelBridges(json);
  assertEquals(
    result.removedNeurons,
    0,
    "LOGISTIC neurons should not be merged (non-linear)",
  );
});

Deno.test("parallel bridge merge: TANH neurons are not merged", () => {
  // TANH: f(x) = tanh(x) is non-linear — not safe for parallel merging.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", id: 5000, squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "h1", id: 5001, squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const result = mergeParallelBridges(json);
  assertEquals(
    result.removedNeurons,
    0,
    "TANH neurons should not be merged (non-linear)",
  );
});

Deno.test("parallel bridge merge: ReLU neurons are not merged", () => {
  // ReLU: f(x) = max(0, x) is piecewise-linear but NOT additive.
  // f(a+b) ≠ f(a) + f(b) in general (e.g. a=1, b=-2: f(-1)=0 ≠ 1+0=1).
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", id: 5000, squash: "RELU", bias: 0 },
      { type: "hidden", uuid: "h1", id: 5001, squash: "RELU", bias: 0 },
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const result = mergeParallelBridges(json);
  assertEquals(
    result.removedNeurons,
    0,
    "ReLU neurons should not be merged (piecewise-linear, not additive)",
  );
});

Deno.test("parallel bridge merge: ABSOLUTE neurons are not merged", () => {
  // ABSOLUTE: f(x) = |x| is scale-homogeneous but NOT additive.
  // |a+b| ≠ |a| + |b| in general (e.g. a=1, b=-1: |0|=0 ≠ 1+1=2).
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", id: 5000, squash: "ABSOLUTE", bias: 0 },
      { type: "hidden", uuid: "h1", id: 5001, squash: "ABSOLUTE", bias: 0 },
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const result = mergeParallelBridges(json);
  assertEquals(
    result.removedNeurons,
    0,
    "ABSOLUTE neurons should not be merged (not additive)",
  );
});

Deno.test("parallel bridge merge: MAXIMUM aggregate neurons are not merged", () => {
  // MAXIMUM is an aggregation squash — not safe for parallel merging.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", id: 5000, squash: "MAXIMUM", bias: 0 },
      { type: "hidden", uuid: "h1", id: 5001, squash: "MAXIMUM", bias: 0 },
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const result = mergeParallelBridges(json);
  assertEquals(
    result.removedNeurons,
    0,
    "MAXIMUM neurons should not be merged (aggregation squash)",
  );
});

Deno.test("parallel bridge merge: COMPLEMENT merge preserves structure via compactCreature", () => {
  // End-to-end test: verify that compaction with COMPLEMENT bridge neurons
  // produces correct structural result.
  //
  // Setup: Two COMPLEMENT bridge neurons → IDENTITY output
  // h0: COMPLEMENT(0.4*x0 + 0.1) → w_out=1.0 → 1*(1 - 0.4*x0 - 0.1) = 0.9 - 0.4*x0
  // h1: COMPLEMENT(0.6*x1 + 0.2) → w_out=1.0 → 1*(1 - 0.6*x1 - 0.2) = 0.8 - 0.6*x1
  // Total to output: 1.7 - 0.4*x0 - 0.6*x1
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", squash: "COMPLEMENT", bias: 0.1 },
      { type: "hidden", uuid: "h1", squash: "COMPLEMENT", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h0", weight: 0.4 },
      { fromUUID: "h0", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.6 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.0 },
    ],
  };

  const original = Creature.fromJSON(json);
  const compacted = compactCreature(original, false);
  assert(compacted, "Expected compaction to occur");
  compacted.validate();

  const exported = compacted.exportJSON();

  // The COMPLEMENT bypass or parallel merge should have reduced the network.
  // Verify the structure is valid and has fewer hidden neurons.
  const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");
  assert(
    hiddenNeurons.length < 2,
    `Expected fewer than 2 hidden neurons after compaction, got ${hiddenNeurons.length}`,
  );
});

Deno.test("parallel bridge merge: three COMPLEMENT neurons merged correctly", () => {
  // Three COMPLEMENT bridge neurons all pointing to the same target.
  // After conversion to IDENTITY:
  //   h0: bias'=1-0.5=0.5, w_in'=-1.0 → merged_w = 0.5*(-1.0) = -0.5
  //   h1: bias'=1-(-0.3)=1.3, w_in'=-2.0 → merged_w = 0.8*(-2.0) = -1.6
  //   h2: bias'=1-0.3=0.7, w_in'=1.0 → merged_w = 1.2*(1.0) = 1.2
  //   merged_bias = 0.5*0.5 + 0.8*1.3 + 1.2*0.7 = 0.25 + 1.04 + 0.84 = 2.13
  const json: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", id: 5000, squash: "COMPLEMENT", bias: 0.5 },
      {
        type: "hidden",
        uuid: "h1",
        id: 5001,
        squash: "COMPLEMENT",
        bias: -0.3,
      },
      { type: "hidden", uuid: "h2", id: 5002, squash: "COMPLEMENT", bias: 0.3 },
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 1.0 },
      { fromId: 5000, toId: -1, weight: 0.5 },
      { fromId: 1, toId: 5001, weight: 2.0 },
      { fromId: 5001, toId: -1, weight: 0.8 },
      { fromId: 2, toId: 5002, weight: -1.0 },
      { fromId: 5002, toId: -1, weight: 1.2 },
    ],
  };

  const result = mergeParallelBridges(json);
  assert(result.removedNeurons > 0, "Expected COMPLEMENT neurons to be merged");

  const hiddenNeurons = json.neurons.filter((n) => n.type === "hidden");
  assert(
    hiddenNeurons.length < 3,
    `Expected fewer than 3 hidden neurons, got ${hiddenNeurons.length}`,
  );

  if (hiddenNeurons.length === 1) {
    const kept = hiddenNeurons[0];
    assertEquals(kept.squash, "IDENTITY", "Kept neuron should be IDENTITY");
    // Merged bias: 0.5*0.5 + 0.8*1.3 + 1.2*0.7 = 0.25 + 1.04 + 0.84 = 2.13
    assertAlmostEquals(kept.bias, 2.13, 1e-12, "Merged bias incorrect");
  }
});

Deno.test("parallel bridge merge: IDENTITY neurons still work as before", () => {
  // Regression test: ensure the generalised function still merges IDENTITY
  // neurons correctly (same behaviour as the original mergeParallelIdentityBridges).
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", id: 5000, squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "h1", id: 5001, squash: "IDENTITY", bias: 0.2 },
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const result = mergeParallelBridges(json);
  assert(result.removedNeurons > 0, "Expected IDENTITY neurons to be merged");

  const hiddenNeurons = json.neurons.filter((n) => n.type === "hidden");
  assertEquals(hiddenNeurons.length, 1, "One hidden neuron should remain");
  assertEquals(hiddenNeurons[0].squash, "IDENTITY");

  // Merged bias: 2.0*0.1 + 1.5*0.2 = 0.5
  assertAlmostEquals(hiddenNeurons[0].bias, 0.5, 1e-12);
});
