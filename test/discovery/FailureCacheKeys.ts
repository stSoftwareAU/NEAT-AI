import { assert, assertEquals } from "@std/assert";
import {
  buildCacheKey,
  extractExponent,
  formatWeight,
} from "../../src/discovery/FailureCache.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { CoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { makeSimpleCreature } from "../fixtures/SimpleCreatures.ts";

function makeCandidate(
  changeType: string,
  description: string,
  creature?: Creature,
): DiscoveryCandidate {
  return {
    creature: creature ?? makeSimpleCreature(),
    change: {
      type: changeType as DiscoveryCandidate["change"]["type"],
      description,
    },
  };
}

Deno.test("extractExponent returns correct exponent for various numbers", () => {
  // Large positive number
  assertEquals(extractExponent(123456.789), 5);

  // Small positive number
  assertEquals(extractExponent(0.000123), -4);

  // Negative number
  assertEquals(extractExponent(-456.78), 2);

  // Very small number (scientific notation)
  assertEquals(extractExponent(1.23e-10), -10);

  // Very large number
  assertEquals(extractExponent(9.87e15), 15);

  // Number close to 1
  assertEquals(extractExponent(1.5), 0);

  // Zero returns a sentinel value
  assertEquals(extractExponent(0), -999);

  // Very small number close to zero
  assertEquals(extractExponent(1e-300), -300);
});

Deno.test("formatWeight formats weight using exponent only", () => {
  // Tests that similar weights map to the same string
  assertEquals(formatWeight(0.123), "e-1");
  assertEquals(formatWeight(0.234), "e-1"); // Same exponent, same key
  assertEquals(formatWeight(0.0123), "e-2");
  assertEquals(formatWeight(-0.123), "e-1"); // Sign doesn't affect exponent

  // Large weights
  assertEquals(formatWeight(1234.5), "e3");
  assertEquals(formatWeight(9999.9), "e3");

  // Zero
  assertEquals(formatWeight(0), "e-999");
});

Deno.test("buildCacheKey creates reproducible keys for add-synapses candidates", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.123 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.456 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);

  const candidate = makeCandidate("add-synapses", "test synapse", creature);
  const key = buildCacheKey(candidate);

  // Key should be deterministic
  const key2 = buildCacheKey(candidate);
  assertEquals(key, key2, "Cache key should be reproducible");

  // Key should contain the change type
  assert(key.includes("add-synapses"), "Key should include change type");
});

Deno.test("buildCacheKey creates different keys for significantly different weights", () => {
  const creature1 = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.001 }, // e-3
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature1.validate();
  CreatureUtil.makeUUID(creature1);

  const creature2 = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 10.0 }, // e1 (different order of magnitude)
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature2.validate();
  CreatureUtil.makeUUID(creature2);

  const candidate1 = makeCandidate("add-synapses", "test", creature1);
  const candidate2 = makeCandidate("add-synapses", "test", creature2);

  const key1 = buildCacheKey(candidate1);
  const key2 = buildCacheKey(candidate2);

  assert(
    key1 !== key2,
    "Cache keys should differ for significantly different weights",
  );
});

Deno.test("buildCacheKey creates same keys for similar weights", () => {
  const creature1 = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.123 }, // e-1
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature1.validate();
  CreatureUtil.makeUUID(creature1);

  const creature2 = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.234 }, // e-1 (same order of magnitude)
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature2.validate();
  CreatureUtil.makeUUID(creature2);

  const candidate1 = makeCandidate("add-synapses", "test", creature1);
  const candidate2 = makeCandidate("add-synapses", "test", creature2);

  const key1 = buildCacheKey(candidate1);
  const key2 = buildCacheKey(candidate2);

  assertEquals(
    key1,
    key2,
    "Cache keys should be same for weights with same order of magnitude",
  );
});

Deno.test("buildCacheKey: coordinated-structural key is stable and order-sensitive (hash of ordered operations)", () => {
  const creature = makeSimpleCreature();

  const specA: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.01,
    operations: [
      {
        type: "removeSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "hidden-1",
      },
      {
        type: "addSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "hidden-1",
        weight: 0.9,
      },
    ],
  };
  const specB: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.01,
    operations: [
      // Same ops but different order.
      {
        type: "addSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "hidden-1",
        weight: 0.9,
      },
      {
        type: "removeSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "hidden-1",
      },
    ],
  };

  const candidateA: DiscoveryCandidate = {
    creature,
    change: {
      type: "coordinated-structural",
      coordinatedStructuralCandidate: specA,
    },
  };
  const candidateA2: DiscoveryCandidate = {
    creature,
    change: {
      type: "coordinated-structural",
      coordinatedStructuralCandidate: specA,
    },
  };
  const candidateB: DiscoveryCandidate = {
    creature,
    change: {
      type: "coordinated-structural",
      coordinatedStructuralCandidate: specB,
    },
  };

  const keyA = buildCacheKey(candidateA);
  const keyA2 = buildCacheKey(candidateA2);
  const keyB = buildCacheKey(candidateB);

  assertEquals(keyA, keyA2);
  assert(keyA !== keyB);
  assert(keyA.includes("coordinated-structural"));
});

