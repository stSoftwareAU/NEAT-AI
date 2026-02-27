import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { validateCreatureExport } from "../../src/utils/validateCreatureExport.ts";

Deno.test("snapshot schema validates XOR model", async () => {
  const json = JSON.parse(
    await Deno.readTextFile("docs/models/XOR.json"),
  );
  const errors = validateCreatureExport(json);
  assertEquals(errors, [], `XOR.json should be valid: ${errors.join(", ")}`);
});

Deno.test("snapshot schema validates NARX model", async () => {
  const json = JSON.parse(
    await Deno.readTextFile("docs/models/NARX.json"),
  );
  const errors = validateCreatureExport(json);
  assertEquals(errors, [], `NARX.json should be valid: ${errors.join(", ")}`);
});

Deno.test("snapshot schema validates SHIFT model", async () => {
  const json = JSON.parse(
    await Deno.readTextFile("docs/models/SHIFT.json"),
  );
  const errors = validateCreatureExport(json);
  assertEquals(errors, [], `SHIFT.json should be valid: ${errors.join(", ")}`);
});

Deno.test("snapshot schema validates large model", async () => {
  const json = JSON.parse(
    await Deno.readTextFile("docs/models/large.json"),
  );
  const errors = validateCreatureExport(json);
  assertEquals(errors, [], `large.json should be valid: ${errors.join(", ")}`);
});

Deno.test("snapshot schema validates creature exportJSON output", () => {
  const creature = new Creature(2, 1);
  const exported = creature.exportJSON();
  const errors = validateCreatureExport(exported);
  assertEquals(
    errors,
    [],
    `exportJSON output should be valid: ${errors.join(", ")}`,
  );
});

Deno.test("snapshot schema rejects missing required fields", () => {
  const invalid = { neurons: [], synapses: [] };
  const errors = validateCreatureExport(invalid);
  assert(errors.length > 0, "Should report missing required fields");
});

Deno.test("snapshot schema rejects invalid neuron type", () => {
  const invalid = {
    neurons: [{ type: "banana", uuid: "test", bias: 0 }],
    synapses: [],
    input: 1,
    output: 1,
  };
  const errors = validateCreatureExport(invalid);
  assert(errors.length > 0, "Should report invalid neuron type");
});

Deno.test("snapshot schema rejects invalid synapse type", () => {
  const invalid = {
    neurons: [{ type: "output", uuid: "output-0", bias: 0 }],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1, type: "invalid" },
    ],
    input: 1,
    output: 1,
  };
  const errors = validateCreatureExport(invalid);
  assert(errors.length > 0, "Should report invalid synapse type");
});

Deno.test("snapshot schema rejects non-string tag value", () => {
  const invalid = {
    neurons: [{ type: "output", uuid: "output-0", bias: 0 }],
    synapses: [],
    input: 1,
    output: 1,
    tags: [{ name: "error", value: 42 }],
  };
  const errors = validateCreatureExport(invalid);
  assert(errors.length > 0, "Should report non-string tag value");
});
