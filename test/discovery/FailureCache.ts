import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  buildCacheKey,
  extractExponent,
  extractTargetNeuronInfo,
  formatWeight,
  isCandidateCached,
  isCandidateCachedSync,
  recordFailure,
  recordFailureSync,
} from "../../src/discovery/FailureCache.ts";
import { shortID } from "../../src/discovery/DiscoveryCandidates.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import {
  closeRustLibrary,
  getDiscoveryVersion,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import type { RemovalCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { CoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";

function makeSimpleCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

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

Deno.test("recordFailure and isCandidateCached work together", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();
    const candidate = makeCandidate("add-synapses", "test synapse", creature);

    // Initially should not be cached
    const cachedBefore = await isCandidateCached(tempDir, candidate);
    assertEquals(
      cachedBefore,
      false,
      "Candidate should not be cached initially",
    );

    // Record the failure (this may load the Rust library to get version)
    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.4,
      scoreDelta: -0.1,
      error: 0.6,
    });

    // Now should be cached
    const cachedAfter = await isCandidateCached(tempDir, candidate);
    assertEquals(
      cachedAfter,
      true,
      "Candidate should be cached after recording failure",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("combo-* failures are not cached (except combo-successful)", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();
    const candidate = makeCandidate(
      "combo-all",
      "🏗️ Combined all changes",
      creature,
    );

    // Recording a failure for a combo candidate should be a no-op.
    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.49,
      scoreDelta: -0.01,
      error: 0.6,
      originalError: 0.59,
    });

    const cachedAsync = await isCandidateCached(tempDir, candidate);
    assertEquals(
      cachedAsync,
      false,
      "Combo candidates should not be treated as cached failures (async)",
    );

    // Same behaviour for the sync API.
    recordFailureSync(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.49,
      scoreDelta: -0.01,
      error: 0.6,
      originalError: 0.59,
    });

    const cachedSync = isCandidateCachedSync(tempDir, candidate);
    assertEquals(
      cachedSync,
      false,
      "Combo candidates should not be treated as cached failures (sync)",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("combo-successful failures are cached (phase 2 cache)", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();
    const candidate = makeCandidate(
      "combo-successful",
      "🏗️ Combined successful changes",
      creature,
    );

    // Initially should not be cached
    assertEquals(
      await isCandidateCached(tempDir, candidate),
      false,
      "Precondition: combo-successful should not be cached initially",
    );

    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.49,
      scoreDelta: -0.01,
      error: 0.6,
      originalError: 0.59,
    });

    assertEquals(
      await isCandidateCached(tempDir, candidate),
      true,
      "combo-successful should be cached after recording failure (async)",
    );

    // Sync API should match.
    assertEquals(
      isCandidateCachedSync(tempDir, candidate),
      true,
      "combo-successful should be cached after recording failure (sync)",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("isCandidateCached returns false when cache dir doesn't exist", async () => {
  const nonExistentDir = "/tmp/non-existent-discovery-cache-" + Date.now();
  const candidate = makeCandidate("add-synapses", "test", makeSimpleCreature());

  const cached = await isCandidateCached(nonExistentDir, candidate);
  assertEquals(
    cached,
    false,
    "Should return false for non-existent cache directory",
  );
});

Deno.test("recordFailure creates directory structure if needed", async () => {
  const tempDir = await Deno.makeTempDir();
  const nestedDir = `${tempDir}/nested/cache/dir`;

  try {
    const creature = makeSimpleCreature();
    const candidate = makeCandidate("change-squash", "test squash", creature);

    // Record failure in nested directory that doesn't exist
    await recordFailure(nestedDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.45,
      scoreDelta: -0.05,
      error: 0.55,
    });

    // Verify the cache file was created
    const cached = await isCandidateCached(nestedDir, candidate);
    assertEquals(
      cached,
      true,
      "Candidate should be cached in newly created directory",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("different change types create different cache keys", () => {
  const creature = makeSimpleCreature();

  const synapsesCandidate = makeCandidate("add-synapses", "test", creature);
  const neuronsCandidate = makeCandidate("add-neurons", "test", creature);
  const squashCandidate = makeCandidate("change-squash", "test", creature);

  const key1 = buildCacheKey(synapsesCandidate);
  const key2 = buildCacheKey(neuronsCandidate);
  const key3 = buildCacheKey(squashCandidate);

  assert(
    key1 !== key2,
    "add-synapses and add-neurons should have different keys",
  );
  assert(
    key2 !== key3,
    "add-neurons and change-squash should have different keys",
  );
  assert(
    key1 !== key3,
    "add-synapses and change-squash should have different keys",
  );
});

Deno.test("buildCacheKey handles edge case of empty synapses", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1.0 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);

  const candidate = makeCandidate("add-synapses", "test", creature);
  const key = buildCacheKey(candidate);

  // Should not throw and should produce a valid key
  assert(typeof key === "string", "Key should be a string");
  assert(key.length > 0, "Key should not be empty");
});

Deno.test("buildCacheKey creates different keys for different output squash functions", () => {
  // Issue: Output neurons were excluded from structural signature, so candidates
  // differing only in output neuron squash functions would have identical keys.
  const creature1 = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
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
      { type: "output", uuid: "output-0", squash: "TANH", bias: 0.1 }, // Different squash
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature2.validate();
  CreatureUtil.makeUUID(creature2);

  const candidate1 = makeCandidate("change-squash", "test", creature1);
  const candidate2 = makeCandidate("change-squash", "test", creature2);

  const key1 = buildCacheKey(candidate1);
  const key2 = buildCacheKey(candidate2);

  assert(
    key1 !== key2,
    "Cache keys should differ when output neuron squash functions differ",
  );
});

Deno.test("buildCacheKey produces deterministic keys regardless of neuron order", () => {
  // Issue: Hidden neurons weren't sorted, so the same structure with neurons
  // in different order could produce different signatures.

  // Creature with hidden neurons in one order
  const creature1 = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-a", squash: "TANH", bias: 0.5 },
      { type: "hidden", uuid: "hidden-b", squash: "RELU", bias: 0.3 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: 0.5 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature1.validate();
  CreatureUtil.makeUUID(creature1);

  // Same creature with hidden neurons declared in reverse order
  const creature2 = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-b", squash: "RELU", bias: 0.3 },
      { type: "hidden", uuid: "hidden-a", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: 0.5 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 0.5 },
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
    "Cache keys should be identical for structurally identical creatures regardless of neuron declaration order",
  );
});

Deno.test("recordFailure computes actualErrorReduction when originalError is provided", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();
    const candidate: DiscoveryCandidate = {
      creature,
      change: {
        type: "add-neurons",
        description: "Add neuron test",
        expectedErrorReduction: 0.05, // Expected 5% reduction
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

    // Record failure with originalError provided
    // originalError = 0.6, candidateError = 0.58
    // actualErrorReduction = 0.6 - 0.58 = 0.02 (positive means improvement)
    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.48,
      scoreDelta: -0.02,
      error: 0.58,
      originalError: 0.6,
    });

    // Read the cache file to verify actualErrorReduction was stored
    const key = buildCacheKey(candidate);
    const filePath = `${tempDir}/add-neurons/${key}.json`;
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);

    // Verify both expected and actual error reduction are present
    assertEquals(
      parsed.expectedErrorReduction,
      0.05,
      "Expected error reduction should be stored",
    );
    assertAlmostEquals(
      parsed.actualErrorReduction,
      0.02,
      1e-9,
      "Actual error reduction should be computed and stored (0.6 - 0.58 = 0.02)",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("recordFailure omits actualErrorReduction when originalError is not provided", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();
    const candidate: DiscoveryCandidate = {
      creature,
      change: {
        type: "add-synapses",
        description: "Add synapse test",
        expectedErrorReduction: 0.03,
      },
    };

    // Record failure WITHOUT originalError
    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.48,
      scoreDelta: -0.02,
      error: 0.58,
      // originalError not provided
    });

    // Read the cache file to verify actualErrorReduction was NOT stored
    const key = buildCacheKey(candidate);
    const filePath = `${tempDir}/add-synapses/${key}.json`;
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);

    // Verify expected error reduction is present but actual is not
    assertEquals(
      parsed.expectedErrorReduction,
      0.03,
      "Expected error reduction should be stored",
    );
    assertEquals(
      parsed.actualErrorReduction,
      undefined,
      "Actual error reduction should NOT be stored when originalError is missing",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("recordFailure handles negative actualErrorReduction (error increased)", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();
    const candidate: DiscoveryCandidate = {
      creature,
      change: {
        type: "add-neurons",
        description: "Add neuron that made things worse",
        expectedErrorReduction: 0.02, // Expected 2% reduction
      },
    };

    // Record failure where error actually increased
    // originalError = 0.5, candidateError = 0.55
    // actualErrorReduction = 0.5 - 0.55 = -0.05 (negative means error increased)
    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.45,
      scoreDelta: -0.05,
      error: 0.55,
      originalError: 0.5,
    });

    // Read the cache file to verify actualErrorReduction captures the negative value
    const key = buildCacheKey(candidate);
    const filePath = `${tempDir}/add-neurons/${key}.json`;
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);

    assertAlmostEquals(
      parsed.actualErrorReduction,
      -0.05,
      1e-9,
      "Actual error reduction should be negative when error increased",
    );
    assertEquals(
      parsed.expectedErrorReduction,
      0.02,
      "Expected error reduction should still be the predicted value",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("recordFailure omits actualErrorReduction when candidateError is Infinity", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();
    const candidate: DiscoveryCandidate = {
      creature,
      change: {
        type: "add-neurons",
        description: "Add neuron that caused evaluation failure",
        expectedErrorReduction: 0.02,
      },
    };

    // Record failure where candidate error is Infinity (worker evaluation failed)
    // This happens when workers return Number.POSITIVE_INFINITY on failure
    // Without proper validation, this would store -Infinity in the cache
    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: -1, // Score is also bad when error is Infinity
      scoreDelta: -1.5,
      error: Number.POSITIVE_INFINITY, // Worker evaluation failure
      originalError: 0.5, // Original was finite
    });

    // Read the cache file to verify actualErrorReduction was NOT stored
    const key = buildCacheKey(candidate);
    const filePath = `${tempDir}/add-neurons/${key}.json`;
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);

    // actualErrorReduction should NOT be stored (it would be -Infinity otherwise)
    assertEquals(
      parsed.actualErrorReduction,
      undefined,
      "actualErrorReduction should NOT be stored when candidateError is Infinity",
    );
    // But error and originalError should still be recorded in metadata
    assertEquals(
      parsed.error,
      null, // JSON serialises Infinity as null
      "error should be recorded (as null in JSON for Infinity)",
    );
    assertEquals(
      parsed.originalError,
      0.5,
      "originalError should be recorded",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("extractTargetNeuronInfo finds neuron using shortID for add-synapses", () => {
  // Bug: extractTargetNeuronInfo extracts shortID from description but compares
  // using exact match (===) against full UUIDs. This test verifies the fix
  // uses endsWith() to match short IDs against full UUIDs.

  const fullTargetUUID = "3e979317-989f-4c5c-8272-02fd85be94a8";
  const fullSourceUUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const targetShortID = shortID(fullTargetUUID); // "85be94a8"
  const sourceShortID = shortID(fullSourceUUID);

  // Create creature with full UUIDs
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: fullTargetUUID, squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: fullTargetUUID, weight: 0.5 },
      { fromUUID: fullTargetUUID, toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);

  // Create add-synapses candidate with shortID in description (as buildDiscoveryCandidates does)
  const candidate: DiscoveryCandidate = {
    creature,
    change: {
      type: "add-synapses",
      description:
        `🔗 Added helpful synapse ${sourceShortID} -> ${targetShortID}`,
    },
  };

  // Extract target neuron info - this should find the neuron despite using shortID
  const result = extractTargetNeuronInfo(candidate, creature);

  // Before fix: result would be undefined because shortID !== fullUUID
  // After fix: result should contain the target neuron info
  assert(result !== undefined, "Should find target neuron using shortID");
  assertEquals(
    result!.uuid,
    fullTargetUUID,
    "Should return full UUID, not shortID",
  );
  assertEquals(result!.squash, "TANH", "Should return correct squash function");
});

