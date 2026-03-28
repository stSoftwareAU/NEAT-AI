/**
 * Unit tests for CacheInformedRemovalCandidates.
 *
 * Issue #1731: Tests for building multi-neuron removal candidates
 * from the success cache data.
 *
 * Covers:
 * - buildCacheInformedRemovalCandidates
 * - Edge cases: empty cache, no matching neurons, single match
 * - Combination building: pairs and triples
 * - Seeded RNG for reproducible sampling
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path/join";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { buildCacheInformedRemovalCandidates } from "../../src/discovery/CacheInformedRemovalCandidates.ts";
import { DISCOVERY_WIRE_SCHEMA_VERSION } from "../../src/discovery/DiscoveryWireFormat.ts";

const HIDDEN_1_UUID = "hidden-1";
const HIDDEN_2_UUID = "hidden-2";
const HIDDEN_3_UUID = "hidden-3";
const HIDDEN_4_UUID = "hidden-4";
const NONEXISTENT_1_UUID = "nonexistent-1";
const NONEXISTENT_2_UUID = "nonexistent-2";
const NONEXISTENT_99_UUID = "nonexistent-99";

/**
 * Creates a baseline creature with multiple hidden neurons for testing
 * multi-neuron removal.
 *
 * Topology: input-0, input-1 → hidden-1 → output-0
 *                               hidden-2 → output-0
 *                               hidden-3 → output-0
 *                               hidden-4 → output-0
 */
function makeBaseCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-2", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "hidden-3", squash: "IDENTITY", bias: 0.2 },
      { type: "hidden", uuid: "hidden-4", squash: "IDENTITY", bias: 0.3 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-0", toUUID: "hidden-2", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "hidden-3", weight: 0.4 },
      { fromUUID: "input-1", toUUID: "hidden-4", weight: 0.2 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: -0.3 },
      { fromUUID: "hidden-3", toUUID: "output-0", weight: 0.1 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: -0.1 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/**
 * Creates a success cache directory with removal entries for the given neuron UUIDs.
 */
async function createSuccessCache(
  neuronUuids: string[],
  options?: { scoreDelta?: number; timestamp?: string },
): Promise<string> {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-cache-informed-",
  });
  const removeLowImpactDir = join(cacheDir, "remove-low-impact");
  await Deno.mkdir(removeLowImpactDir, { recursive: true });

  const writePromises = neuronUuids.map((uuid, i) =>
    Deno.writeTextFile(
      join(removeLowImpactDir, `entry-${i}.json`),
      JSON.stringify({
        wireSchemaVersion: DISCOVERY_WIRE_SCHEMA_VERSION,
        key: `entry-${i}`,
        changeType: "remove-low-impact",
        originalScore: 1.0,
        candidateScore: 1.0 + (options?.scoreDelta ?? 0.1 * (i + 1)),
        scoreDelta: options?.scoreDelta ?? 0.1 * (i + 1),
        error: 0.5,
        timestamp: options?.timestamp ?? "2025-01-15T10:00:00.000Z",
        rustRequest: {
          removalCandidate: { neuronUuid: uuid },
        },
      }),
    )
  );
  await Promise.all(writePromises);

  return cacheDir;
}

// --- Empty / missing cache ---

Deno.test("buildCacheInformedRemovalCandidates - returns empty for undefined successCacheDir", () => {
  const base = makeBaseCreature();
  const result = buildCacheInformedRemovalCandidates(base, undefined);
  assertEquals(result.length, 0);
});

Deno.test("buildCacheInformedRemovalCandidates - returns empty for non-existent cache directory", () => {
  const base = makeBaseCreature();
  const result = buildCacheInformedRemovalCandidates(
    base,
    "/tmp/does-not-exist-neat-ai-cache-informed",
  );
  assertEquals(result.length, 0);
});

