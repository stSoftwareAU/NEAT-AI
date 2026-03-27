/**
 * ExportSchemaValidation.ts - Validates exportJSON() output against
 * docs/snapshot-schema.json for various creature configurations.
 *
 * Issue #2052: Ensures the JSON schema contract is enforced programmatically
 * so that any future change to exportJSON output that breaks the schema is
 * caught immediately by the test suite.
 */

import { assert, assertEquals } from "@std/assert";
// deno-lint-ignore no-explicit-any
const Ajv2020 = (await import("ajv/2020")).default as any;
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";

/** Load and compile the snapshot schema once. */
const schemaText = await Deno.readTextFile(
  new URL("../../docs/snapshot-schema.json", import.meta.url),
);
const schema = JSON.parse(schemaText);
// deno-lint-ignore no-explicit-any
const ajv = new (Ajv2020 as any)({ strict: false });
// deno-lint-ignore no-explicit-any
const validate = (ajv as any).compile(schema);

/**
 * Validates a CreatureExport against the JSON schema and asserts structural
 * invariants: uuid on every neuron, fromUUID/toUUID on every synapse.
 */
function assertSchemaValid(
  exported: CreatureExport,
  label: string,
): void {
  // --- JSON Schema validation ---
  const valid = validate(exported);
  assert(
    valid,
    `${label}: exportJSON output does not match snapshot-schema.json — ${
      JSON.stringify(validate.errors, null, 2)
    }`,
  );

  // --- uuid field on every neuron ---
  for (const neuron of exported.neurons) {
    assertEquals(
      typeof neuron.uuid,
      "string",
      `${label}: neuron of type '${neuron.type}' is missing uuid`,
    );
    assert(
      neuron.uuid!.length > 0,
      `${label}: neuron uuid must not be empty`,
    );
  }

  // --- uuid pattern checks ---
  const outputNeurons = exported.neurons.filter((n) => n.type === "output");
  for (let i = 0; i < outputNeurons.length; i++) {
    assertEquals(
      outputNeurons[i].uuid,
      `output-${i}`,
      `${label}: output neuron ${i} should have uuid 'output-${i}'`,
    );
  }

  // --- fromUUID/toUUID on every synapse ---
  for (const synapse of exported.synapses) {
    assertEquals(
      typeof synapse.fromUUID,
      "string",
      `${label}: synapse is missing fromUUID`,
    );
    assertEquals(
      typeof synapse.toUUID,
      "string",
      `${label}: synapse is missing toUUID`,
    );
  }

  // --- synapse UUIDs reference valid neurons ---
  const validUuids = new Set<string>();
  for (let i = 0; i < exported.input; i++) {
    validUuids.add(`input-${i}`);
  }
  for (const neuron of exported.neurons) {
    if (neuron.uuid) validUuids.add(neuron.uuid);
  }
  for (const synapse of exported.synapses) {
    assert(
      validUuids.has(synapse.fromUUID!),
      `${label}: synapse fromUUID '${synapse.fromUUID}' is not a valid neuron`,
    );
    assert(
      validUuids.has(synapse.toUUID!),
      `${label}: synapse toUUID '${synapse.toUUID}' is not a valid neuron`,
    );
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal creature: 1 input, 1 output, 1 synapse. */
function makeMinimalCreature(): CreatureExport {
  return {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
  };
}

/** Creature with hidden layers. */
function makeHiddenLayerCreature(): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-a",
        bias: 0.1,
        squash: "LOGISTIC",
      },
      {
        type: "hidden",
        uuid: "hidden-b",
        bias: -0.2,
        squash: "TANH",
      },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: -0.3 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 0.4 },
    ],
  };
}

/** Creature with constant neurons. */
function makeConstantCreature(): CreatureExport {
  return {
    input: 1,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-bias-1", bias: 1.0 },
      {
        type: "hidden",
        uuid: "hidden-c",
        bias: 0,
        squash: "LOGISTIC",
      },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-c", weight: 0.6 },
      { fromUUID: "const-bias-1", toUUID: "hidden-c", weight: 0.3 },
      { fromUUID: "hidden-c", toUUID: "output-0", weight: 1.0 },
    ],
  };
}