Deno.test({
  name: "getDiscoveryVersion returns version string when library is available",
  ignore: shouldSkipRustDiscoveryTests(),
  fn: () => {
    try {
      const version = getDiscoveryVersion();

      // Version should be a non-empty string in semver format (e.g., "0.1.151")
      assert(
        typeof version === "string",
        "Version should be a string when library is available",
      );
      assert(version!.length > 0, "Version string should not be empty");

      // Check it looks like a semver version (x.y.z format)
      const semverPattern = /^\d+\.\d+\.\d+$/;
      assert(
        semverPattern.test(version!),
        `Version should be in semver format (x.y.z), got: ${version}`,
      );

      // Verify caching - second call should return same value
      const version2 = getDiscoveryVersion();
      assertEquals(
        version,
        version2,
        "Version should be cached and return same value on subsequent calls",
      );
    } finally {
      closeRustLibrary();
    }
  },
});

Deno.test({
  name: "recordFailure includes discoveryVersion in cache entry",
  ignore: shouldSkipRustDiscoveryTests(),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();

    try {
      const creature = makeSimpleCreature();
      const candidate = makeCandidate("add-synapses", "test synapse", creature);

      // Record the failure
      await recordFailure(tempDir, candidate, {
        originalScore: 0.5,
        candidateScore: 0.4,
        scoreDelta: -0.1,
        error: 0.6,
      });

      // Read the cache file to verify discoveryVersion was stored
      const key = buildCacheKey(candidate);
      const filePath = `${tempDir}/add-synapses/${key}.json`;
      const content = await Deno.readTextFile(filePath);
      const parsed = JSON.parse(content);

      // Verify discoveryVersion is present and matches the library version
      const expectedVersion = getDiscoveryVersion();
      assert(
        parsed.discoveryVersion !== undefined,
        "discoveryVersion should be stored in cache entry",
      );
      assertEquals(
        parsed.discoveryVersion,
        expectedVersion,
        "discoveryVersion should match library version",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
      closeRustLibrary();
    }
  },
});

