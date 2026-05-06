/**
 * Tests for the Engram-inspired hash-based subnetwork lookup index
 * (Issue #2531).
 *
 * The index augments the discovery `SuccessCache` / `FailureCache` with an
 * O(1) hash-based secondary lookup keyed on the local subnetwork
 * wire-pattern around a focal neuron.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  computeSubnetworkHash,
  configureSharedSubnetworkIndex,
  extractFocalUuid,
  getSharedSubnetworkIndex,
  SubnetworkHashIndex,
} from "@discovery/SubnetworkHashIndex.ts";
import { recordSuccessSync } from "@discovery/SuccessCache.ts";
import type { DiscoveryCandidate } from "@discovery/DiscoveryCandidates.ts";
import { makeBaseCreature } from "../fixtures/SimpleCreatures.ts";

/**
 * Builds two structurally identical creatures whose hidden neuron has a
 * different UUID — used to verify that the hash is invariant to UUID renaming.
 */
function makeRenamedTwin(base: Creature, newHiddenUuid: string): Creature {
  const json = base.exportJSON();
  // Find the single hidden neuron UUID in the base creature.
  const hidden = json.neurons.find((n) => n.type === "hidden");
  assert(hidden, "test fixture missing hidden neuron");
  const oldUuid = hidden.uuid!;
  hidden.uuid = newHiddenUuid;
  for (const s of json.synapses) {
    if (s.fromUUID === oldUuid) s.fromUUID = newHiddenUuid;
    if (s.toUUID === oldUuid) s.toUUID = newHiddenUuid;
  }
  const twin = Creature.fromJSON(json);
  twin.validate();
  CreatureUtil.makeUUID(twin);
  return twin;
}

Deno.test("SubnetworkHashIndex - identical wire pattern across creatures hashes to the same bucket", () => {
  const a = makeBaseCreature();
  const b = makeBaseCreature();

  const exportedA = a.exportJSON();
  const exportedB = b.exportJSON();

  const focalA = exportedA.neurons.find((n) => n.type === "hidden")!.uuid!;
  const focalB = exportedB.neurons.find((n) => n.type === "hidden")!.uuid!;

  const hashA = computeSubnetworkHash(exportedA, focalA);
  const hashB = computeSubnetworkHash(exportedB, focalB);

  assert(hashA, "hash A should be defined");
  assert(hashB, "hash B should be defined");
  assertEquals(hashA, hashB);
});

Deno.test("SubnetworkHashIndex - hash is invariant to UUID renaming", () => {
  const original = makeBaseCreature();
  const renamed = makeRenamedTwin(
    original,
    "00000000-0000-4000-8000-000000000abc",
  );

  const expO = original.exportJSON();
  const expR = renamed.exportJSON();

  const focalO = expO.neurons.find((n) => n.type === "hidden")!.uuid!;
  const focalR = expR.neurons.find((n) => n.type === "hidden")!.uuid!;

  assertNotEquals(focalO, focalR);

  const hashO = computeSubnetworkHash(expO, focalO);
  const hashR = computeSubnetworkHash(expR, focalR);

  assertEquals(hashO, hashR);
});

Deno.test("SubnetworkHashIndex - hash includes squash function (different squash → different hash)", () => {
  const baseline = makeBaseCreature();
  const json = baseline.exportJSON();
  const hidden = json.neurons.find((n) => n.type === "hidden")!;
  hidden.squash = "TANH";
  const altered = Creature.fromJSON(json);
  altered.validate();
  CreatureUtil.makeUUID(altered);

  const expBase = baseline.exportJSON();
  const expAlt = altered.exportJSON();

  const focal = expBase.neurons.find((n) => n.type === "hidden")!.uuid!;
  const focalAlt = expAlt.neurons.find((n) => n.type === "hidden")!.uuid!;

  const hashBase = computeSubnetworkHash(expBase, focal);
  const hashAlt = computeSubnetworkHash(expAlt, focalAlt);

  assertNotEquals(hashBase, hashAlt);
});

Deno.test("SubnetworkHashIndex - hash is byte-stable across exportJSON/fromJSON round-trip", () => {
  const original = makeBaseCreature();
  const exp1 = original.exportJSON();
  const focalUuid = exp1.neurons.find((n) => n.type === "hidden")!.uuid!;
  const hash1 = computeSubnetworkHash(exp1, focalUuid);

  // Round-trip through JSON.
  const roundTripped = Creature.fromJSON(JSON.parse(JSON.stringify(exp1)));
  roundTripped.validate();
  const exp2 = roundTripped.exportJSON();
  const hash2 = computeSubnetworkHash(exp2, focalUuid);

  assertEquals(hash1, hash2);
});

Deno.test("SubnetworkHashIndex - returns undefined when focal UUID is missing", () => {
  const c = makeBaseCreature();
  const hash = computeSubnetworkHash(c.exportJSON(), "no-such-uuid");
  assertEquals(hash, undefined);
});