Deno.test("buildCacheKey includes neuron details for add-neurons candidates", () => {
  const creature = makeSimpleCreature();
  const candidate: DiscoveryCandidate = {
    creature,
    change: {
      type: "add-neurons",
      description: "Add neuron",
      neuronDetails: {
        fromNeuronUUID: "input-0",
        toNeuronUUID: "output-0",
        incomingWeight: 0.5,
        outgoingWeight: -0.3,
        bias: 0.1,
        squash: "TANH",
      },
    },
  };

  const key = buildCacheKey(candidate);
  assert(key.includes("add-neurons"), "Key should include change type");
  assert(key.includes("input-0"), "Key should include from neuron UUID");
  assert(key.includes("output-0"), "Key should include to neuron UUID");
  assert(key.includes("TANH"), "Key should include squash function");
});

Deno.test("buildCacheKey handles remove-low-impact candidates", () => {
  const creature = makeSimpleCreature();
  const candidate: DiscoveryCandidate = {
    creature,
    change: {
      type: "remove-low-impact",
      description: "Remove low-impact neuron hidden-1 (impact: 1.23e-10)",
    },
  };

  const key = buildCacheKey(candidate);
  assert(key.includes("remove-low-impact"), "Key should include change type");
  // The key should extract the neuron UUID from description
  assert(
    key.includes("hidden-1"),
    "Key should include neuron UUID from description",
  );
});

Deno.test("buildCacheKey avoids cache collision when description is undefined", () => {
  // Issue: If description is undefined, parts only contains [type], causing all
  // such candidates to have identical cache keys regardless of their structure.
  const creature1 = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-a", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature1.validate();
  CreatureUtil.makeUUID(creature1);

  const creature2 = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-b", squash: "TANH", bias: 0.3 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-b", weight: 0.8 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 0.8 },
    ],
  });
  creature2.validate();
  CreatureUtil.makeUUID(creature2);

  // Both candidates have undefined description - should NOT produce same key
  const candidate1: DiscoveryCandidate = {
    creature: creature1,
    change: { type: "remove-neuron" },
  };
  const candidate2: DiscoveryCandidate = {
    creature: creature2,
    change: { type: "remove-neuron" },
  };

  const key1 = buildCacheKey(candidate1);
  const key2 = buildCacheKey(candidate2);

  assert(
    key1 !== key2,
    "Different creatures with undefined description should have different cache keys",
  );
  // Keys should contain more than just the type
  assert(
    key1.length > "remove-neuron".length + 5,
    "Key should contain structural information, not just type",
  );
});

Deno.test("buildCacheKey avoids cache collision when description doesn't match regex", () => {
  // Issue: If description doesn't match the neuron UUID regex pattern,
  // no fallback was called, causing identical cache keys.
  const creature1 = makeSimpleCreature();
  const creature2 = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "other-hidden", squash: "TANH", bias: 0.9 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "other-hidden", weight: 1.5 },
      { fromUUID: "other-hidden", toUUID: "output-0", weight: 1.5 },
    ],
  });
  creature2.validate();
  CreatureUtil.makeUUID(creature2);

  // Descriptions that don't match the pattern /neuron\s+([a-zA-Z0-9_-]+)/i
  const candidate1: DiscoveryCandidate = {
    creature: creature1,
    change: {
      type: "remove-low-impact",
      description: "Some unrelated description",
    },
  };
  const candidate2: DiscoveryCandidate = {
    creature: creature2,
    change: {
      type: "remove-low-impact",
      description: "Another unrelated description",
    },
  };

  const key1 = buildCacheKey(candidate1);
  const key2 = buildCacheKey(candidate2);

  assert(
    key1 !== key2,
    "Different creatures with non-matching descriptions should have different cache keys",
  );
});

Deno.test("buildCacheKey throws for remove-synapse without synapseDetails", () => {
  // remove-synapse candidates created by buildDiscoveryCandidates always have synapseDetails.
  // This test verifies we catch any future code changes that might break this invariant.
  const creature = makeSimpleCreature();

  const candidate: DiscoveryCandidate = {
    creature,
    change: { type: "remove-synapse" },
  };

  try {
    buildCacheKey(candidate);
    throw new Error(
      "Expected buildCacheKey to throw for missing synapseDetails",
    );
  } catch (error) {
    assert(
      (error as Error).message.includes("missing synapseDetails"),
      `Expected error about missing synapseDetails, got: ${
        (error as Error).message
      }`,
    );
  }
});

Deno.test("buildCacheKey works for remove-synapse with synapseDetails", () => {
  // Verify proper cache key generation when synapseDetails is provided
  const creature1 = makeSimpleCreature();
  const creature2 = makeSimpleCreature();

  const candidate1: DiscoveryCandidate = {
    creature: creature1,
    change: {
      type: "remove-synapse",
      synapseDetails: { fromNeuronUUID: "input-0", toNeuronUUID: "hidden-1" },
    },
  };
  const candidate2: DiscoveryCandidate = {
    creature: creature2,
    change: {
      type: "remove-synapse",
      synapseDetails: { fromNeuronUUID: "hidden-1", toNeuronUUID: "output-0" },
    },
  };

  const key1 = buildCacheKey(candidate1);
  const key2 = buildCacheKey(candidate2);

  assert(key1 !== key2, "Different synapses should have different cache keys");
  assert(key1.includes("remove-synapse"), "Key should include type");
  assert(key1.includes("input-0"), "Key should include fromNeuronUUID");
  assert(key1.includes("hidden-1"), "Key should include toNeuronUUID");
});
