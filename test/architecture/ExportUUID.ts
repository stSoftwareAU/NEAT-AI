/**
 * ExportUUID.ts - Tests for stable uuid / fromUUID / toUUID in exportJSON.
 *
 * Public exports identify neurons by stable uuid strings only; integer ids are internal.
 */

import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { exportSnapshotJSON } from "../../src/creature/CreatureSerialization.ts";

/** Helper: creates a creature from legacy UUID-format JSON. */
function makeLegacyCreature(): CreatureExport {
  return {
    input: 2,
    output: 2,
    neurons: [
      {
        type: "hidden",
        uuid: "331537fe-8a74-4a5e-8268-a725d0fdd70d",
        bias: 0.5,
        squash: "LOGISTIC",
      },
      {
        type: "constant",
        uuid: "const-abc-123",
        bias: 1,
      },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      { type: "output", uuid: "output-1", bias: 0.1, squash: "IDENTITY" },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "331537fe-8a74-4a5e-8268-a725d0fdd70d",
        weight: 0.3,
      },
      {
        fromUUID: "const-abc-123",
        toUUID: "331537fe-8a74-4a5e-8268-a725d0fdd70d",
        weight: 0.2,
      },
      {
        fromUUID: "331537fe-8a74-4a5e-8268-a725d0fdd70d",
        toUUID: "output-0",
        weight: 0.7,
      },
      {
        fromUUID: "input-1",
        toUUID: "output-1",
        weight: 0.4,
      },
    ],
  };
}

/** Helper: creates a creature using only integer IDs (new format). */
function makeIntegerIdCreature(): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", id: 1_000_042, bias: 0.5, squash: "LOGISTIC" },
      { type: "output", id: -1, bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromId: 0, toId: 1_000_042, weight: 0.3 },
      { fromId: 1_000_042, toId: -1, weight: 0.7 },
    ],
  };
}

Deno.test("exportJSON - neuron includes uuid field", () => {
  const json = makeLegacyCreature();
  const creature = Creature.fromJSON(json);
  const exported = exportSnapshotJSON(creature);

  for (const neuron of exported.neurons) {
    assertEquals(
      typeof neuron.uuid,
      "string",
      `Neuron of type '${neuron.type}' must have a uuid string field`,
    );
    assertEquals(
      neuron.id,
      undefined,
      `Neuron export must not include internal id (type '${neuron.type}')`,
    );
  }
});

Deno.test("exportJSON - output neuron uuid follows 'output-N' format", () => {
  const json = makeLegacyCreature();
  const creature = Creature.fromJSON(json);
  const exported = creature.exportJSON();

  const outputNeurons = exported.neurons.filter((n) => n.type === "output");
  for (let i = 0; i < outputNeurons.length; i++) {
    assertEquals(
      outputNeurons[i].uuid,
      `output-${i}`,
      `Output neuron ${i} should have uuid 'output-${i}'`,
    );
  }
});

Deno.test("exportJSON - synapse includes fromUUID and toUUID fields", () => {
  const json = makeLegacyCreature();
  const creature = Creature.fromJSON(json);
  const exported = exportSnapshotJSON(creature);

  for (const synapse of exported.synapses) {
    assertEquals(
      typeof synapse.fromUUID,
      "string",
      "Synapse must have a fromUUID string field",
    );
    assertEquals(
      typeof synapse.toUUID,
      "string",
      "Synapse must have a toUUID string field",
    );
    assertEquals(synapse.fromId, undefined);
    assertEquals(synapse.toId, undefined);
  }
});

Deno.test("exportJSON - input neuron references use 'input-N' format in synapse UUIDs", () => {
  const json = makeLegacyCreature();
  const creature = Creature.fromJSON(json);
  const exported = creature.exportJSON();

  const inputSynapses = exported.synapses.filter((s) =>
    s.fromUUID?.startsWith("input-")
  );

  for (const synapse of inputSynapses) {
    const m = /^input-(\d+)$/.exec(synapse.fromUUID!);
    assertEquals(m !== null, true);
    const idx = Number(m![1]);
    assertEquals(idx >= 0 && idx < json.input, true);
  }
});

Deno.test("exportJSON - hidden/constant neuron UUIDs are deterministic", () => {
  const json = makeIntegerIdCreature();

  const creature1 = Creature.fromJSON(json);
  const exported1 = creature1.exportJSON();

  const creature2 = Creature.fromJSON(json);
  const exported2 = creature2.exportJSON();

  // Same input should produce same UUIDs
  for (let i = 0; i < exported1.neurons.length; i++) {
    assertEquals(
      exported1.neurons[i].uuid,
      exported2.neurons[i].uuid,
      `Neuron ${i} uuid should be deterministic`,
    );
  }

  for (let i = 0; i < exported1.synapses.length; i++) {
    assertEquals(
      exported1.synapses[i].fromUUID,
      exported2.synapses[i].fromUUID,
      `Synapse ${i} fromUUID should be deterministic`,
    );
    assertEquals(
      exported1.synapses[i].toUUID,
      exported2.synapses[i].toUUID,
      `Synapse ${i} toUUID should be deterministic`,
    );
  }
});

