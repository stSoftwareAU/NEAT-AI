import { assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import type { ConnectionRef } from "@architecture/Offspring.ts";
import { computeNeuronDependencyIndex } from "@architecture/Offspring.ts";

/**
 * Build a small creature and extract a ConnectionRef for a specific neuron,
 * so we can unit-test the dependency index computation in isolation.
 */
function makeTestCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-b", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-c", squash: "IDENTITY", bias: 0 },
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 1 },
      { fromUUID: "hidden-a", toUUID: "hidden-b", weight: 1 },
      { fromUUID: "hidden-b", toUUID: "hidden-c", weight: 1 },
      { fromUUID: "hidden-c", toUUID: "output-0", weight: 1 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

Deno.test(
  "computeNeuronDependencyIndex returns baseIndex when no connections exist",
  () => {
    const childMap = new Map<number, number>();
    const result = computeNeuronDependencyIndex(5, undefined, childMap);
    assertEquals(result, 5);
  },
);

Deno.test(
  "computeNeuronDependencyIndex returns baseIndex when all source neurons are inputs",
  () => {
    const creature = makeTestCreature();
    const hiddenA = creature.neurons.find((n) => n.uuid === "hidden-a")!;
    const connections = creature.inwardConnections(hiddenA.index);
    const ref: ConnectionRef = { parent: creature, synapses: connections };

    const childMap = new Map<number, number>();
    // input neurons are not checked, so childMap doesn't need their entries
    const result = computeNeuronDependencyIndex(3, ref, childMap);
    assertEquals(result, 3);
  },
);

Deno.test(
  "computeNeuronDependencyIndex bumps index when dependency has higher index",
  () => {
    const creature = makeTestCreature();
    const hiddenB = creature.neurons.find((n) => n.uuid === "hidden-b")!;
    const hiddenA = creature.neurons.find((n) => n.uuid === "hidden-a")!;
    const connections = creature.inwardConnections(hiddenB.index);
    const ref: ConnectionRef = { parent: creature, synapses: connections };

    const childMap = new Map<number, number>();
    // hidden-a is resolved at index 7
    childMap.set(hiddenA.id, 7);

    // baseIndex is 5, but hidden-a is at 7 so result should be 7 + 1 = 8
    const result = computeNeuronDependencyIndex(5, ref, childMap);
    assertEquals(result, 8);
  },
);

Deno.test(
  "computeNeuronDependencyIndex returns -1 when a non-input dependency is unresolved",
  () => {
    const creature = makeTestCreature();
    const hiddenB = creature.neurons.find((n) => n.uuid === "hidden-b")!;
    const connections = creature.inwardConnections(hiddenB.index);
    const ref: ConnectionRef = { parent: creature, synapses: connections };

    // childMap is empty — hidden-a dependency is unresolved
    const childMap = new Map<number, number>();
    const result = computeNeuronDependencyIndex(5, ref, childMap);
    assertEquals(result, -1);
  },
);

Deno.test(
  "computeNeuronDependencyIndex keeps baseIndex when dependency index is lower",
  () => {
    const creature = makeTestCreature();
    const hiddenB = creature.neurons.find((n) => n.uuid === "hidden-b")!;
    const hiddenA = creature.neurons.find((n) => n.uuid === "hidden-a")!;
    const connections = creature.inwardConnections(hiddenB.index);
    const ref: ConnectionRef = { parent: creature, synapses: connections };

    const childMap = new Map<number, number>();
    // hidden-a is at index 2, which is less than baseIndex 5
    childMap.set(hiddenA.id, 2);

    const result = computeNeuronDependencyIndex(5, ref, childMap);
    assertEquals(result, 5);
  },
);
