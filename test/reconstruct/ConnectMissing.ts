import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature, CreatureUtil } from "../../mod.ts";
import { randomConnectMissing } from "../../src/reconstruct/ConnectMissing.ts";

Deno.test("randomConnectMissing - connects all inputs when some are missing", () => {
  const creature = new Creature(10, 3);
  const exported = creature.exportJSON();

  exported.input = 20;
  const creature2 = Creature.fromJSON(exported);
  const uuid2 = CreatureUtil.makeUUID(creature2);
  const creature3 = randomConnectMissing(creature2);
  const uuid3 = CreatureUtil.makeUUID(creature3);

  assertNotEquals(
    uuid2,
    uuid3,
    "creature should have changed after connecting missing inputs",
  );

  const exported3 = creature3.exportJSON();
  assertEquals(exported3.input, 20);

  // Verify every input has at least one synapse connected.
  // Input neurons have IDs 0..(input-1) (non-negative integers).
  const connectedInputs = new Set<number>();
  for (const synapse of exported3.synapses) {
    if (
      synapse.fromId !== undefined &&
      synapse.fromId >= 0 &&
      synapse.fromId < exported3.input
    ) {
      connectedInputs.add(synapse.fromId);
    }
  }

  for (let i = 0; i < exported3.input; i++) {
    assert(
      connectedInputs.has(i),
      `Input ${i} should be connected after randomConnectMissing`,
    );
  }
});

Deno.test("randomConnectMissing - does not modify creature when all inputs already connected", () => {
  const creature = new Creature(10, 3);
  const uuid1 = CreatureUtil.makeUUID(creature);

  const creature2 = randomConnectMissing(creature);
  const uuid2 = CreatureUtil.makeUUID(creature2);

  assertEquals(
    uuid1,
    uuid2,
    "UUID should not change when no inputs are missing",
  );
});
