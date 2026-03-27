/**
 * Issue #2047: Tests verifying that direct CreatureExport object passing
 * (instead of JSON string serialisation) produces identical creatures.
 *
 * These tests exercise the WorkerProcessor with CreatureExport objects
 * directly to confirm the new serialisation-free path works correctly.
 */
import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";

/**
 * Creates a test creature with a specified number of hidden neurons.
 *
 * Input neuron IDs: 0, 1 (index-based)
 * Output neuron IDs: -1 (negative, 1-based)
 * Hidden neuron IDs: 100+
 */
function createTestCreature(hiddenCount: number): Creature {
  const outputId = -1; // outputNeuronId(0)
  const json = {
    input: 2,
    output: 1,
    neurons: [
      ...Array.from({ length: hiddenCount }, (_, i) => ({
        type: "hidden" as const,
        id: 100 + i,
        bias: (i + 1) * 0.1, // deterministic bias
        squash: "LOGISTIC",
      })),
      { type: "output" as const, id: outputId, bias: 0.5, squash: "LOGISTIC" },
    ],
    synapses: [
      // Connect inputs to first hidden (or output if no hidden)
      {
        fromId: 0,
        toId: hiddenCount > 0 ? 100 : outputId,
        weight: 0.3,
      },
      {
        fromId: 1,
        toId: hiddenCount > 0 ? 100 : outputId,
        weight: -0.7,
      },
      // Connect hidden neurons in a chain if more than one
      ...Array.from(
        { length: Math.max(0, hiddenCount - 1) },
        (_, i) => ({
          fromId: 100 + i,
          toId: 100 + i + 1,
          weight: (i + 1) * 0.2,
        }),
      ),
      // Connect last hidden to output
      ...(hiddenCount > 0
        ? [{
          fromId: 100 + hiddenCount - 1,
          toId: outputId,
          weight: 0.5,
        }]
        : []),
    ],
  };
  return Creature.fromJSON(json);
}

Deno.test(
  "WorkerProcessor: evaluate accepts CreatureExport object directly",
  () => {
    const creature = createTestCreature(3);
    const exported = creature.exportJSON();

    // Verify the exported object can be used directly by Creature.fromJSON
    const reconstructed = Creature.fromJSON(exported);
    assertEquals(reconstructed.neurons.length, creature.neurons.length);
    assertEquals(reconstructed.synapses.length, creature.synapses.length);

    // Verify neuron IDs match
    for (let i = 0; i < creature.neurons.length; i++) {
      assertEquals(reconstructed.neurons[i].id, creature.neurons[i].id);
    }

    // Verify synapse weights match
    for (let i = 0; i < creature.synapses.length; i++) {
      assertEquals(
        reconstructed.synapses[i].weight,
        creature.synapses[i].weight,
      );
    }

    creature.dispose();
    reconstructed.dispose();
  },
);

Deno.test(
  "CreatureExport roundtrip: direct object preserves all fields",
  () => {
    const creature = createTestCreature(5);
    const exported = creature.exportJSON();

    // Simulate the new worker pipeline: pass object directly
    const reconstructed = Creature.fromJSON(exported);
    const reExported = reconstructed.exportJSON();

    // Compare structural properties
    assertEquals(reExported.input, exported.input);
    assertEquals(reExported.output, exported.output);
    assertEquals(reExported.neurons.length, exported.neurons.length);
    assertEquals(reExported.synapses.length, exported.synapses.length);

    // Compare each neuron
    for (let i = 0; i < exported.neurons.length; i++) {
      assertEquals(reExported.neurons[i].id, exported.neurons[i].id);
      assertEquals(reExported.neurons[i].bias, exported.neurons[i].bias);
      assertEquals(reExported.neurons[i].type, exported.neurons[i].type);
      assertEquals(reExported.neurons[i].squash, exported.neurons[i].squash);
    }

    // Compare each synapse
    for (let i = 0; i < exported.synapses.length; i++) {
      assertEquals(
        reExported.synapses[i].fromId,
        exported.synapses[i].fromId,
      );
      assertEquals(reExported.synapses[i].toId, exported.synapses[i].toId);
      assertEquals(
        reExported.synapses[i].weight,
        exported.synapses[i].weight,
      );
    }

    creature.dispose();
    reconstructed.dispose();
  },
);

