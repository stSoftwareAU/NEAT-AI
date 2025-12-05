import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  buildCacheKey,
  extractExponent,
  formatWeight,
  isCandidateCached,
  recordFailure,
} from "../../src/discovery/FailureCache.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";

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

    // Record the failure
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
  }
});
