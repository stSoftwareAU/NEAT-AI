/**
 * Tests for ModWeight focus filtering correctness (Issue #2124).
 *
 * Verifies that:
 * - Frozen synapses are excluded from focus filtering
 * - Deduplication works when multiple focus neurons share synapses
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { ModWeight } from "@mutate/ModWeight.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ModWeight - frozen synapses excluded from focus filtering", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-1",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5, frozen: true },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Verify the frozen synapse is correctly loaded
  const frozenSyn = creature.synapses.find(
    (s) => s.from === 0 && s.to === 2,
  );
  assert(frozenSyn, "Should find the frozen synapse");
  assertEquals(frozenSyn.frozen, true, "Synapse should be frozen");

  // Focus on hidden-1 (index 2) — all 3 synapses connect to it,
  // but the frozen one (input-0 → hidden-1) must be excluded
  const focusList = [2];

  // Track which synapses get modified over many iterations
  const modifiedSynapseKeys = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const initialWeights = creature.synapses.map((s) => s.weight);
    new ModWeight(creature).mutate(focusList);
    for (let j = 0; j < creature.synapses.length; j++) {
      if (initialWeights[j] !== creature.synapses[j].weight) {
        modifiedSynapseKeys.add(
          `${creature.synapses[j].from}->${creature.synapses[j].to}`,
        );
      }
    }
  }

  // The frozen synapse (0->2) must never be modified
  assert(
    !modifiedSynapseKeys.has("0->2"),
    "Frozen synapse must not be modified during focus filtering",
  );

  // The non-frozen synapses connected to focus should be modified
  assert(
    modifiedSynapseKeys.has("1->2"),
    "Non-frozen inward synapse should be modified",
  );
  assert(
    modifiedSynapseKeys.has("2->3"),
    "Non-frozen outward synapse should be modified",
  );
});

Deno.test("ModWeight - deduplication when focus neurons share synapses", () => {
  // Create a network where two focus neurons are connected by the same synapse
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-1",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "hidden" as const,
        uuid: "hidden-2",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 0.3 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.4 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: 0.6 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Focus on both hidden-1 (index 2) and hidden-2 (index 3)
  // The synapse hidden-1 → hidden-2 is both outward from hidden-1 AND inward to hidden-2
  // It should appear only once in the relevant connections (deduplication)
  const focusList = [2, 3];

  // Run many mutations and count how often each synapse is picked
  const modifiedCounts = new Map<string, number>();
  const iterations = 2000;

  for (let i = 0; i < iterations; i++) {
    const initialWeights = creature.synapses.map((s) => s.weight);
    new ModWeight(creature).mutate(focusList);
    for (let j = 0; j < creature.synapses.length; j++) {
      if (initialWeights[j] !== creature.synapses[j].weight) {
        const key = `${creature.synapses[j].from}->${creature.synapses[j].to}`;
        modifiedCounts.set(key, (modifiedCounts.get(key) ?? 0) + 1);
      }
    }
  }

  // All 4 synapses connect to at least one focus neuron, so all should be modified
  assert(
    modifiedCounts.has("0->2"),
    "Synapse input-0 → hidden-1 should be modified",
  );
  assert(
    modifiedCounts.has("1->3"),
    "Synapse input-1 → hidden-2 should be modified",
  );
  assert(
    modifiedCounts.has("2->3"),
    "Synapse hidden-1 → hidden-2 should be modified",
  );
  assert(
    modifiedCounts.has("3->4"),
    "Synapse hidden-2 → output-0 should be modified",
  );

  // The shared synapse (hidden-1 → hidden-2, key "2->3") should NOT be
  // picked more often than others due to duplication. With proper deduplication
  // and 4 synapses, each should be picked ~25% of the time.
  const sharedCount = modifiedCounts.get("2->3") ?? 0;
  const totalModifications = [...modifiedCounts.values()].reduce(
    (a, b) => a + b,
    0,
  );
  const sharedRatio = sharedCount / totalModifications;

  // If deduplication failed, the shared synapse would appear twice in the pool
  // (5 entries instead of 4), giving it ~40% instead of ~25%.
  // Allow a generous margin but catch gross duplication.
  assert(
    sharedRatio < 0.35,
    `Shared synapse was selected ${
      (sharedRatio * 100).toFixed(1)
    }% of the time — ` +
      `suggests deduplication failure (expected ~25%)`,
  );
});

Deno.test("ModWeight - frozen synapses excluded even with shared focus", () => {
  // Network where a frozen synapse connects two focus neurons
  const json = {
    input: 1,
    output: 1,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-1",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "hidden" as const,
        uuid: "hidden-2",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.4, frozen: true },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: 0.6 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Focus on both hidden neurons — the synapse between them is frozen
  const focusList = [1, 2];

  for (let i = 0; i < 500; i++) {
    const frozenWeight = creature.synapses[1].weight;
    new ModWeight(creature).mutate(focusList);
    assertEquals(
      creature.synapses[1].weight,
      frozenWeight,
      "Frozen synapse weight must not change",
    );
  }
});
