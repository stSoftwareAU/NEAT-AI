import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { Creature } from "../../src/Creature.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function checkMemetic(creature: Creature) {
  creature.validate();
  assertEquals(creature.neurons.length, 1001);
  assertEquals(creature.synapses.length, 2449);
  assert(creature.memetic);
  assert(creature.memetic.generation === 6);
  assert(creature.memetic.score === 0.47133930519315353);
  assert(creature.memetic.biases);
  assertAlmostEquals(
    creature.memetic.biases["552c68d3-6ea2-4e0c-a6bb-d7d1b0ad2661"],
    0.0001412,
  );
  assert(creature.memetic.weights);
  assert(creature.memetic.weights["input-115"]);
  assert(
    creature.memetic.weights["input-115"][1].toUUID ===
      "115b0169-65c3-4c87-9904-316bae966a6f",
  );
  assertAlmostEquals(creature.memetic.weights["input-115"][1].weight, 0.1234);
}

Deno.test("Trace - loads creature with memetic data from JSON", () => {
  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
  );
  checkMemetic(creature);
});

Deno.test("Trace - loads creature trace state with correct node count", () => {
  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
  );
  const nodeState = creature.state.node(999);
  console.info(nodeState);
  assertEquals(nodeState.count, 1386);
});

Deno.test("Trace - traceJSON round-trip preserves memetic data", () => {
  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
  );
  const creature2 = Creature.fromJSON(creature.traceJSON());
  checkMemetic(creature2);
});

Deno.test("Trace - exportJSON round-trip preserves memetic data", () => {
  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
  );
  const creature2 = Creature.fromJSON(creature.exportJSON());
  checkMemetic(creature2);
});

Deno.test("Trace - applyLearnings modifies creature and remains valid", () => {
  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
  );
  creature.validate();
  const jsonBefore = creature.exportJSON();

  const config = createBackPropagationConfig({
    learningRate: 0.02,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);
  creature.applyLearnings(config, sparseConfig);
  creature.validate();
  const jsonAfter = creature.exportJSON();

  // Verify neuron count is preserved (synapses may be pruned)
  assertEquals(jsonAfter.neurons.length, jsonBefore.neurons.length);

  // Verify that learning modified the creature (weights, biases, or synapse count changed)
  const structureChanged =
    jsonAfter.synapses.length !== jsonBefore.synapses.length;

  let valuesChanged = false;
  if (!structureChanged) {
    for (let i = 0; i < jsonBefore.synapses.length; i++) {
      if (jsonBefore.synapses[i].weight !== jsonAfter.synapses[i].weight) {
        valuesChanged = true;
        break;
      }
    }
    if (!valuesChanged) {
      for (let i = 0; i < jsonBefore.neurons.length; i++) {
        if (jsonBefore.neurons[i].bias !== jsonAfter.neurons[i].bias) {
          valuesChanged = true;
          break;
        }
      }
    }
  }
  assert(
    structureChanged || valuesChanged,
    "applyLearnings should modify at least one weight, bias, or synapse",
  );
});