Deno.test("buildCacheInformedRemovalCandidates - returns empty for empty cache directory", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-cache-informed-empty-",
  });
  try {
    const base = makeBaseCreature();
    const result = buildCacheInformedRemovalCandidates(base, cacheDir);
    assertEquals(result.length, 0);
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

// --- Single neuron in cache (need at least 2 for combinations) ---

Deno.test("buildCacheInformedRemovalCandidates - returns empty when only one neuron in cache", async () => {
  const cacheDir = await createSuccessCache([HIDDEN_1_UUID]);
  try {
    const base = makeBaseCreature();
    const result = buildCacheInformedRemovalCandidates(base, cacheDir);
    assertEquals(result.length, 0);
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

// --- Neurons not in creature ---

Deno.test("buildCacheInformedRemovalCandidates - returns empty when cached neurons not in creature", async () => {
  const cacheDir = await createSuccessCache([
    NONEXISTENT_1_UUID,
    NONEXISTENT_2_UUID,
  ]);
  try {
    const base = makeBaseCreature();
    const result = buildCacheInformedRemovalCandidates(base, cacheDir);
    assertEquals(result.length, 0);
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

// --- Two neurons in cache (pair combination) ---

Deno.test("buildCacheInformedRemovalCandidates - builds pair candidate from two cached neurons", async () => {
  const cacheDir = await createSuccessCache([HIDDEN_1_UUID, HIDDEN_2_UUID]);
  try {
    const base = makeBaseCreature();
    const result = buildCacheInformedRemovalCandidates(base, cacheDir);

    assert(result.length > 0, "should produce at least one candidate");

    for (const candidate of result) {
      assertEquals(candidate.change.type, "cache-informed-removal");
      assert(candidate.creature, "candidate should have a creature");
      assert(
        candidate.change.description?.includes("cache-informed"),
        `description should mention cache-informed, got: ${candidate.change.description}`,
      );

      // Verify the removed neurons are actually gone
      // At least one of the cached neurons should be removed
      const removedCount = [HIDDEN_1_UUID, HIDDEN_2_UUID].filter(
        (uuid) => !candidate.creature.neurons.some((n) => n.uuid === uuid),
      ).length;
      assert(
        removedCount >= 2,
        `should remove at least 2 neurons, but only ${removedCount} removed`,
      );
    }
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

// --- Three neurons in cache (pair + triple combinations) ---

Deno.test("buildCacheInformedRemovalCandidates - builds pair and triple candidates from three cached neurons", async () => {
  const cacheDir = await createSuccessCache([
    HIDDEN_1_UUID,
    HIDDEN_2_UUID,
    HIDDEN_3_UUID,
  ]);
  try {
    const base = makeBaseCreature();
    const result = buildCacheInformedRemovalCandidates(base, cacheDir);

    assert(result.length > 0, "should produce at least one candidate");

    // Should have both pair and triple combinations
    const pairCandidates = result.filter((c) =>
      c.change.description?.includes("2 neurons")
    );
    const tripleCandidates = result.filter((c) =>
      c.change.description?.includes("3 neurons")
    );

    assert(
      pairCandidates.length > 0,
      "should produce pair candidates",
    );
    assert(
      tripleCandidates.length > 0,
      "should produce triple candidates",
    );
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

// --- Only matching neurons are used ---

Deno.test("buildCacheInformedRemovalCandidates - filters to neurons existing in creature", async () => {
  const cacheDir = await createSuccessCache([
    HIDDEN_1_UUID,
    NONEXISTENT_99_UUID,
    HIDDEN_2_UUID,
  ]);
  try {
    const base = makeBaseCreature();
    const result = buildCacheInformedRemovalCandidates(base, cacheDir);

    // Should still produce candidates from the 2 valid neurons
    assert(result.length > 0, "should produce candidates from valid neurons");
    for (const candidate of result) {
      assertEquals(candidate.change.type, "cache-informed-removal");
    }
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

// --- Seeded RNG reproducibility ---

Deno.test("buildCacheInformedRemovalCandidates - produces reproducible results with same seed", async () => {
  const cacheDir = await createSuccessCache([
    HIDDEN_1_UUID,
    HIDDEN_2_UUID,
    HIDDEN_3_UUID,
    HIDDEN_4_UUID,
  ]);
  try {
    const base = makeBaseCreature();
    const result1 = buildCacheInformedRemovalCandidates(base, cacheDir, 42);
    const result2 = buildCacheInformedRemovalCandidates(base, cacheDir, 42);

    assertEquals(
      result1.length,
      result2.length,
      "same seed should produce same count",
    );
    for (let i = 0; i < result1.length; i++) {
      assertEquals(
        result1[i].change.description,
        result2[i].change.description,
        `candidate ${i} should have same description with same seed`,
      );
    }
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

// --- Change type is correct ---

Deno.test("buildCacheInformedRemovalCandidates - all candidates have cache-informed-removal type", async () => {
  const cacheDir = await createSuccessCache([
    HIDDEN_1_UUID,
    HIDDEN_2_UUID,
    HIDDEN_3_UUID,
  ]);
  try {
    const base = makeBaseCreature();
    const result = buildCacheInformedRemovalCandidates(base, cacheDir);

    for (const candidate of result) {
      assertEquals(
        candidate.change.type,
        "cache-informed-removal",
        "all candidates should have cache-informed-removal type",
      );
    }
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});
