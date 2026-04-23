import { assertEquals, assertNotStrictEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { cloneCreatureExport } from "@compact/CloneCreatureExport.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";

function sampleExport(): CreatureExport {
  const json: CreatureExport = {
    neurons: [
      {
        uuid: "hidden-0",
        type: "hidden",
        squash: "IDENTITY",
        bias: 0.25,
        tags: [{ name: "origin", value: "test" }],
      },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 0.7,
        tags: [{ name: "kind", value: "excitatory" }],
      },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: -1.5 },
    ],
    input: 1,
    output: 1,
    forwardOnly: true,
    semanticVersion: "4.0.0",
    tags: [{ name: "species", value: "alpha" }],
  };
  normaliseCreatureExport(json);
  return json;
}

Deno.test("cloneCreatureExport: produces a deep-enough copy that mutation is isolated", () => {
  const source = sampleExport();
  const clone = cloneCreatureExport(source);

  assertEquals(clone.input, source.input);
  assertEquals(clone.output, source.output);
  assertEquals(clone.forwardOnly, true);
  assertEquals(clone.semanticVersion, "4.0.0");
  assertEquals(clone.neurons.length, source.neurons.length);
  assertEquals(clone.synapses.length, source.synapses.length);

  // Top-level containers are fresh arrays.
  assertNotStrictEquals(clone.neurons, source.neurons);
  assertNotStrictEquals(clone.synapses, source.synapses);

  // Every neuron object is fresh.
  for (let i = 0; i < source.neurons.length; i++) {
    assertNotStrictEquals(clone.neurons[i], source.neurons[i]);
  }
  for (let i = 0; i < source.synapses.length; i++) {
    assertNotStrictEquals(clone.synapses[i], source.synapses[i]);
  }

  // Tag arrays are independent copies.
  assertNotStrictEquals(clone.neurons[0].tags, source.neurons[0].tags);
  assertNotStrictEquals(clone.synapses[0].tags, source.synapses[0].tags);

  // Mutating the clone does not affect the source.
  clone.neurons[0].bias = 999;
  clone.synapses[0].weight = 999;
  clone.neurons[0].tags!.push({ name: "added", value: "on-clone" });

  assertEquals(source.neurons[0].bias, 0.25);
  assertEquals(source.synapses[0].weight, 0.7);
  assertEquals(source.neurons[0].tags!.length, 1);
});

Deno.test("cloneCreatureExport: minimal input (no optional fields) round-trips cleanly", () => {
  const minimal: CreatureExport = {
    neurons: [
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
    input: 1,
    output: 1,
  };
  normaliseCreatureExport(minimal);

  const clone = cloneCreatureExport(minimal);

  assertEquals(clone.forwardOnly, undefined);
  assertEquals(clone.semanticVersion, undefined);
  assertEquals(clone.memetic, undefined);
  assertEquals(clone.tags, undefined);
  assertEquals(clone.neurons.length, 1);
  assertEquals(clone.synapses.length, 1);
  assertEquals(clone.synapses[0].weight, 1);
});
