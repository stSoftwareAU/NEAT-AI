import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { upgrade } from "../../src/upgrade/Upgrade.ts";

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

  // Act: upgrading should not throw; it should repair the structure so it validates forward-only again.
  const upgraded = upgrade(creature);

  // Assert: the upgraded creature is forward-only valid and contains no back/self connections.
  upgraded.validate({ forwardOnly: true });
  for (const s of upgraded.synapses) {
    assert(
      s.from !== s.to,
      "upgrade() should remove self-connections in forward-only mode",
    );
    assert(
      s.from < s.to,
      "upgrade() should remove back-connections in forward-only mode",
    );
  }
});