Deno.test("exportJSON - legacy UUID strings are preserved through import/export", () => {
  const originalJson = makeLegacyCreature();
  const creature = Creature.fromJSON(originalJson);
  const exported = creature.exportJSON();

  // The hidden neuron's original UUID should be preserved
  const hiddenNeuron = exported.neurons.find((n) => n.type === "hidden");
  assertEquals(
    hiddenNeuron?.uuid,
    "331537fe-8a74-4a5e-8268-a725d0fdd70d",
    "Legacy hidden neuron UUID should be preserved",
  );

  // The constant neuron's original UUID should be preserved
  const constNeuron = exported.neurons.find((n) => n.type === "constant");
  assertEquals(
    constNeuron?.uuid,
    "const-abc-123",
    "Legacy constant neuron UUID should be preserved",
  );

  // Output neurons should always use output-N format
  const outputNeurons = exported.neurons.filter((n) => n.type === "output");
  assertEquals(outputNeurons[0]?.uuid, "output-0");
  assertEquals(outputNeurons[1]?.uuid, "output-1");
});

Deno.test("exportJSON - synapse UUIDs reference correct neuron UUIDs", () => {
  const originalJson = makeLegacyCreature();
  const creature = Creature.fromJSON(originalJson);
  const exported = creature.exportJSON();

  // Build a set of all valid neuron UUIDs (including input neuron UUIDs)
  const validUuids = new Set<string>();
  for (let i = 0; i < originalJson.input; i++) {
    validUuids.add(`input-${i}`);
  }
  for (const neuron of exported.neurons) {
    if (neuron.uuid) validUuids.add(neuron.uuid);
  }

  // Every synapse fromUUID and toUUID should reference a valid neuron UUID
  for (const synapse of exported.synapses) {
    assertEquals(
      validUuids.has(synapse.fromUUID!),
      true,
      `Synapse fromUUID '${synapse.fromUUID}' should reference a valid neuron`,
    );
    assertEquals(
      validUuids.has(synapse.toUUID!),
      true,
      `Synapse toUUID '${synapse.toUUID}' should reference a valid neuron`,
    );
  }
});

Deno.test("exportJSON - new creature (integer IDs only) generates deterministic UUIDs", () => {
  const json = makeIntegerIdCreature();
  const creature = Creature.fromJSON(json);
  const exported = creature.exportJSON();

  const hiddenNeuron = exported.neurons.find((n) => n.type === "hidden");
  assertEquals(typeof hiddenNeuron?.uuid, "string");
  assertEquals(
    hiddenNeuron?.uuid,
    "legacy-neuron-1000042",
    "Id-only legacy snapshots use stable legacy-neuron-{id} labels",
  );

  const outputNeuron = exported.neurons.find((n) => n.type === "output");
  assertEquals(outputNeuron?.uuid, "output-0");
});

Deno.test("exportJSON - shallowClone preserves hidden and constant uuids", () => {
  const creature = Creature.fromJSON(makeLegacyCreature());
  const clone = creature.shallowClone();
  const u0 = creature.neurons.filter((n) =>
    n.type === "hidden" || n.type === "constant"
  )
    .map((n) => n.uuid);
  const u1 = clone.neurons.filter((n) =>
    n.type === "hidden" || n.type === "constant"
  )
    .map((n) => n.uuid);
  assertEquals(u1, u0);
});

/**
 * Issue #2055 (#2050): `neuronUuid()` briefly fell back to `neuron-${neuron.id}`,
 * which tracked the volatile runtime id and broke stable identity across generations.
 */
const SYNTHETIC_NEURON_ID_UUID = /^neuron-\d+$/;

Deno.test(
  "exportJSON - regression #2050: never synthesise hidden/constant uuid from runtime id",
  () => {
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const exported = creature.exportJSON();
    for (const n of exported.neurons) {
      if (n.type === "hidden" || n.type === "constant") {
        assertEquals(
          SYNTHETIC_NEURON_ID_UUID.test(n.uuid ?? ""),
          false,
          `Hidden/constant wire uuid must not be neuron-{id} (got '${n.uuid}')`,
        );
      }
    }
  },
);

Deno.test("exportJSON - round-trip preserves uuid through re-export", () => {
  const originalJson = makeLegacyCreature();
  const creature1 = Creature.fromJSON(originalJson);
  const exported1 = creature1.exportJSON();

  // Re-import and re-export
  const creature2 = Creature.fromJSON(exported1);
  const exported2 = creature2.exportJSON();

  // All neuron UUIDs should match
  for (let i = 0; i < exported1.neurons.length; i++) {
    assertEquals(
      exported1.neurons[i].uuid,
      exported2.neurons[i].uuid,
      `Neuron ${i} uuid should survive round-trip`,
    );
  }

  // All synapse UUIDs should match
  for (let i = 0; i < exported1.synapses.length; i++) {
    assertEquals(
      exported1.synapses[i].fromUUID,
      exported2.synapses[i].fromUUID,
      `Synapse ${i} fromUUID should survive round-trip`,
    );
    assertEquals(
      exported1.synapses[i].toUUID,
      exported2.synapses[i].toUUID,
      `Synapse ${i} toUUID should survive round-trip`,
    );
  }
});
