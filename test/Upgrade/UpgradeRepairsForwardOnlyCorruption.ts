import { assert, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { upgrade } from "../../src/upgrade/Upgrade.ts";

/**
 * Test for https://github.com/stSoftwareAU/NEAT-AI/issues/956
 *
 * A 4.x creature is a hard invariant: if it becomes invalid, that's a bug in
 * our breeding/mutation/discovery logic. We do NOT silently repair - we throw
 * so the bug can be identified and fixed at the source.
 */
Deno.test("upgrade(): throws for corrupted 4.x forward-only creature with back connection", () => {
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

  // Act/Assert: upgrading a corrupted 4.x creature should throw.
  // This is intentional - corrupted 4.x creatures indicate a bug in our code.
  assertThrows(
    () => upgrade(creature),
    Error,
    "Recursive synapse",
  );
});