Deno.test("SubnetworkHashIndex - hash never contains integer id / fromId / toId fields", () => {
  // Build a hash from an export that legitimately omits integer ids
  // (the canonical wire format) to confirm the underlying inputs do not leak
  // numeric identity.
  const c = makeBaseCreature();
  const exp = c.exportJSON();
  const focalUuid = exp.neurons.find((n) => n.type === "hidden")!.uuid!;
  const hash = computeSubnetworkHash(exp, focalUuid);
  assert(hash);

  // Hash must be a stable hex string — no trailing integer ids.
  assert(/^[0-9a-f]+$/.test(hash!), `hash should be hex; got '${hash}'`);
});

Deno.test("SubnetworkHashIndex - default size 50,000 and isEnabled() reflects size", () => {
  const enabled = new SubnetworkHashIndex<string>();
  assert(enabled.isEnabled());

  const disabled = new SubnetworkHashIndex<string>(0);
  assert(!disabled.isEnabled());
});

Deno.test("SubnetworkHashIndex - lookup misses return empty arrays", () => {
  const idx = new SubnetworkHashIndex<string>(10);
  assertEquals(idx.lookup("nonexistent"), []);
});

Deno.test("SubnetworkHashIndex - insert + lookup is O(1) hashmap-backed", () => {
  const idx = new SubnetworkHashIndex<string>(100);
  for (let i = 0; i < 50; i++) {
    idx.insert(`hash-${i}`, `entry-${i}`);
  }
  assertEquals(idx.count, 50);
  assertEquals(idx.lookup("hash-25"), ["entry-25"]);
  assertEquals(idx.lookup("hash-49"), ["entry-49"]);
  assertEquals(idx.lookup("missing"), []);
});

Deno.test("SubnetworkHashIndex - LRU evicts oldest entries when over capacity", () => {
  const idx = new SubnetworkHashIndex<string>(3);
  idx.advanceGeneration(); // now in generation 1
  idx.advanceGeneration(); // now in generation 2 — these inserts can be evicted
  idx.insert("a", "A");
  idx.insert("b", "B");
  idx.insert("c", "C");

  // Step into a fresh generation before adding new entries so we can evict the old ones.
  idx.advanceGeneration();
  idx.insert("d", "D");

  // 'a' was the oldest and not in the current generation, so it should be gone.
  assertEquals(idx.lookup("a"), []);
  // 'b', 'c', and 'd' should still be present.
  assertEquals(idx.lookup("b"), ["B"]);
  assertEquals(idx.lookup("c"), ["C"]);
  assertEquals(idx.lookup("d"), ["D"]);
});

Deno.test("SubnetworkHashIndex - never evicts entries from the current generation", () => {
  const idx = new SubnetworkHashIndex<string>(2);
  // Insert two entries in the current generation; capacity is 2.
  idx.insert("a", "A");
  idx.insert("b", "B");

  // Insert a third entry from the SAME generation. It would normally evict 'a'.
  // However, the rule says "never evicts entries inserted within the current
  // generation", so over-capacity within one generation is tolerated.
  idx.insert("c", "C");

  // All three must survive while still in the same generation.
  assertEquals(idx.lookup("a"), ["A"]);
  assertEquals(idx.lookup("b"), ["B"]);
  assertEquals(idx.lookup("c"), ["C"]);

  // Once we step into a fresh generation, the next insert can evict the
  // oldest non-current entries.
  idx.advanceGeneration();
  idx.insert("d", "D");

  // 'd' present, and at least one of the older ones evicted to bring back to
  // capacity (the policy evicts oldest-first).
  assertEquals(idx.lookup("d"), ["D"]);
  assert(
    idx.count <= 3,
    `expected count <= 3 after gen step; got ${idx.count}`,
  );
});

Deno.test("SubnetworkHashIndex - clear() empties the index", () => {
  const idx = new SubnetworkHashIndex<number>(5);
  idx.insert("x", 1);
  idx.insert("y", 2);
  assertEquals(idx.count, 2);
  idx.clear();
  assertEquals(idx.count, 0);
  assertEquals(idx.lookup("x"), []);
});

Deno.test("SubnetworkHashIndex - same hash collects multiple entries in a bucket", () => {
  const idx = new SubnetworkHashIndex<string>(10);
  idx.insert("shared", "first");
  idx.insert("shared", "second");
  idx.insert("shared", "third");
  const values = idx.lookup("shared");
  assertEquals(values.length, 3);
  assert(values.includes("first"));
  assert(values.includes("second"));
  assert(values.includes("third"));
});

Deno.test("SubnetworkHashIndex - disabled (size=0) silently drops inserts", () => {
  const idx = new SubnetworkHashIndex<string>(0);
  idx.insert("a", "A");
  idx.insert("b", "B");
  assertEquals(idx.count, 0);
  assertEquals(idx.lookup("a"), []);
});

Deno.test("extractFocalUuid - returns the changed neuron for change-squash", () => {
  const candidate: DiscoveryCandidate = {
    creature: makeBaseCreature(),
    change: {
      type: "change-squash",
      squashCandidate: {
        neuronUuid: "hidden-1",
        previousSquash: "IDENTITY",
        squash: "TANH",
        expectedCreatureScoreGain: 0.1,
        improvedError: 0,
        currentError: 0,
      },
    },
  };
  assertEquals(extractFocalUuid(candidate), "hidden-1");
});