Deno.test("recordFailure includes removalCandidate in rustRequest for remove-low-impact", async () => {
  // Issue #922: Failure cache should include the Rust removal candidate in full
  // for debugging purposes when a remove-low-impact candidate fails to improve score
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();

    // Create a RemovalCandidate as Rust would return it
    const removalCandidate: RemovalCandidate = {
      neuronUUID: "hidden-1",
      totalError: 5.0,
      impact: 0.00861,
      reason:
        "High error (5.0000) but very low impact (0.008610) - far from outputs",
    };

    const candidate: DiscoveryCandidate = {
      creature,
      change: {
        type: "remove-low-impact",
        description: `🪶 Removed neuron hidden-1 (impact: ${
          removalCandidate.impact.toExponential(2)
        })`,
        removalCandidate, // This is the new field added for issue #922
      },
    };

    // Record the failure with metadata similar to what DiscoveryRunner provides
    await recordFailure(tempDir, candidate, {
      originalScore: 0.41707403281995525,
      candidateScore: 0.4170737892294639,
      scoreDelta: -2.435904913333786e-7,
      error: 0.5827146017775101,
      originalError: 0.58271423818702,
    }, creature); // Pass base creature for actual changes extraction

    // Read the cache file to verify rustRequest.removalCandidate was stored
    const key = buildCacheKey(candidate);
    const filePath = `${tempDir}/remove-low-impact/${key}.json`;
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);

    // Verify rustRequest contains the removalCandidate
    assert(
      parsed.rustRequest !== undefined,
      "rustRequest should be present in cache entry",
    );
    assert(
      parsed.rustRequest.removalCandidate !== undefined,
      "rustRequest.removalCandidate should be present",
    );
    assertEquals(
      parsed.rustRequest.removalCandidate.neuronUUID,
      "hidden-1",
      "removalCandidate.neuronUUID should match",
    );
    assertEquals(
      parsed.rustRequest.removalCandidate.totalError,
      5.0,
      "removalCandidate.totalError should match",
    );
    assertEquals(
      parsed.rustRequest.removalCandidate.impact,
      0.00861,
      "removalCandidate.impact should match",
    );
    assertEquals(
      parsed.rustRequest.removalCandidate.reason,
      "High error (5.0000) but very low impact (0.008610) - far from outputs",
      "removalCandidate.reason should match",
    );

    // Also verify other standard fields are present
    assertEquals(parsed.changeType, "remove-low-impact");
    assert(parsed.timestamp !== undefined, "timestamp should be present");
    assert(
      parsed.actualErrorReduction !== undefined,
      "actualErrorReduction should be computed",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("recordFailure includes harmfulNeuronCandidate in rustRequest for remove-neuron", async () => {
  // Issue #922: Failure cache should include the harmful neuron candidate in full
  // for debugging purposes when a remove-neuron candidate fails to improve score
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();

    // Create a CandidateHarmfulNeuron as would be produced during analysis
    const harmfulNeuronCandidate: CandidateHarmfulNeuron = {
      neuronUUID: "hidden-1",
      errorMagnitude: 1.5e11,
      expectedCreatureScoreGain: 0.05,
      sampleCount: 100,
      averageActivation: 0.75,
    };

    const candidate: DiscoveryCandidate = {
      creature,
      change: {
        type: "remove-neuron",
        description: `💀 Removed harmful neuron hidden-1 (error: ${
          harmfulNeuronCandidate.errorMagnitude.toExponential(2)
        })`,
        expectedErrorReduction:
          harmfulNeuronCandidate.expectedCreatureScoreGain,
        sampleSize: harmfulNeuronCandidate.sampleCount,
        harmfulNeuronCandidate,
      },
    };

    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.48,
      scoreDelta: -0.02,
      error: 0.55,
      originalError: 0.52,
    }, creature);

    // Read and verify the cache file
    const key = buildCacheKey(candidate);
    const filePath = `${tempDir}/remove-neuron/${key}.json`;
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);

    // Verify rustRequest contains the harmfulNeuronCandidate
    assert(
      parsed.rustRequest !== undefined,
      "rustRequest should be present in cache entry",
    );
    assert(
      parsed.rustRequest.harmfulNeuronCandidate !== undefined,
      "rustRequest.harmfulNeuronCandidate should be present",
    );
    assertEquals(
      parsed.rustRequest.harmfulNeuronCandidate.neuronUUID,
      "hidden-1",
      "harmfulNeuronCandidate.neuronUUID should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulNeuronCandidate.errorMagnitude,
      1.5e11,
      "harmfulNeuronCandidate.errorMagnitude should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulNeuronCandidate.expectedCreatureScoreGain,
      0.05,
      "harmfulNeuronCandidate.expectedCreatureScoreGain should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulNeuronCandidate.sampleCount,
      100,
      "harmfulNeuronCandidate.sampleCount should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulNeuronCandidate.averageActivation,
      0.75,
      "harmfulNeuronCandidate.averageActivation should match",
    );

    assertEquals(parsed.changeType, "remove-neuron");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("recordFailure includes harmfulSynapseCandidate in rustRequest for remove-synapse", async () => {
  // Issue #922: Failure cache should include the harmful synapse candidate in full
  // for debugging purposes when a remove-synapse candidate fails to improve score
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();

    // Create a CandidateSynapse as would be produced during harmful synapse analysis
    const harmfulSynapseCandidate: CandidateSynapse = {
      fromNeuronUUID: "input-0",
      toNeuronUUID: "hidden-1",
      weight: -0.5,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.03,
      improvedCount: 80,
      totalCount: 100,
    };

    const candidate: DiscoveryCandidate = {
      creature,
      change: {
        type: "remove-synapse",
        description: `✂️ Removed harmful synapse input-0 -> hidden-1`,
        expectedErrorReduction:
          harmfulSynapseCandidate.expectedCreatureScoreGain,
        sampleSize: harmfulSynapseCandidate.totalCount,
        synapseDetails: {
          fromNeuronUUID: harmfulSynapseCandidate.fromNeuronUUID,
          toNeuronUUID: harmfulSynapseCandidate.toNeuronUUID,
        },
        harmfulSynapseCandidate,
      },
    };

    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.49,
      scoreDelta: -0.01,
      error: 0.53,
      originalError: 0.51,
    }, creature);

    // Read and verify the cache file
    const key = buildCacheKey(candidate);
    const filePath = `${tempDir}/remove-synapse/${key}.json`;
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);

    // Verify rustRequest contains the harmfulSynapseCandidate
    assert(
      parsed.rustRequest !== undefined,
      "rustRequest should be present in cache entry",
    );
    assert(
      parsed.rustRequest.harmfulSynapseCandidate !== undefined,
      "rustRequest.harmfulSynapseCandidate should be present",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.fromNeuronUUID,
      "input-0",
      "harmfulSynapseCandidate.fromNeuronUUID should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.toNeuronUUID,
      "hidden-1",
      "harmfulSynapseCandidate.toNeuronUUID should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.weight,
      -0.5,
      "harmfulSynapseCandidate.weight should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.expectedCreatureScoreGain,
      0.03,
      "harmfulSynapseCandidate.expectedCreatureScoreGain should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.improvedCount,
      80,
      "harmfulSynapseCandidate.improvedCount should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.totalCount,
      100,
      "harmfulSynapseCandidate.totalCount should match",
    );

    assertEquals(parsed.changeType, "remove-synapse");
    // Also verify synapseDetails is still present (for cache key)
    assert(
      parsed.synapseDetails !== undefined,
      "synapseDetails should still be present",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});