/** Legacy UUID-format creature (verify UUID preservation). */
function makeLegacyUuidCreature(): CreatureExport {
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

/** Creature with memetic data. */
function makeMemeticCreature(): CreatureExport {
  return {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0.1, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
    memetic: {
      generation: 5,
      score: -0.02,
      weights: {
        0: [{ toId: -1, weight: 0.5 }],
      },
      biases: {
        [-1]: 0.1,
      },
    },
  };
}

/** Creature with forwardOnly flag. */
function makeForwardOnlyCreature(): CreatureExport {
  return {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-fwd",
        bias: 0,
        squash: "ReLU6",
      },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-fwd", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-fwd", weight: -0.5 },
      { fromUUID: "hidden-fwd", toUUID: "output-0", weight: 1.0 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test(
  "schema validation - minimal creature",
  () => {
    const creature = Creature.fromJSON(makeMinimalCreature());
    const exported = creature.exportJSON();
    assertSchemaValid(exported, "minimal");
  },
);

Deno.test(
  "schema validation - creature with hidden layers",
  () => {
    const creature = Creature.fromJSON(makeHiddenLayerCreature());
    const exported = creature.exportJSON();
    assertSchemaValid(exported, "hidden layers");
  },
);

Deno.test(
  "schema validation - creature with constant neurons",
  () => {
    const creature = Creature.fromJSON(makeConstantCreature());
    const exported = creature.exportJSON();
    assertSchemaValid(exported, "constant neurons");
  },
);

Deno.test(
  "schema validation - legacy UUID-format creature",
  () => {
    const creature = Creature.fromJSON(makeLegacyUuidCreature());
    const exported = creature.exportJSON();
    assertSchemaValid(exported, "legacy UUID");

    // Verify specific legacy UUIDs are preserved
    const hiddenNeuron = exported.neurons.find((n) => n.type === "hidden");
    assertEquals(
      hiddenNeuron?.uuid,
      "331537fe-8a74-4a5e-8268-a725d0fdd70d",
      "Legacy hidden neuron UUID should be preserved",
    );
  },
);

Deno.test(
  "schema validation - creature with memetic data",
  () => {
    const creature = Creature.fromJSON(makeMemeticCreature());
    const exported = creature.exportJSON();
    assertSchemaValid(exported, "memetic");
  },
);

Deno.test(
  "schema validation - forward-only creature",
  () => {
    const creature = Creature.fromJSON(makeForwardOnlyCreature());
    const exported = creature.exportJSON();
    assertSchemaValid(exported, "forward-only");
    assertEquals(
      exported.forwardOnly,
      true,
      "forwardOnly flag should be preserved",
    );
  },
);

Deno.test(
  "schema validation - programmatically constructed creature",
  () => {
    const creature = new Creature(3, 2, {
      layers: [{ count: 4, squash: "LOGISTIC" }],
    });
    const exported = creature.exportJSON();
    assertSchemaValid(exported, "programmatic");
  },
);

Deno.test(
  "schema validation - round-trip fidelity",
  () => {
    const fixtures = [
      { name: "minimal", json: makeMinimalCreature() },
      { name: "hidden layers", json: makeHiddenLayerCreature() },
      { name: "constant", json: makeConstantCreature() },
      { name: "legacy UUID", json: makeLegacyUuidCreature() },
      { name: "forward-only", json: makeForwardOnlyCreature() },
    ];

    for (const { name, json } of fixtures) {
      const creature1 = Creature.fromJSON(json);
      const exported1 = creature1.exportJSON();

      // Re-import and re-export
      const creature2 = Creature.fromJSON(exported1);
      const exported2 = creature2.exportJSON();

      // Both exports must pass schema validation
      assertSchemaValid(exported1, `${name} first export`);
      assertSchemaValid(exported2, `${name} round-trip export`);

      // Neuron UUIDs must match
      assertEquals(
        exported1.neurons.length,
        exported2.neurons.length,
        `${name}: neuron count should match after round-trip`,
      );
      for (let i = 0; i < exported1.neurons.length; i++) {
        assertEquals(
          exported1.neurons[i].uuid,
          exported2.neurons[i].uuid,
          `${name}: neuron ${i} uuid should survive round-trip`,
        );
        assertEquals(
          exported1.neurons[i].bias,
          exported2.neurons[i].bias,
          `${name}: neuron ${i} bias should survive round-trip`,
        );
      }

      // Synapse UUIDs and weights must match
      assertEquals(
        exported1.synapses.length,
        exported2.synapses.length,
        `${name}: synapse count should match after round-trip`,
      );
      for (let i = 0; i < exported1.synapses.length; i++) {
        assertEquals(
          exported1.synapses[i].fromUUID,
          exported2.synapses[i].fromUUID,
          `${name}: synapse ${i} fromUUID should survive round-trip`,
        );
        assertEquals(
          exported1.synapses[i].toUUID,
          exported2.synapses[i].toUUID,
          `${name}: synapse ${i} toUUID should survive round-trip`,
        );
        assertEquals(
          exported1.synapses[i].weight,
          exported2.synapses[i].weight,
          `${name}: synapse ${i} weight should survive round-trip`,
        );
      }
    }
  },
);
