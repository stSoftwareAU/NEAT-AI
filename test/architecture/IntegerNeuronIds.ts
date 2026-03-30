/**
 * IntegerNeuronIds.ts - Tests for integer-based neuron identity system.
 *
 * Issue #1958: Verifies that neurons use integer IDs instead of UUID strings,
 * and that all serialisation, breeding, and mutation operations work correctly
 * with the new integer ID scheme.
 */
import { assertEquals, assertNotEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { Creature } from "../../src/Creature.ts";
import { exportSnapshotJSON } from "../../src/creature/CreatureSerialization.ts";
import {
  inputNeuronId,
  isOutputNeuronId,
  nextNeuronId,
  outputIndexFromId,
  outputNeuronId,
} from "@architecture/NeuronId.ts";

Deno.test("Input neurons have integer IDs matching their index", () => {
  const creature = new Creature(3, 2);
  for (let i = 0; i < creature.input; i++) {
    const neuron = creature.neurons[i];
    assertEquals(
      typeof neuron.id,
      "number",
      "Input neuron ID should be a number",
    );
    assertEquals(neuron.id, i, `Input neuron ${i} should have id=${i}`);
  }
});

Deno.test("Output neurons have negative integer IDs", () => {
  const creature = new Creature(3, 2);
  const outputStart = creature.neurons.length - creature.output;
  for (let i = 0; i < creature.output; i++) {
    const neuron = creature.neurons[outputStart + i];
    assertEquals(
      typeof neuron.id,
      "number",
      "Output neuron ID should be a number",
    );
    assertEquals(
      neuron.id,
      outputNeuronId(i),
      `Output neuron ${i} should have id=${outputNeuronId(i)}`,
    );
    assertEquals(
      isOutputNeuronId(neuron.id),
      true,
      "Output neuron ID should be recognised as output",
    );
    assertEquals(
      outputIndexFromId(neuron.id),
      i,
      "Output index should be recoverable from ID",
    );
  }
});

Deno.test("Hidden neurons have positive integer IDs >= 1_000_000", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3, squash: "TANH" }],
  });
  for (const neuron of creature.neurons) {
    if (neuron.type === "hidden") {
      assertEquals(
        typeof neuron.id,
        "number",
        "Hidden neuron ID should be a number",
      );
      assertEquals(
        neuron.id >= 1_000_000,
        true,
        `Hidden neuron ID ${neuron.id} should be >= 1_000_000`,
      );
    }
  }
});

Deno.test("nextNeuronId returns unique sequential integers", () => {
  const id1 = nextNeuronId();
  const id2 = nextNeuronId();
  assertNotEquals(id1, id2, "Sequential IDs should be unique");
  assertEquals(id2, id1 + 1, "Sequential IDs should be consecutive");
});

Deno.test("NeuronId utility functions are consistent", () => {
  assertEquals(inputNeuronId(0), 0);
  assertEquals(inputNeuronId(5), 5);
  assertEquals(outputNeuronId(0), -1);
  assertEquals(outputNeuronId(1), -2);
  assertEquals(outputNeuronId(2), -3);
  assertEquals(isOutputNeuronId(-1), true);
  assertEquals(isOutputNeuronId(-3), true);
  assertEquals(isOutputNeuronId(0), false);
  assertEquals(isOutputNeuronId(5), false);
  assertEquals(outputIndexFromId(-1), 0);
  assertEquals(outputIndexFromId(-2), 1);
  assertEquals(outputIndexFromId(-3), 2);
});

Deno.test("Serialisation: public export is uuid-only; round-trip preserves wire uuids", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  const exported = exportSnapshotJSON(creature);

  // Public snapshot: stable uuid endpoints only (no numeric id in JSON).
  for (const neuron of exported.neurons) {
    assertEquals(
      (neuron as { id?: number }).id,
      undefined,
      "Public export omits runtime id",
    );
    assertEquals(typeof neuron.uuid, "string");
  }
  for (const synapse of exported.synapses) {
    assertEquals((synapse as { fromId?: number }).fromId, undefined);
    assertEquals((synapse as { toId?: number }).toId, undefined);
  }

  const normalised = structuredClone(exported) as CreatureExport;
  normaliseCreatureExport(normalised);
  for (const neuron of normalised.neurons) {
    assertEquals(typeof (neuron as { id: number }).id, "number");
  }
  for (const synapse of normalised.synapses) {
    assertEquals(typeof synapse.fromId, "number");
    assertEquals(typeof synapse.toId, "number");
  }

  // Round-trip: load back — wire uuids match; hidden ids follow deterministicIdFromUuid
  const restored = Creature.fromJSON(exported);
  assertEquals(restored.neurons.length, creature.neurons.length);

  for (let i = 0; i < creature.neurons.length; i++) {
    const a = creature.neurons[i];
    const b = restored.neurons[i];
    assertEquals(a.type, b.type);
    if (a.type === "input" || a.type === "output") {
      assertEquals(b.id, a.id, `Neuron ${i} fixed-scheme id should match`);
    } else {
      assertEquals(b.uuid, a.uuid, `Neuron ${i} wire uuid should survive`);
    }
  }
});

Deno.test("Breeding offspring uses integer neuron IDs", async () => {
  const { Offspring } = await import("../../src/architecture/Offspring.ts");

  const mum = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });
  const dad = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  const child = Offspring.breed(mum, dad);
  if (child) {
    for (const neuron of child.neurons) {
      assertEquals(
        typeof neuron.id,
        "number",
        `Offspring neuron should have numeric id, got ${typeof neuron.id}`,
      );
    }
  }
});

Deno.test("Genetic compatibility: identical structures score 1", async () => {
  const { geneticCompatibility } = await import(
    "../../src/breed/GeneticCompatibility.ts"
  );

  const a = new Creature(2, 1, {
    layers: [{ count: 3, squash: "TANH" }],
  });
  const b = a.shallowClone();

  // Same structure should be fully compatible
  const compatibility = geneticCompatibility(a, b);
  assertEquals(
    compatibility,
    1,
    "Identical creatures should have compatibility 1",
  );
});