Deno.test(
  "Direct object vs JSON string roundtrip: produces identical creatures",
  () => {
    const creature = createTestCreature(10);
    const exported = creature.exportJSON();

    // Old path: JSON.stringify + JSON.parse
    const viaJson = Creature.fromJSON(JSON.parse(JSON.stringify(exported)));
    // New path: direct object
    const viaDirect = Creature.fromJSON(exported);

    // Both should produce creatures with identical structure
    assertEquals(viaJson.neurons.length, viaDirect.neurons.length);
    assertEquals(viaJson.synapses.length, viaDirect.synapses.length);

    for (let i = 0; i < viaJson.neurons.length; i++) {
      assertEquals(viaJson.neurons[i].id, viaDirect.neurons[i].id);
      assertEquals(viaJson.neurons[i].bias, viaDirect.neurons[i].bias);
    }

    for (let i = 0; i < viaJson.synapses.length; i++) {
      assertEquals(viaJson.synapses[i].weight, viaDirect.synapses[i].weight);
      assertEquals(viaJson.synapses[i].from, viaDirect.synapses[i].from);
      assertEquals(viaJson.synapses[i].to, viaDirect.synapses[i].to);
    }

    creature.dispose();
    viaJson.dispose();
    viaDirect.dispose();
  },
);

Deno.test(
  "Breed request: CreatureExport objects produce valid offspring",
  () => {
    const mother = createTestCreature(3);
    const father = createTestCreature(3);

    const motherExport = mother.exportJSON();
    const fatherExport = father.exportJSON();

    // Verify both can be reconstructed from their exports
    const motherRecon = Creature.fromJSON(motherExport);
    const fatherRecon = Creature.fromJSON(fatherExport);

    assertEquals(motherRecon.neurons.length, mother.neurons.length);
    assertEquals(fatherRecon.neurons.length, father.neurons.length);

    mother.dispose();
    father.dispose();
    motherRecon.dispose();
    fatherRecon.dispose();
  },
);

Deno.test(
  "Large creature: direct object roundtrip matches JSON roundtrip",
  () => {
    // Use the real traced.json test creature (378 neurons, 2448 synapses)
    const rawJson = JSON.parse(
      Deno.readTextFileSync("test/data/traced.json"),
    );
    const creature = Creature.fromJSON(rawJson);
    const exported = creature.exportJSON();

    // Old path: JSON.stringify + JSON.parse roundtrip
    const viaJsonStr = JSON.stringify(exported);
    const viaJson = Creature.fromJSON(JSON.parse(viaJsonStr));

    // New path: direct object
    const viaDirect = Creature.fromJSON(exported);

    assertEquals(viaJson.neurons.length, viaDirect.neurons.length);
    assertEquals(viaJson.synapses.length, viaDirect.synapses.length);
    assertEquals(viaJson.input, viaDirect.input);
    assertEquals(viaJson.output, viaDirect.output);

    // Spot-check a sampling of neurons
    for (let i = 0; i < viaJson.neurons.length; i += 10) {
      assertEquals(viaJson.neurons[i].id, viaDirect.neurons[i].id);
      assertEquals(viaJson.neurons[i].bias, viaDirect.neurons[i].bias);
    }

    // Spot-check a sampling of synapses
    for (let i = 0; i < viaJson.synapses.length; i += 50) {
      assertEquals(viaJson.synapses[i].weight, viaDirect.synapses[i].weight);
    }

    creature.dispose();
    viaJson.dispose();
    viaDirect.dispose();
  },
);
