import { assert, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { assertSynapsesSortedByFromTo } from "@architecture/SynapseOrderGuard.ts";
import { TopologyError } from "@errors/TopologyError.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** Synapses must remain sorted lexicographically by (from, to). */
function isSorted(creature: Creature): boolean {
  for (let i = 1; i < creature.synapses.length; i++) {
    const prev = creature.synapses[i - 1];
    const curr = creature.synapses[i];
    const ordered = prev.from < curr.from ||
      (prev.from === curr.from && prev.to <= curr.to);
    if (!ordered) return false;
  }
  return true;
}

Deno.test("AddNeuron - synapses stay sorted by (from, to) after insertion", () => {
  // Build a moderately dense creature and run many ADD_NODE mutations.
  // The monotonic index remap must preserve sort order with no re-sort.
  const creature = new Creature(6, 2);
  const addNeuron = new AddNeuron(creature);

  for (let i = 0; i < 60; i++) {
    addNeuron.mutate();
    creatureValidate(creature);
    assert(
      isSorted(creature),
      `Synapses lost (from, to) ordering after mutation ${i}`,
    );
  }
});

Deno.test("assertSynapsesSortedByFromTo - passes on a correctly ordered creature", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 2, weight: 0.8 },
      { from: 2, to: 3, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });
  creature.DEBUG = true;

  // Should not throw — array is sorted by (from, to).
  assertSynapsesSortedByFromTo(creature, "test");
});

Deno.test("assertSynapsesSortedByFromTo - throws when DEBUG and order broken", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 2, weight: 0.8 },
      { from: 2, to: 3, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });
  creature.DEBUG = true;

  // Deliberately break the order: swap the first two synapses so (1,2)
  // precedes (0,2).
  const tmp = creature.synapses[0];
  creature.synapses[0] = creature.synapses[1];
  creature.synapses[1] = tmp;

  assertThrows(
    () => assertSynapsesSortedByFromTo(creature, "broken"),
    TopologyError,
  );
});

Deno.test("assertSynapsesSortedByFromTo - no-op when DEBUG is false", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 2, weight: 0.8 },
      { from: 2, to: 3, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });
  creature.DEBUG = false;

  // Break the order, but with DEBUG off the guard must not throw.
  const tmp = creature.synapses[0];
  creature.synapses[0] = creature.synapses[1];
  creature.synapses[1] = tmp;

  // Should not throw.
  assertSynapsesSortedByFromTo(creature, "debug-off");
});
