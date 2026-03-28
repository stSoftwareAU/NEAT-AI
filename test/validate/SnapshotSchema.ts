/**
 * SnapshotSchema.ts - Tests that docs/snapshot-schema.json validates both
 * legacy UUID-only exports and new dual-format (UUID + integer ID) exports.
 *
 * Issue #2051: Update snapshot-schema.json to support both UUID and integer
 * ID formats, including frozen fields, hyperparameters, and memetic ID keys.
 */

import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { exportSnapshotJSON } from "../../src/creature/CreatureSerialization.ts";

// deno-lint-ignore no-explicit-any
type SchemaObject = Record<string, any>;

/** Load and parse the snapshot schema. */
async function loadSchema(): Promise<SchemaObject> {
  const text = await Deno.readTextFile("docs/snapshot-schema.json");
  return JSON.parse(text);
}

/** Recursively resolve a $ref within the schema's $defs. */
function resolveRef(schema: SchemaObject, ref: string): SchemaObject {
  const defName = ref.replace("#/$defs/", "");
  return schema.$defs[defName];
}

// ──────────────────────────────────────────────────────────────────────────
// Schema structural tests
// ──────────────────────────────────────────────────────────────────────────

Deno.test("schema - is valid JSON Schema draft 2020-12", async () => {
  const schema = await loadSchema();
  assertEquals(
    schema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
    "Schema must reference draft 2020-12",
  );
  assertEquals(schema.type, "object");
  assert(schema.$defs, "Schema must have $defs");
});

Deno.test("schema - neuron definition includes optional id field", async () => {
  const schema = await loadSchema();
  const neuron = resolveRef(schema, "#/$defs/neuron");
  assert(neuron.properties.id, "Neuron must have an 'id' property");
  assertEquals(neuron.properties.id.type, "integer");
  // id should be optional (not in required)
  assert(
    !neuron.required.includes("id"),
    "Neuron 'id' must be optional (not required)",
  );
});

Deno.test("schema - neuron definition includes optional frozen field", async () => {
  const schema = await loadSchema();
  const neuron = resolveRef(schema, "#/$defs/neuron");
  assert(neuron.properties.frozen, "Neuron must have a 'frozen' property");
  assertEquals(neuron.properties.frozen.type, "boolean");
  assert(
    !neuron.required.includes("frozen"),
    "Neuron 'frozen' must be optional",
  );
});

Deno.test("schema - synapse definition includes optional fromId and toId", async () => {
  const schema = await loadSchema();
  const synapse = resolveRef(schema, "#/$defs/synapse");
  assert(synapse.properties.fromId, "Synapse must have 'fromId' property");
  assertEquals(synapse.properties.fromId.type, "integer");
  assert(synapse.properties.toId, "Synapse must have 'toId' property");
  assertEquals(synapse.properties.toId.type, "integer");
  assert(
    !synapse.required.includes("fromId"),
    "Synapse 'fromId' must be optional",
  );
  assert(
    !synapse.required.includes("toId"),
    "Synapse 'toId' must be optional",
  );
});

Deno.test("schema - synapse definition includes optional frozen field", async () => {
  const schema = await loadSchema();
  const synapse = resolveRef(schema, "#/$defs/synapse");
  assert(synapse.properties.frozen, "Synapse must have a 'frozen' property");
  assertEquals(synapse.properties.frozen.type, "boolean");
  assert(
    !synapse.required.includes("frozen"),
    "Synapse 'frozen' must be optional",
  );
});

Deno.test("schema - memeticWeight includes optional toId field", async () => {
  const schema = await loadSchema();
  const mw = resolveRef(schema, "#/$defs/memeticWeight");
  assert(mw.properties.toId, "memeticWeight must have 'toId' property");
  assertEquals(mw.properties.toId.type, "integer");
});

Deno.test("schema - top-level includes optional hyperparameters", async () => {
  const schema = await loadSchema();
  assert(
    schema.properties.hyperparameters,
    "Top-level must have 'hyperparameters' property",
  );
  // Resolve $ref if present, otherwise use inline definition
  const hpProp = schema.properties.hyperparameters;
  const hp = hpProp.$ref ? resolveRef(schema, hpProp.$ref) : hpProp;
  // It should be an object with numeric properties
  assertEquals(hp.type, "object");
  assert(hp.properties.learningRate, "Must include learningRate");
  assert(hp.properties.addNeuronRate, "Must include addNeuronRate");
  assert(hp.properties.addConnectionRate, "Must include addConnectionRate");
  assert(
    hp.properties.weightPerturbationScale,
    "Must include weightPerturbationScale",
  );
  assert(
    hp.properties.l1RegularisationStrength,
    "Must include l1RegularisationStrength",
  );
  assert(
    hp.properties.l2RegularisationStrength,
    "Must include l2RegularisationStrength",
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Functional validation: real exports match schema expectations
// ──────────────────────────────────────────────────────────────────────────

/** Creates a legacy UUID-only creature export. */
function makeLegacyExport(): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "331537fe-8a74-4a5e-8268-a725d0fdd70d",
        bias: 0.5,
        squash: "LOGISTIC",
      },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "331537fe-8a74-4a5e-8268-a725d0fdd70d",
        weight: 0.3,
      },
      {
        fromUUID: "331537fe-8a74-4a5e-8268-a725d0fdd70d",
        toUUID: "output-0",
        weight: 0.7,
      },
    ],
  };
}

/** Helper: check a JSON object against a schema definition's declared properties. */
function checkFieldsAllowed(
  obj: Record<string, unknown>,
  schemaDef: SchemaObject,
  label: string,
): void {
  const allowedKeys = new Set(Object.keys(schemaDef.properties));
  for (const key of Object.keys(obj)) {
    assert(
      allowedKeys.has(key),
      `${label}: field '${key}' not declared in schema properties`,
    );
  }
}

