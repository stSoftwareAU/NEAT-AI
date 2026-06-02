import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { Creature } from "@creature";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { assert, assertEquals } from "@std/assert";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Verifies the observable behaviour of loading a creature with memetic data:
// the creature is structurally valid, the memetic block has the expected
// shape with finite values, and the UUID→integer key migration produced the
// expected integer keys. Exact fixture magnitudes (generation/score/bias/weight
// values, neuron/synapse counts) are intentionally NOT asserted — those are
// fixture-dump values that change when `traced.json` is regenerated without any
// behavioural regression (Issue #2839).
function checkMemetic(creature: Creature) {
  creature.validate();

  // Structural: the fixture loaded with neurons and synapses present.
  assert(creature.neurons.length > 0);
  assert(creature.synapses.length > 0);

  // The memetic block exists with the expected shape and finite values.
  assert(creature.memetic);
  assert(Number.isInteger(creature.memetic.generation));
  assert(Number.isFinite(creature.memetic.score));
  assert(creature.memetic.biases);
  assert(creature.memetic.weights);

  // WHAT: UUID→integer bias-key migration produced the expected integer key.
  // bias key "552c68d3-6ea2-4e0c-a6bb-d7d1b0ad2661" → 675812961
  assert(creature.memetic.biases[675812961] !== undefined);
  assert(Number.isFinite(creature.memetic.biases[675812961]));

  // WHAT: UUID→integer weight-key migration.
  // weight key "input-115" (input neuron index 115) → 115
  assert(creature.memetic.weights[115]);
  // "115b0169-65c3-4c87-9904-316bae966a6f" → 855726674
  assert(creature.memetic.weights[115][1].toId === 855726674);
  assert(Number.isFinite(creature.memetic.weights[115][1].weight));
}

Deno.test("Trace - loads creature with memetic data from JSON", () => {
  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
  );
  checkMemetic(creature);
});

Deno.test("Trace - loads creature trace state with a positive node count", () => {
  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
  );
  const nodeState = creature.state.node(999);
  // WHAT: the persisted trace state restores a node accumulation count.
  // The exact magnitude is a fixture-dump value (Issue #2839) — assert it is a
  // positive integer rather than echoing the current fixture number.
  assert(Number.isInteger(nodeState.count));
  assert(nodeState.count > 0);
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
