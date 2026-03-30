import { assert, assertEquals } from "@std/assert";
import {
  buildCacheKey,
  isCandidateCached,
  isCandidateCachedSync,
  recordFailure,
  recordFailureSync,
} from "@discovery/FailureCache.ts";
import type { DiscoveryCandidate } from "@discovery/DiscoveryCandidates.ts";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { closeRustLibrary } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
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