/** Helper: check required fields are present. */
function checkRequiredFields(
  obj: Record<string, unknown>,
  schemaDef: SchemaObject,
  label: string,
): void {
  for (const req of schemaDef.required ?? []) {
    assert(
      obj[req] !== undefined,
      `${label}: required field '${req}' is missing`,
    );
  }
}

Deno.test("schema - legacy UUID-only export fields match schema", async () => {
  const schema = await loadSchema();
  const legacy = makeLegacyExport();

  // Top-level
  const legacyObj = legacy as unknown as Record<string, unknown>;
  checkRequiredFields(legacyObj, schema, "legacy top-level");
  checkFieldsAllowed(legacyObj, schema, "legacy top-level");

  // Neurons
  const neuronDef = resolveRef(schema, "#/$defs/neuron");
  for (const n of legacy.neurons) {
    checkRequiredFields(
      n as unknown as Record<string, unknown>,
      neuronDef,
      `legacy neuron ${n.uuid}`,
    );
    checkFieldsAllowed(
      n as unknown as Record<string, unknown>,
      neuronDef,
      `legacy neuron ${n.uuid}`,
    );
  }

  // Synapses
  const synapseDef = resolveRef(schema, "#/$defs/synapse");
  for (const s of legacy.synapses) {
    checkRequiredFields(
      s as unknown as Record<string, unknown>,
      synapseDef,
      "legacy synapse",
    );
    checkFieldsAllowed(
      s as unknown as Record<string, unknown>,
      synapseDef,
      "legacy synapse",
    );
  }
});

Deno.test("schema - new dual-format export fields match schema", async () => {
  const schema = await loadSchema();
  const legacy = makeLegacyExport();
  const creature = Creature.fromJSON(legacy);
  const exported = exportSnapshotJSON(creature);

  // Public export: stable uuid endpoints only; integer ids are internal.
  const neuronDef = resolveRef(schema, "#/$defs/neuron");
  for (const n of exported.neurons) {
    const nObj = n as unknown as Record<string, unknown>;
    checkFieldsAllowed(nObj, neuronDef, `exported neuron ${n.uuid}`);
    assert(nObj.uuid !== undefined, "Exported neuron must have uuid");
    assert(
      nObj.id === undefined,
      "Exported neuron must not include internal id",
    );
  }

  const synapseDef = resolveRef(schema, "#/$defs/synapse");
  for (const s of exported.synapses) {
    const sObj = s as unknown as Record<string, unknown>;
    checkFieldsAllowed(sObj, synapseDef, "exported synapse");
    assert(sObj.fromUUID !== undefined, "Exported synapse must have fromUUID");
    assert(sObj.toUUID !== undefined, "Exported synapse must have toUUID");
    assert(
      sObj.fromId === undefined,
      "Exported synapse must not include fromId",
    );
    assert(sObj.toId === undefined, "Exported synapse must not include toId");
  }
});

Deno.test("schema - frozen neuron export fields match schema", async () => {
  const schema = await loadSchema();
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "frozen-neuron-1",
        bias: 0.5,
        squash: "LOGISTIC",
        frozen: true,
      },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "frozen-neuron-1", weight: 0.3 },
      {
        fromUUID: "frozen-neuron-1",
        toUUID: "output-0",
        weight: 0.7,
        frozen: true,
      },
    ],
  };

  const creature = Creature.fromJSON(json);
  const exported = creature.exportInternalJSON();

  const neuronDef = resolveRef(schema, "#/$defs/neuron");
  for (const n of exported.neurons) {
    checkFieldsAllowed(
      n as unknown as Record<string, unknown>,
      neuronDef,
      `frozen neuron ${n.uuid}`,
    );
  }

  const synapseDef = resolveRef(schema, "#/$defs/synapse");
  for (const s of exported.synapses) {
    checkFieldsAllowed(
      s as unknown as Record<string, unknown>,
      synapseDef,
      "frozen synapse",
    );
  }
});

Deno.test("schema - export with hyperparameters matches schema", async () => {
  const schema = await loadSchema();
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
  };

  const creature = Creature.fromJSON(json);
  // deno-lint-ignore no-explicit-any
  (creature as any).hyperparameters = {
    learningRate: 0.01,
    addNeuronRate: 0.1,
    addConnectionRate: 0.2,
    weightPerturbationScale: 1.0,
    l1RegularisationStrength: 0,
    l2RegularisationStrength: 0,
  };

  const exported = creature.exportInternalJSON();
  checkFieldsAllowed(
    exported as unknown as Record<string, unknown>,
    schema,
    "hyperparameters export top-level",
  );
  assert(
    // deno-lint-ignore no-explicit-any
    (exported as any).hyperparameters !== undefined,
    "Exported creature must include hyperparameters when set",
  );
});

Deno.test("schema - memetic export with toId fields match schema", async () => {
  const schema = await loadSchema();
  const memeticWeightDef = resolveRef(schema, "#/$defs/memeticWeight");

  // Verify the memeticWeight definition allows toId
  assert(
    memeticWeightDef.properties.toId,
    "memeticWeight schema must allow toId",
  );

  // A new-format memetic weight entry with toId should be allowed
  const newFormatWeight = { toId: 42, weight: 0.5 };
  checkFieldsAllowed(
    newFormatWeight,
    memeticWeightDef,
    "new-format memetic weight",
  );

  // A legacy memetic weight entry with toUUID should still be allowed
  const legacyWeight = { toUUID: "some-uuid-string", weight: 0.5 };
  checkFieldsAllowed(legacyWeight, memeticWeightDef, "legacy memetic weight");
});
