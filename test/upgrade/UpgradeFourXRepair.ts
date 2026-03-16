import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { upgrade } from "../../src/upgrade/Upgrade.ts";

/**
 * Test for recursive synapse repair in 4.x creatures.
 *
 * When a 4.x creature has a recursive synapse (from > to), the upgrade
 * function should attempt to repair it rather than throwing immediately.
 * This allows production workflows to continue while logging a warning.
 */
Deno.test("upgrade(): repairs corrupted 4.x creature with back connection", () => {
  // Arrange: create a valid forward-only creature, then inject an invalid back connection.
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;

  // Verify initial state
  creature.validate({ forwardOnly: true });

  const hiddenIndex = creature.input; // first hidden neuron index
  const outputIndex = creature.neurons.length - 1; // only output neuron
  assert(outputIndex > hiddenIndex);

  // Inject a back connection (from a later neuron to an earlier one), which is illegal for forward-only.
  const laterHiddenIndex = creature.input + 1; // second hidden neuron
  creature.synapses.push(new Synapse(laterHiddenIndex, hiddenIndex, 0.123));
  creature.synapses.sort((
    a,
    b,
  ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

  // Act: upgrade should repair and return a valid creature
  const upgraded = upgrade(creature);

  // Assert: creature should now be valid and still 4.x
  upgraded.validate({ forwardOnly: true });
  assertEquals(upgraded.forwardOnly, true);
  const major = parseInt(upgraded.semanticVersion?.split(".")[0] ?? "0", 10);
  assertEquals(major, 4);

  // The recursive synapse should have been removed
  const hasRecursive = upgraded.synapses.some((s) => s.from > s.to);
  assertEquals(hasRecursive, false, "Recursive synapses should be removed");
});

Deno.test("upgrade(): repairs corrupted 4.x creature with self connection", () => {
  // Arrange: create a valid forward-only creature, then inject an invalid self connection.
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;

  // Verify initial state
  creature.validate({ forwardOnly: true });

  const hiddenIndex = creature.input; // first hidden neuron index

  // Inject a self connection (from === to), which is illegal for forward-only.
  creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.5));
  creature.synapses.sort((
    a,
    b,
  ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

  // Act: upgrade should repair and return a valid creature
  const upgraded = upgrade(creature);

  // Assert: creature should now be valid and still 4.x
  upgraded.validate({ forwardOnly: true });
  assertEquals(upgraded.forwardOnly, true);
  const major = parseInt(upgraded.semanticVersion?.split(".")[0] ?? "0", 10);
  assertEquals(major, 4);

  // The self connection should have been removed
  const hasSelfConnection = upgraded.synapses.some((s) => s.from === s.to);
  assertEquals(hasSelfConnection, false, "Self connections should be removed");
});
