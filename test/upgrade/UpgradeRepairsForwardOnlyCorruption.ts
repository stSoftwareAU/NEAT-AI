import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { upgrade } from "../../src/upgrade/Upgrade.ts";

/**
 * Test for https://github.com/stSoftwareAU/NEAT-AI/issues/956
 *
 * A 4.x creature with forward-only violations should be repaired automatically.
 * This allows production workflows to continue whilst logging a warning for
 * investigation. The recurrent connections are removed during repair.
 */
Deno.test("upgrade(): repairs corrupted 4.x forward-only creature with back connection", () => {
  // Arrange: create a valid forward-only creature, then inject an invalid back connection.
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;

  const hiddenIndex = creature.input; // first hidden neuron index
  const outputIndex = creature.neurons.length - 1; // only output neuron
  assert(outputIndex > hiddenIndex);

  // Inject a back connection (output -> hidden), which is illegal for forward-only.
  creature.synapses.push(new Synapse(outputIndex, hiddenIndex, 0.123));
  creature.synapses.sort((
    a,
    b,
  ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

  // Act: upgrading a corrupted 4.x creature should repair it.
  const upgraded = upgrade(creature);

  // Assert: creature should now be valid and still 4.x.
  upgraded.validate({ forwardOnly: true });
  assertEquals(upgraded.forwardOnly, true);
  const major = parseInt(upgraded.semanticVersion?.split(".")[0] ?? "0", 10);
  assertEquals(major, 4);

  // The recursive synapse should have been removed.
  const hasRecursive = upgraded.synapses.some((s) => s.from > s.to);
  assertEquals(hasRecursive, false, "Recursive synapses should be removed");
});
