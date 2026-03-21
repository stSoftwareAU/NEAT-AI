/**
 * Tests for removeSyntheticSynapses()
 *
 * Issue #1922 - Verifies that near-zero weight synthetic synapses are pruned
 * after training, meaningful-weight synapses are retained, and orphaned neurons
 * are properly handled.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { generateSyntheticSynapses } from "../../src/propagate/SyntheticSynapses.ts";
import { removeSyntheticSynapses } from "../../src/propagate/RemoveSyntheticSynapses.ts";

Deno.test("removeSyntheticSynapses - removes all near-zero synthetic synapses", () => {
  // 2 inputs, 2 hidden, 1 output — sparse initial wiring
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h2", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const originalSynapseCount = creature.synapses.length;

  // Generate synthetic synapses (zero-weight)
  const { syntheticKeys } = generateSyntheticSynapses(creature);
  assertNotEquals(
    syntheticKeys.size,
    0,
    "Should have added synthetic synapses",
  );

  // All synthetic synapses remain at zero weight (simulate no training effect)
  const result = removeSyntheticSynapses(creature, syntheticKeys);

  // All synthetic synapses should be removed
  assertEquals(result.removed, syntheticKeys.size);
  assertEquals(creature.synapses.length, originalSynapseCount);
});

Deno.test("removeSyntheticSynapses - retains trained synthetic synapses", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h2", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  const { syntheticKeys } = generateSyntheticSynapses(creature);
  assertNotEquals(syntheticKeys.size, 0);

  // Simulate training: set one synthetic synapse to a meaningful weight
  const firstKey = [...syntheticKeys][0];
  const [fromStr, toStr] = firstKey.split("-");
  const synapse = creature.getSynapse(parseInt(fromStr), parseInt(toStr));
  assertNotEquals(synapse, null);
  synapse!.weight = 0.5; // Trained to meaningful value

  const result = removeSyntheticSynapses(creature, syntheticKeys);

  // One synapse retained, rest removed
  assertEquals(result.removed, syntheticKeys.size - 1);

  // The trained synapse should still exist
  const retained = creature.getSynapse(parseInt(fromStr), parseInt(toStr));
  assertNotEquals(
    retained,
    null,
    "Trained synthetic synapse should be retained",
  );
  assertEquals(retained!.weight, 0.5);
});

Deno.test("removeSyntheticSynapses - handles orphaned hidden neuron (converts to constant)", () => {
  // h2 has only one inward connection which is synthetic.
  // After removal, h2 has no inward connections but has outward → converted to constant.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  // Manually add a synthetic synapse from input-0 to h2
  const h2Idx = creature.neurons.findIndex((n) => n.uuid === "h2");
  creature.connect(0, h2Idx, 0); // zero-weight synthetic
  const syntheticKeys = new Set<string>([`0-${h2Idx}`]);

  const result = removeSyntheticSynapses(creature, syntheticKeys);

  assertEquals(result.removed, 1);
  assertEquals(result.orphansConverted, 1);

  // h2 should now be a constant neuron
  const h2 = creature.neurons.find((n) => n.uuid === "h2");
  assertNotEquals(h2, undefined);
  assertEquals(h2!.type, "constant");
});

Deno.test("removeSyntheticSynapses - handles orphaned neuron removal (no outward connections)", () => {
  // h2 has one inward (synthetic) and no outward connections.
  // After removal, h2 becomes fully orphaned → removed entirely.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const neuronCountBefore = creature.neurons.length;

  // Add synthetic synapse to h2 (which has no outward connections)
  const h2Idx = creature.neurons.findIndex((n) => n.uuid === "h2");
  creature.connect(0, h2Idx, 0);
  const syntheticKeys = new Set<string>([`0-${h2Idx}`]);

  const result = removeSyntheticSynapses(creature, syntheticKeys);

  assertEquals(result.removed, 1);
  assertEquals(result.orphansRemoved, 1);
  // h2 should be completely removed
  assertEquals(
    creature.neurons.length,
    neuronCountBefore - 1,
    "Orphaned neuron should be removed",
  );
  assertEquals(
    creature.neurons.some((n) => n.uuid === "h2"),
    false,
    "h2 should not exist any more",
  );
});

Deno.test("removeSyntheticSynapses - cascade removal", () => {
  // h1 → h2 → output. h1 has only a synthetic inward connection.
  // Removing it orphans h1 (convert to constant), which may then orphan h2
  // if h2's only other inward is also synthetic.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "h1", toUUID: "h2", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
      // Direct input to output so output keeps a connection
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const creature = Creature.fromJSON(json);

  // Add synthetic synapse: input-0 → h1
  const h1Idx = creature.neurons.findIndex((n) => n.uuid === "h1");
  creature.connect(0, h1Idx, 0);
  const syntheticKeys = new Set<string>([`0-${h1Idx}`]);

  const result = removeSyntheticSynapses(creature, syntheticKeys);

  assertEquals(result.removed, 1);
  // h1 loses its only inward → orphaned. The cleanup should handle cascade.
  const totalOrphansHandled = result.orphansRemoved + result.orphansConverted;
  assertNotEquals(
    totalOrphansHandled,
    0,
    "Should handle orphaned neurons from cascade",
  );
});

Deno.test("removeSyntheticSynapses - output neurons always retain at least one connection", () => {
  // Output has only one inward connection which is synthetic.
  // It should NOT be removed (output must keep ≥1 inward).
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const creature = Creature.fromJSON(json);

  // The existing synapse is the only one to output. Add synthetic key for it
  // but pretend it's synthetic and near-zero.
  const outputIdx = creature.neurons.findIndex((n) => n.type === "output");
  // Replace existing weight with zero to simulate untrained synthetic
  creature.synapses[0].weight = 0;
  const syntheticKeys = new Set<string>([`0-${outputIdx}`]);

  const result = removeSyntheticSynapses(creature, syntheticKeys);

  // Should NOT remove the last connection to an output
  assertEquals(result.removed, 0);
  assertEquals(creature.synapses.length, 1);
});

Deno.test("removeSyntheticSynapses - typed synapses are never removed", () => {
  // IF neuron with typed synapses marked as synthetic should be preserved
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h-if", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "h-if",
        weight: 0,
        type: "condition",
      },
      {
        fromUUID: "input-0",
        toUUID: "h-if",
        weight: 0,
        type: "positive",
      },
      {
        fromUUID: "input-1",
        toUUID: "h-if",
        weight: 0,
        type: "negative",
      },
      { fromUUID: "h-if", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  // Mark all connections as synthetic (even typed ones)
  const syntheticKeys = new Set<string>();
  for (const s of creature.synapses) {
    syntheticKeys.add(`${s.from}-${s.to}`);
  }

  const result = removeSyntheticSynapses(creature, syntheticKeys);

  // Typed synapses should NOT be removed even though they have zero weight
  // The h-if→output-0 has weight=1 so it's also retained
  assertEquals(result.removed, 0);
});

Deno.test("removeSyntheticSynapses - empty synthetic keys returns zero changes", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  const result = removeSyntheticSynapses(creature, new Set());

  assertEquals(result.removed, 0);
  assertEquals(result.orphansRemoved, 0);
  assertEquals(result.orphansConverted, 0);
});

Deno.test("removeSyntheticSynapses - custom threshold controls near-zero detection", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  // Add a synthetic synapse with small but non-trivial weight
  const h1Idx = creature.neurons.findIndex((n) => n.uuid === "h1");
  creature.connect(1, h1Idx, 0.01); // weight = 0.01
  const syntheticKeys = new Set<string>([`1-${h1Idx}`]);

  // Default threshold (plankConstant = 1e-7) should NOT remove it
  const result1 = removeSyntheticSynapses(creature, syntheticKeys);
  assertEquals(
    result1.removed,
    0,
    "Default threshold should retain 0.01 weight",
  );

  // Custom large threshold should remove it
  const result2 = removeSyntheticSynapses(creature, syntheticKeys, 0.05);
  assertEquals(result2.removed, 1, "Threshold 0.05 should remove 0.01 weight");
});

Deno.test("removeSyntheticSynapses - creature remains valid after removal", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h2", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  const { syntheticKeys } = generateSyntheticSynapses(creature);
  removeSyntheticSynapses(creature, syntheticKeys);

  // Creature should still be structurally valid
  creature.validate();
});
