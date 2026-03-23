import { assert, assertEquals, assertThrows } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import {
  exportJSON,
  fromJSON,
  internalJSON,
} from "../../src/neuron/NeuronSerialization.ts";
import { TopologyError } from "../../src/errors/TopologyError.ts";

/** Helper: creates a simple creature for testing neuron serialisation. */
function makeTestCreature(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-1", bias: 1 },
      { type: "hidden", uuid: "hidden-1", squash: "LOGISTIC", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "const-1", toUUID: "hidden-1", weight: 0.2 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
  };
  return Creature.fromJSON(json);
}

Deno.test("exportJSON - hidden neuron includes squash", () => {
  const creature = makeTestCreature();
  const hiddenNeuron = creature.neurons.find((n) => n.type === "hidden")!;
  const json = exportJSON(hiddenNeuron);

  assertEquals(json.type, "hidden");
  assertEquals(typeof json.id, "number");
  assertEquals(json.squash, "LOGISTIC");
  assertEquals(json.bias, 0.5);
});

Deno.test("exportJSON - constant neuron excludes squash", () => {
  const creature = makeTestCreature();
  const constNeuron = creature.neurons.find((n) => n.type === "constant")!;
  const json = exportJSON(constNeuron);

  assertEquals(json.type, "constant");
  assertEquals(typeof json.id, "number");
  assertEquals(json.bias, 1);
  assertEquals(json.squash, undefined);
});

Deno.test("exportJSON - output neuron includes squash", () => {
  const creature = makeTestCreature();
  const outputNeuron = creature.neurons.find((n) => n.type === "output")!;
  const json = exportJSON(outputNeuron);

  assertEquals(json.type, "output");
  assertEquals(
    outputNeuron.id < 0,
    true,
    "Output neuron should have negative ID",
  );
  assertEquals(json.squash, "IDENTITY");
  assertEquals(json.bias, 0);
});

Deno.test("exportJSON - throws for input neurons", () => {
  const creature = makeTestCreature();
  const inputNeuron = creature.neurons[0]; // First neuron is input

  assertThrows(
    () => exportJSON(inputNeuron),
    TopologyError,
    "input",
  );
});

Deno.test("exportJSON - preserves tags", () => {
  const creature = makeTestCreature();
  const hiddenNeuron = creature.neurons.find((n) => n.type === "hidden")!;
  addTag(hiddenNeuron, "test-tag", "test-value");
  const json = exportJSON(hiddenNeuron);

  assert(json.tags !== undefined);
  assertEquals(getTag(json, "test-tag"), "test-value");
});

Deno.test("exportJSON - tags are a copy (not shared reference)", () => {
  const creature = makeTestCreature();
  const hiddenNeuron = creature.neurons.find((n) => n.type === "hidden")!;
  addTag(hiddenNeuron, "test-tag", "test-value");
  const json = exportJSON(hiddenNeuron);

  // Modifying exported tags should not affect original
  assert(json.tags !== hiddenNeuron.tags);
});

Deno.test("internalJSON - input neuron has minimal fields", () => {
  const creature = makeTestCreature();
  const inputNeuron = creature.neurons[0]; // input
  const json = internalJSON(inputNeuron, 0);

  assertEquals(json.type, "input");
  assertEquals(json.index, 0);
  assertEquals(json.id, undefined);
  assertEquals(json.bias, undefined);
});

Deno.test("internalJSON - hidden neuron has full fields", () => {
  const creature = makeTestCreature();
  const hiddenNeuron = creature.neurons.find((n) => n.type === "hidden")!;
  const json = internalJSON(hiddenNeuron, 3);

  assertEquals(json.type, "hidden");
  assertEquals(json.index, 3);
  assertEquals(typeof json.id, "number");
  assertEquals(json.squash, "LOGISTIC");
  assertEquals(json.bias, 0.5);
});

Deno.test("internalJSON - constant neuron excludes squash", () => {
  const creature = makeTestCreature();
  const constNeuron = creature.neurons.find((n) => n.type === "constant")!;
  const json = internalJSON(constNeuron, 2);

  assertEquals(json.type, "constant");
  assertEquals(json.index, 2);
  assertEquals(typeof json.id, "number");
  assertEquals(json.bias, 1);
  assertEquals(json.squash, undefined);
});

Deno.test("fromJSON - creates neuron from export data", () => {
  const creature = makeTestCreature();
  const neuron = fromJSON(
    { type: "hidden", uuid: "test-uuid", bias: 0.75, squash: "LOGISTIC" },
    creature,
  );

  assertEquals(typeof neuron.id, "number");
  assertEquals(
    neuron.id >= 1_000_000,
    true,
    "Should get a generated integer ID",
  );
  assertEquals(neuron.type, "hidden");
  assertEquals(neuron.bias, 0.75);
  assertEquals(neuron.squash, "LOGISTIC");
});

Deno.test("fromJSON - generates ID when not provided", () => {
  const creature = makeTestCreature();
  const neuron = fromJSON(
    { type: "hidden", bias: 0.5, squash: "IDENTITY" },
    creature,
  );

  assertEquals(typeof neuron.id, "number");
  assert(neuron.id >= 1_000_000, "Should generate a large positive integer ID");
});

Deno.test("fromJSON - defaults bias to 0 when falsy", () => {
  const creature = makeTestCreature();
  const neuron = fromJSON(
    { type: "output", uuid: "out-1", bias: 0, squash: "IDENTITY" },
    creature,
  );

  assertEquals(neuron.bias, 0);
});

Deno.test("fromJSON - preserves tags from JSON", () => {
  const creature = makeTestCreature();
  const json = {
    type: "hidden" as const,
    uuid: "tagged-neuron",
    bias: 0.3,
    squash: "LOGISTIC",
    tags: [{ name: "source", value: "test" }],
  };
  const neuron = fromJSON(json, creature);

  assertEquals(getTag(neuron, "source"), "test");
});

Deno.test("Round-trip: exportJSON -> fromJSON preserves data", () => {
  const creature = makeTestCreature();
  const original = creature.neurons.find((n) => n.type === "hidden")!;

  const exported = exportJSON(original);
  const restored = fromJSON(exported, creature);

  assertEquals(restored.id, original.id);
  assertEquals(restored.type, original.type);
  assertEquals(restored.bias, original.bias);
  assertEquals(restored.squash, original.squash);
});
