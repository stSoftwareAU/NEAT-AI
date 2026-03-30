import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { mergeParallelIdentityBridges } from "@compact/ParallelIdentityMerge.ts";
import { mergeParallelBridges } from "@compact/ParallelBridgeMerge.ts";
import { assertValidSynapseReferences } from "@architecture/AssertValidSynapseReferences.ts";

/**
 * Corner-case tests for parallel merge operations (issue #2014).
 *
 * These tests verify edge cases that could produce invalid creatures
 * (synapses referencing non-existent neurons) after merge operations.
 */

Deno.test("parallel merge: bridge neuron with typed synapse is not merged", () => {
  // A bridge neuron has 1 normal inbound + 1 normal outbound, but also has
  // a typed (condition) synapse. The typed synapse means inConns.length === 2,
  // so the neuron should NOT be detected as a bridge.
  const json: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", id: 5000, squash: "IDENTITY", bias: 0 },
      { type: "hidden", id: 5001, squash: "IDENTITY", bias: 0 },
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      // Typed (condition) synapse targeting h0 — makes it non-bridge
      { fromId: 2, toId: 5000, weight: 0.3, type: "condition" },
      // h1 is a valid bridge
      { fromId: 1, toId: 5001, weight: 0.4 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  // h0 has 2 inbound (normal + condition), so NOT a bridge.
  // h1 is a bridge but alone — no group of 2+. No merge should occur.
  const identityResult = mergeParallelIdentityBridges(json);
  assertEquals(
    identityResult.removedNeurons,
    0,
    "Should not merge: h0 has typed synapse making it non-bridge",
  );

  // Verify structure remains valid
  assertValidSynapseReferences(json, "after typed synapse test");

  // Also test with the general parallel bridge merge
  const json2: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", id: 5000, squash: "IDENTITY", bias: 0 },
      { type: "hidden", id: 5001, squash: "IDENTITY", bias: 0 },
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 2, toId: 5000, weight: 0.3, type: "positive" },
      { fromId: 1, toId: 5001, weight: 0.4 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const bridgeResult = mergeParallelBridges(json2);
  assertEquals(
    bridgeResult.removedNeurons,
    0,
    "General merge should also skip neuron with typed synapse",
  );
  assertValidSynapseReferences(json2, "after typed synapse general merge test");
});

Deno.test("parallel merge: kept neuron's source is also merged elsewhere", () => {
  // Scenario: Two merge groups where the kept neuron in group A gets its
  // input from a neuron that is also the kept neuron in group B.
  // Since only one group per pass is merged, this should be safe.
  //
  // Group 1 (target = output): h0, h1 are bridges to output
  // h0's input comes from h2 (which is itself a bridge in another context)
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", id: 5000, squash: "IDENTITY", bias: 0 },
      { type: "hidden", id: 5001, squash: "IDENTITY", bias: 0 },
      { type: "hidden", id: 5002, squash: "IDENTITY", bias: 0.1 },
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // h2 is an intermediate neuron fed by input-0
      { fromId: 0, toId: 5002, weight: 1.0 },
      // h0 gets input from h2 (not directly from an input)
      { fromId: 5002, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      // h1 gets input from input-1
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
      // h2 also feeds the output directly (makes it non-bridge: 2 outbound)
      { fromId: 5002, toId: -1, weight: 0.1 },
    ],
  };

  // h0 and h1 are bridges to output. h2 is not a bridge (2 outbound).
  const result = mergeParallelIdentityBridges(json);
  assert(result.removedNeurons > 0, "Should merge h0 and h1");
  assertValidSynapseReferences(json, "after kept neuron source test");

  // Verify h2 still exists
  const h2 = json.neurons.find((n) => n.id === 5002);
  assert(h2, "h2 should still exist (not a bridge)");
});

Deno.test("parallel merge: duplicate synapse from redirect is prevented", () => {
  // If two bridge neurons share the same inbound source, redirecting both
  // to the kept neuron would create duplicate synapses (same fromId, toId).
  // The merge should skip such groups.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", id: 5000, squash: "IDENTITY", bias: 0 },
      { type: "hidden", id: 5001, squash: "IDENTITY", bias: 0 },
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // Both h0 and h1 receive from the same input-0
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 0, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const result = mergeParallelIdentityBridges(json);
  assertEquals(
    result.removedNeurons,
    0,
    "Should skip group with duplicate inbound sources",
  );
  assertValidSynapseReferences(json, "after duplicate source test");

  // Verify both neurons still exist
  assertEquals(
    json.neurons.filter((n) => n.type === "hidden").length,
    2,
    "Both hidden neurons should remain",
  );
});

