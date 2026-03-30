/**
 * ExportNoIntegerIds.ts - Verifies that exportJSON() does NOT include
 * internal integer IDs in its output.
 *
 * Issue #2054: CreatureExport JSON (the external format) must not expose
 * runtime integer neuron/synapse IDs. These are internal implementation
 * details that can change between generations and are not stable across
 * machines. External consumers should use UUID fields only.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Creature with hidden, constant, and output neurons. */
function makeTestCreature(): CreatureExport {
  return {
    input: 2,
    output: 2,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-alpha",
        bias: 0.3,
        squash: "LOGISTIC",
      },
      {
        type: "constant",
        uuid: "const-beta",
        bias: 1.0,
      },
      { type: "output", uuid: "output-0", bias: 0.1, squash: "IDENTITY" },
      { type: "output", uuid: "output-1", bias: -0.2, squash: "TANH" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-alpha", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-alpha", weight: -0.3 },
      { fromUUID: "const-beta", toUUID: "hidden-alpha", weight: 0.2 },
      { fromUUID: "hidden-alpha", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "hidden-alpha", toUUID: "output-1", weight: 0.4 },
    ],
  };
}

// ---------------------------------------------------------------------------
// exportJSON must NOT include integer IDs
// ---------------------------------------------------------------------------

Deno.test(
  "exportJSON neurons must NOT have integer id field (Issue #2054)",
  () => {
    const creature = Creature.fromJSON(makeTestCreature());
    const exported = creature.exportJSON();

    for (const neuron of exported.neurons) {
      assertEquals(
        neuron.id,
        undefined,
        `exportJSON must not include integer id on neuron '${neuron.uuid}' (Issue #2054)`,
      );
    }
  },
);

Deno.test(
  "exportJSON synapses must NOT have fromId/toId fields (Issue #2054)",
  () => {
    const creature = Creature.fromJSON(makeTestCreature());
    const exported = creature.exportJSON();

    for (const synapse of exported.synapses) {
      assertEquals(
        synapse.fromId,
        undefined,
        `exportJSON must not include fromId on synapse '${synapse.fromUUID}->${synapse.toUUID}' (Issue #2054)`,
      );
      assertEquals(
        synapse.toId,
        undefined,
        `exportJSON must not include toId on synapse '${synapse.fromUUID}->${synapse.toUUID}' (Issue #2054)`,
      );
    }
  },
);

Deno.test(
  "exportJSON neurons must still include uuid, type, and bias fields",
  () => {
    const creature = Creature.fromJSON(makeTestCreature());
    const exported = creature.exportJSON();

    for (const neuron of exported.neurons) {
      assertEquals(
        typeof neuron.uuid,
        "string",
        `Neuron must have uuid string field`,
      );
      assert(
        ["hidden", "output", "constant"].includes(neuron.type),
        `Neuron must have valid type`,
      );
      assertEquals(
        typeof neuron.bias,
        "number",
        `Neuron must have bias number field`,
      );
    }
  },
);

Deno.test(
  "exportJSON synapses must still include fromUUID, toUUID, and weight fields",
  () => {
    const creature = Creature.fromJSON(makeTestCreature());
    const exported = creature.exportJSON();

    for (const synapse of exported.synapses) {
      assertEquals(
        typeof synapse.fromUUID,
        "string",
        `Synapse must have fromUUID`,
      );
      assertEquals(
        typeof synapse.toUUID,
        "string",
        `Synapse must have toUUID`,
      );
      assertEquals(
        typeof synapse.weight,
        "number",
        `Synapse must have weight`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// exportSnapshotJSON must also NOT include integer IDs (same as exportJSON)
// ---------------------------------------------------------------------------

Deno.test(
  "exportSnapshotJSON must not include integer IDs (same contract as exportJSON)",
  () => {
    const creature = Creature.fromJSON(makeTestCreature());
    const snapshot = creature.exportSnapshotJSON();

    for (const neuron of snapshot.neurons) {
      assertEquals(
        neuron.id,
        undefined,
        `exportSnapshotJSON must not include integer id on neuron`,
      );
    }
    for (const synapse of snapshot.synapses) {
      assertEquals(
        synapse.fromId,
        undefined,
        `exportSnapshotJSON must not include fromId`,
      );
      assertEquals(
        synapse.toId,
        undefined,
        `exportSnapshotJSON must not include toId`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Round-trip: exportJSON → fromJSON → exportJSON preserves UUID fields
// ---------------------------------------------------------------------------

Deno.test(
  "exportJSON round-trip preserves UUID-based fields without integer IDs",
  () => {
    const creature1 = Creature.fromJSON(makeTestCreature());
    const exported1 = creature1.exportJSON();

    const creature2 = Creature.fromJSON(exported1);
    const exported2 = creature2.exportJSON();

    // Neuron UUIDs and data must survive round-trip
    assertEquals(exported1.neurons.length, exported2.neurons.length);
    for (let i = 0; i < exported1.neurons.length; i++) {
      assertEquals(exported1.neurons[i].uuid, exported2.neurons[i].uuid);
      assertEquals(exported1.neurons[i].type, exported2.neurons[i].type);
      assertEquals(exported1.neurons[i].bias, exported2.neurons[i].bias);
      assertEquals(exported1.neurons[i].squash, exported2.neurons[i].squash);
      // Must NOT have id after round-trip
      assertEquals(exported2.neurons[i].id, undefined);
    }

    // Synapse UUIDs and weights must survive round-trip
    assertEquals(exported1.synapses.length, exported2.synapses.length);
    for (let i = 0; i < exported1.synapses.length; i++) {
      assertEquals(
        exported1.synapses[i].fromUUID,
        exported2.synapses[i].fromUUID,
      );
      assertEquals(exported1.synapses[i].toUUID, exported2.synapses[i].toUUID);
      assertEquals(exported1.synapses[i].weight, exported2.synapses[i].weight);
      // Must NOT have fromId/toId after round-trip
      assertEquals(exported2.synapses[i].fromId, undefined);
      assertEquals(exported2.synapses[i].toId, undefined);
    }
  },
);

// ---------------------------------------------------------------------------
// Programmatically constructed creature also omits IDs
// ---------------------------------------------------------------------------

Deno.test(
  "Programmatically constructed creature exportJSON omits integer IDs",
  () => {
    const creature = new Creature(3, 2, {
      layers: [{ count: 4, squash: "LOGISTIC" }],
    });
    const exported = creature.exportJSON();

    for (const neuron of exported.neurons) {
      assertEquals(
        neuron.id,
        undefined,
        `Programmatic creature exportJSON must not include integer id`,
      );
    }
    for (const synapse of exported.synapses) {
      assertEquals(synapse.fromId, undefined);
      assertEquals(synapse.toId, undefined);
    }
  },
);
