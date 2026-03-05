import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { makeSynapsesValue } from "../../src/optimize/makeSynapsesValue.ts";

/** Helper: creates a creature for testing makeSynapsesValue. */
function makeTestCreature(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-1", bias: 3 },
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: -1 },
      { fromUUID: "const-1", toUUID: "hidden-1", weight: 2 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
    ],
  };
  return Creature.fromJSON(json);
}

Deno.test("makeSynapsesValue - constant neuron returns pre-computed value", () => {
  const creature = makeTestCreature();
  // Find synapse from const-1 to hidden-1
  const synapse = creature.synapses.find(
    (s) => creature.neurons[s.from].uuid === "const-1",
  )!;
  const result = makeSynapsesValue(synapse, creature.neurons);

  // const-1 has bias=3, weight=2, so value = 3 * 2 = 6
  assertEquals(result, "6");
});

Deno.test("makeSynapsesValue - weight 1 returns activation reference only", () => {
  const creature = makeTestCreature();
  // Find synapse from input-0 with weight=1
  const synapse = creature.synapses.find(
    (s) =>
      creature.neurons[s.from].uuid === "input-0" &&
      s.weight === 1,
  )!;
  const result = makeSynapsesValue(synapse, creature.neurons);

  assertEquals(result, `a[${synapse.from}]`);
});

Deno.test("makeSynapsesValue - weight -1 returns negated activation", () => {
  const creature = makeTestCreature();
  // Find synapse from input-1 with weight=-1
  const synapse = creature.synapses.find(
    (s) =>
      creature.neurons[s.from].uuid === "input-1" &&
      s.weight === -1,
  )!;
  const result = makeSynapsesValue(synapse, creature.neurons);

  assertEquals(result, `-a[${synapse.from}]`);
});

Deno.test("makeSynapsesValue - arbitrary weight returns multiplication", () => {
  const creature = makeTestCreature();
  // Find synapse from hidden-1 to output-0 with weight=0.5
  const synapse = creature.synapses.find(
    (s) =>
      creature.neurons[s.from].uuid === "hidden-1" &&
      s.weight === 0.5,
  )!;
  const result = makeSynapsesValue(synapse, creature.neurons);

  assertEquals(result, `a[${synapse.from}]*0.5`);
});