Deno.test("parallel merge: neuron becomes bridge after zero-weight pruning context", () => {
  // A neuron has 2 outbound synapses, one with weight=0. After zero-weight
  // pruning (which happens before parallel merge in CompactCreature), it
  // becomes a bridge neuron eligible for merging. Test that the merge
  // works correctly on a pre-pruned structure.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", id: 5000, squash: "IDENTITY", bias: 0 },
      { type: "hidden", id: 5001, squash: "IDENTITY", bias: 0 },
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // After pruning, h0 and h1 are both bridges to output
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  // This simulates the state after zero-weight pruning has already
  // removed zero-weight synapses, leaving bridge candidates.
  const result = mergeParallelIdentityBridges(json);
  assert(result.removedNeurons > 0, "Should merge post-pruning bridges");
  assertValidSynapseReferences(json, "after post-pruning merge");

  const hidden = json.neurons.filter((n) => n.type === "hidden");
  assertEquals(hidden.length, 1, "One hidden neuron should remain");
});

Deno.test("parallel bridge merge: COMPLEMENT bridge with extra typed synapse is excluded", () => {
  // A COMPLEMENT neuron has 1 normal inbound + 1 normal outbound + 1 typed
  // (negative) inbound synapse. With 2 inbound, it should not be a bridge.
  const json: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", id: 5000, squash: "COMPLEMENT", bias: 0 },
      { type: "hidden", id: 5001, squash: "COMPLEMENT", bias: 0 },
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      // Extra typed synapse on h0 — makes it non-bridge
      { fromId: 2, toId: 5000, weight: 0.1, type: "negative" },
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const result = mergeParallelBridges(json);
  assertEquals(
    result.removedNeurons,
    0,
    "Should not merge: COMPLEMENT neuron with typed synapse is non-bridge",
  );
  assertValidSynapseReferences(json, "after COMPLEMENT typed synapse test");
});

Deno.test("parallel identity merge: integrity assertion catches dangling references", () => {
  // Verify the assertion is present and working by testing a valid merge.
  // The assertion runs internally — if there were a bug creating dangling
  // refs, it would throw. This test confirms the happy path doesn't throw.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", id: 5000, squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", id: 5001, squash: "IDENTITY", bias: 0.2 },
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const result = mergeParallelIdentityBridges(json);
  assert(result.removedNeurons > 0, "Should merge");
  // If assertion is missing or there's a dangling ref, this would have thrown.
  assertValidSynapseReferences(json, "post-merge integrity check");

  // Verify all remaining synapses reference valid neurons
  const validIds = new Set<number>([0, 1]); // input IDs
  for (const n of json.neurons) validIds.add(n.id!);

  for (const s of json.synapses) {
    assert(validIds.has(s.fromId!), `Dangling fromId: ${s.fromId}`);
    assert(validIds.has(s.toId!), `Dangling toId: ${s.toId}`);
  }
});

Deno.test("parallel bridge merge: integrity assertion after COMPLEMENT merge", () => {
  // Verify the assertion runs and no dangling refs after COMPLEMENT merge.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", id: 5000, squash: "COMPLEMENT", bias: 0 },
      { type: "hidden", id: 5001, squash: "COMPLEMENT", bias: 0 },
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.5 },
      { fromId: 5000, toId: -1, weight: 2.0 },
      { fromId: 1, toId: 5001, weight: 0.3 },
      { fromId: 5001, toId: -1, weight: 1.5 },
    ],
  };

  const result = mergeParallelBridges(json);
  assert(result.removedNeurons > 0, "Should merge COMPLEMENT neurons");
  // Internal assertion would have thrown if dangling refs exist.
  assertValidSynapseReferences(json, "post-COMPLEMENT merge integrity check");

  // Verify all remaining synapses reference valid neurons
  const validIds = new Set<number>([0, 1]);
  for (const n of json.neurons) validIds.add(n.id!);

  for (const s of json.synapses) {
    assert(validIds.has(s.fromId!), `Dangling fromId: ${s.fromId}`);
    assert(validIds.has(s.toId!), `Dangling toId: ${s.toId}`);
  }
});