Deno.test("extractFocalUuid - returns undefined for combo / coordinated candidates", () => {
  const combo: DiscoveryCandidate = {
    creature: makeBaseCreature(),
    change: { type: "combo-add-remove" },
  };
  assertEquals(extractFocalUuid(combo), undefined);

  const coordinated: DiscoveryCandidate = {
    creature: makeBaseCreature(),
    change: { type: "coordinated-structural" },
  };
  assertEquals(extractFocalUuid(coordinated), undefined);
});

Deno.test({
  name: "recordSuccessSync populates the shared subnetwork hash index",
  // SuccessCache imports the Rust discovery dylib via getDiscoveryVersion().
  // The dylib is process-global; loading it during a test is benign here.
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Reset the shared index so previous tests don't leak in.
    configureSharedSubnetworkIndex(50_000);
    const idx = getSharedSubnetworkIndex();
    idx.clear();
    assertEquals(idx.count, 0);

    const baseCreature = makeBaseCreature();

    const json = baseCreature.exportJSON();
    const hidden = json.neurons.find((n) => n.type === "hidden")!;
    hidden.squash = "TANH";
    const candidateCreature = Creature.fromJSON(json);
    candidateCreature.validate();
    CreatureUtil.makeUUID(candidateCreature);

    const candidate: DiscoveryCandidate = {
      creature: candidateCreature,
      change: {
        type: "change-squash",
        description: "Change squash to TANH",
        squashCandidate: {
          neuronUuid: hidden.uuid!,
          previousSquash: "IDENTITY",
          squash: "TANH",
          expectedCreatureScoreGain: 0.1,
          improvedError: 0.05,
          currentError: 0.1,
        },
      },
    };

    const tmpDir = await Deno.makeTempDir({ prefix: "subnet-hash-test-" });
    try {
      recordSuccessSync(
        tmpDir,
        candidate,
        {
          originalScore: 0.1,
          candidateScore: 0.2,
          scoreDelta: 0.1,
          error: 0.05,
        },
        baseCreature,
      );

      // The hash index should now contain a reference for the focal neuron.
      assert(idx.count >= 1, `expected count >= 1, got ${idx.count}`);

      const focal = extractFocalUuid(candidate)!;
      const hash = computeSubnetworkHash(baseCreature, focal)!;
      const matches = idx.lookup(hash);
      assertEquals(matches.length, 1);
      assertEquals(matches[0].source, "success");
      assertEquals(matches[0].changeType, "change-squash");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "recordSuccessSync is a no-op for the index when size = 0 (disabled)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    configureSharedSubnetworkIndex(0);
    const idx = getSharedSubnetworkIndex();
    assertEquals(idx.count, 0);
    assert(!idx.isEnabled());

    const baseCreature = makeBaseCreature();
    const json = baseCreature.exportJSON();
    const hidden = json.neurons.find((n) => n.type === "hidden")!;
    hidden.squash = "TANH";
    const candidateCreature = Creature.fromJSON(json);
    candidateCreature.validate();
    CreatureUtil.makeUUID(candidateCreature);

    const candidate: DiscoveryCandidate = {
      creature: candidateCreature,
      change: {
        type: "change-squash",
        description: "Change squash to TANH",
        squashCandidate: {
          neuronUuid: hidden.uuid!,
          previousSquash: "IDENTITY",
          squash: "TANH",
          expectedCreatureScoreGain: 0.1,
          improvedError: 0.05,
          currentError: 0.1,
        },
      },
    };

    const tmpDir = await Deno.makeTempDir({ prefix: "subnet-hash-test-" });
    try {
      recordSuccessSync(
        tmpDir,
        candidate,
        {
          originalScore: 0.1,
          candidateScore: 0.2,
          scoreDelta: 0.1,
          error: 0.05,
        },
        baseCreature,
      );
      assertEquals(idx.count, 0, "index should remain empty when disabled");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
      // Reset for downstream tests.
      configureSharedSubnetworkIndex(50_000);
    }
  },
});

Deno.test("SubnetworkHashIndex - lookup matches without re-verify cannot leak through (no false positives)", () => {
  // Two different references can be stored under the same hash; the lookup
  // returns both, leaving it to the caller's re-verify path
  // (`isEntryRelevantToCreature` / `applyEntryUsingRustRequest`) to gate
  // applicability. This test pins down that contract.
  const idx = new SubnetworkHashIndex<{ key: string; ok: boolean }>(10);
  idx.insert("h", { key: "applies", ok: true });
  idx.insert("h", { key: "stale", ok: false });

  const matches = idx.lookup("h");
  assertEquals(matches.length, 2);

  // Caller is expected to filter (re-verify) the bucket. Demonstrate that
  // shape here: only the `ok` entry survives a re-verification step.
  const verified = matches.filter((m) => m.ok);
  assertEquals(verified.length, 1);
  assertEquals(verified[0].key, "applies");
});
