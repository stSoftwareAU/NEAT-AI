import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { cleanupOrphanedNeurons } from "../../src/compact/CompactUtils.ts";
import { assertValidSynapseReferences } from "@architecture/AssertValidSynapseReferences.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { LOGISTIC } from "@methods/activations/types/LOGISTIC.ts";

Deno.test("cleanupOrphanedNeurons - deep cascade: A→B→C→D all removed when A is sole source", () => {
  // Chain: input→A→B→C→D, plus input→output.
  // A is the only source. We externally remove A's outward synapse (A→B).
  // Then: A has no outward → removed. B has no inward → convert to constant.
  // B (constant) still has B→C, so C→D chain continues. B, C, D survive.
  //
  // For full cascade removal, we need to cut the entire chain from output.
  // Remove D→output externally. Then D has no outward → removed.
  // C has no outward (C→D gone) → removed. B has no outward → removed.
  // A has no outward (A→B gone via toId cleanup) → removed.
  const creatureExport: CreatureExport = {
    neurons: [
      { type: "hidden", squash: LOGISTIC.NAME, bias: 0.1, uuid: "A" },
      { type: "hidden", squash: LOGISTIC.NAME, bias: 0.2, uuid: "B" },
      { type: "hidden", squash: LOGISTIC.NAME, bias: 0.3, uuid: "C" },
      { type: "hidden", squash: LOGISTIC.NAME, bias: 0.4, uuid: "D" },
      { type: "output", squash: LOGISTIC.NAME, bias: 0.0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "A", weight: 1.0 },
      { fromUUID: "A", toUUID: "B", weight: 1.0 },
      { fromUUID: "B", toUUID: "C", weight: 1.0 },
      { fromUUID: "C", toUUID: "D", weight: 1.0 },
      { fromUUID: "D", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 2,
    output: 1,
  };

  // Normalise to populate integer IDs before manual manipulation
  normaliseCreatureExport(creatureExport);

  // Find D's ID and the output ID
  // deno-lint-ignore no-explicit-any
  const dId = creatureExport.neurons.find((n) => (n as any).uuid === "D")!.id!;
  const outputId = creatureExport.neurons.find((n) => n.type === "output")!
    .id!;

  // Externally remove D→output synapse (simulating an upstream operation)
  creatureExport.synapses = creatureExport.synapses.filter(
    (s) => !(s.fromId === dId && s.toId === outputId),
  );

  // Run cleanup — D has no outward → removed, then C, B, A cascade
  const result = cleanupOrphanedNeurons(creatureExport);

  assertEquals(
    creatureExport.neurons.length,
    1,
    "Only output neuron should remain after deep cascade",
  );

  // No dangling synapse references
  assertValidSynapseReferences(creatureExport, "deep cascade");

  // Only input→output synapse should remain
  assertEquals(creatureExport.synapses.length, 1);

  const creature = Creature.fromJSON(creatureExport);
  creatureValidate(creature);

  // All 4 hidden neurons should have been removed
  assertEquals(result.removed, 4, "All 4 hidden neurons should be removed");
});

Deno.test("cleanupOrphanedNeurons - hidden-to-constant conversion then orphaning", () => {
  // Hidden neuron H has no inward connections (gets converted to constant).
  // H→X is H's only outward. X has no outward → orphaned.
  // Pass 1: H→constant, X removed (no outward), synapse H→X removed.
  // Pass 2: H (constant) now has no outward → removed.
  const creatureExport: CreatureExport = {
    neurons: [
      { type: "hidden", squash: LOGISTIC.NAME, bias: 0.5, uuid: "H" },
      { type: "hidden", squash: LOGISTIC.NAME, bias: 0.3, uuid: "X" },
      { type: "output", squash: LOGISTIC.NAME, bias: 0.0, uuid: "output-0" },
    ],
    synapses: [
      // H has NO inward connections but has outward to X
      { fromUUID: "H", toUUID: "X", weight: 1.0 },
      // X has inward from H but NO outward connections
      // Direct path to output to keep creature structure valid
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 2,
    output: 1,
  };

  const result = cleanupOrphanedNeurons(creatureExport);

  // Both H and X should be removed
  assertEquals(
    creatureExport.neurons.length,
    1,
    "Only output neuron should remain",
  );

  assertValidSynapseReferences(
    creatureExport,
    "hidden-to-constant then orphan",
  );

  assertEquals(result.converted > 0, true, "Should have converted H");
  assertEquals(result.removed > 0, true, "Should have removed neurons");

  const creature = Creature.fromJSON(creatureExport);
  creatureValidate(creature);
});

Deno.test("cleanupOrphanedNeurons - multiple neurons orphaned simultaneously", () => {
  // Both X and Y have inward connections but no outward connections.
  // They should both be detected and removed in the same pass.
  const creatureExport: CreatureExport = {
    neurons: [
      { type: "hidden", squash: LOGISTIC.NAME, bias: 0.1, uuid: "X" },
      { type: "hidden", squash: LOGISTIC.NAME, bias: 0.2, uuid: "Y" },
      { type: "output", squash: LOGISTIC.NAME, bias: 0.0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "X", weight: 1.0 },
      { fromUUID: "input-1", toUUID: "Y", weight: 1.0 },
      // Neither X nor Y has outward connections → both orphaned
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 2,
    output: 1,
  };

  const result = cleanupOrphanedNeurons(creatureExport);

  assertEquals(
    creatureExport.neurons.length,
    1,
    "Only output neuron should remain",
  );

  assertValidSynapseReferences(
    creatureExport,
    "multiple simultaneous orphans",
  );

  assertEquals(result.removed, 2, "Should remove both X and Y");
  assertEquals(creatureExport.synapses.length, 1);

  const creature = Creature.fromJSON(creatureExport);
  creatureValidate(creature);
});

Deno.test("cleanupOrphanedNeurons - constant neuron with only inward connections", () => {
  // A constant neuron should have outward connections. If a bug creates one
  // with only inward connections, verify it gets cleaned up.
  const creatureExport: CreatureExport = {
    neurons: [
      { type: "constant", bias: 1.0, uuid: "const-orphan" },
      { type: "output", squash: LOGISTIC.NAME, bias: 0.0, uuid: "output-0" },
    ],
    synapses: [
      // Inward connection TO the constant (unusual/buggy)
      { fromUUID: "input-0", toUUID: "const-orphan", weight: 0.5 },
      // Direct input→output
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 2,
    output: 1,
  };

  const result = cleanupOrphanedNeurons(creatureExport);

  assertEquals(
    creatureExport.neurons.length,
    1,
    "Constant with only inward connections should be removed",
  );

  assertValidSynapseReferences(
    creatureExport,
    "constant with only inward",
  );

  assertEquals(result.removed, 1);
  assertEquals(creatureExport.synapses.length, 1);

  const creature = Creature.fromJSON(creatureExport);
  creatureValidate(creature);
});

Deno.test("cleanupOrphanedNeurons - self-referencing synapse edge case", () => {
  // A hidden neuron with a self-loop (from=to) but no other outward connections.
  // The self-loop technically counts as an outward connection in the current
  // algorithm, but the neuron is functionally orphaned.
  // At minimum, no dangling synapse references should remain.
  const creatureExport: CreatureExport = {
    neurons: [
      { type: "hidden", squash: LOGISTIC.NAME, bias: 0.5, uuid: "self-loop" },
      { type: "output", squash: LOGISTIC.NAME, bias: 0.0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "self-loop", weight: 1.0 },
      // Self-loop: from and to are the same neuron
      { fromUUID: "self-loop", toUUID: "self-loop", weight: 0.5 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 2,
    output: 1,
  };

  cleanupOrphanedNeurons(creatureExport);

  // Whether or not the self-loop neuron is removed, there must be
  // no dangling synapse references.
  assertValidSynapseReferences(
    creatureExport,
    "self-referencing synapse",
  );

  // Verify all synapses reference valid neurons
  const validIds = new Set<number>();
  for (let i = 0; i < creatureExport.input; i++) validIds.add(i);
  for (const n of creatureExport.neurons) {
    if (n.id !== undefined) validIds.add(n.id);
  }
  for (const synapse of creatureExport.synapses) {
    assertEquals(
      validIds.has(synapse.fromId!),
      true,
      `fromId ${synapse.fromId} must reference valid neuron`,
    );
    assertEquals(
      validIds.has(synapse.toId!),
      true,
      `toId ${synapse.toId} must reference valid neuron`,
    );
  }
});

Deno.test("cleanupOrphanedNeurons - defensive fromId cleanup prevents dangling references", () => {
  // Cascade scenario: feeder→target, target has no outward → orphaned.
  // When target is removed, feeder→target synapse is cleaned up (toId check).
  // The defensive fromId check ensures that even if the toId check were
  // somehow bypassed, synapses FROM orphaned neurons would also be removed.
  // After target is removed, feeder has no outward → removed in next pass.
  const creatureExport: CreatureExport = {
    neurons: [
      { type: "hidden", squash: LOGISTIC.NAME, bias: 0.1, uuid: "feeder" },
      { type: "hidden", squash: LOGISTIC.NAME, bias: 0.2, uuid: "target" },
      { type: "output", squash: LOGISTIC.NAME, bias: 0.0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "feeder", weight: 1.0 },
      { fromUUID: "feeder", toUUID: "target", weight: 1.0 },
      // target has NO outward connections → orphaned
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 2,
    output: 1,
  };

  const result = cleanupOrphanedNeurons(creatureExport);

  // target removed (no outward), feeder→target synapse removed,
  // feeder now has no outward → removed in next pass
  assertEquals(
    creatureExport.neurons.length,
    1,
    "Only output neuron should remain",
  );

  // Critical: no dangling synapse references
  assertValidSynapseReferences(
    creatureExport,
    "defensive fromId cleanup",
  );

  assertEquals(result.removed, 2, "Both neurons should be removed");
  assertEquals(creatureExport.synapses.length, 1);
});
