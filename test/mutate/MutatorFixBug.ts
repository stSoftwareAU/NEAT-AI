import { assertEquals } from "@std/assert";
import { Creature, CreatureUtil, Mutation } from "../../mod.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";

/**
 * Test for bug: fix() called unconditionally causes incorrect return value.
 *
 * When mutation fails (returns changed=false), but fix() makes structural
 * changes (e.g., removes zero-weight synapses), the UUID changes and
 * mutateCreature incorrectly returns true.
 */
Deno.test("mutateCreature should return false when mutation fails even if fix() cleans up", () => {
  // Create a minimal creature with no hidden neurons (SUB_NODE will fail)
  // and a zero-weight synapse that fix() will remove
  const json: CreatureExport = {
    neurons: [
      {
        type: "output",
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      // Valid connection with non-zero weight
      {
        weight: 1.0,
        fromUUID: "input-0",
        toUUID: "output-0",
      },
      // Zero-weight connection that fix() will remove
      {
        weight: 0,
        fromUUID: "input-1",
        toUUID: "output-0",
      },
    ],
    input: 2,
    output: 1,
  };

  const creature = Creature.fromJSON(json);

  // Verify initial state - creature has 2 synapses
  assertEquals(creature.synapses.length, 2, "Should have 2 synapses initially");

  const mutator = new Mutator(createNeatConfig({}));

  // Capture UUID before mutation attempt
  const startUUID = CreatureUtil.makeUUID(creature);

  // Attempt SUB_NODE mutation - this should fail since there are no hidden neurons
  // But fix() will remove the zero-weight synapse, potentially changing the UUID
  const result = mutator.mutateCreature(creature, Mutation.SUB_NODE);

  // The mutation itself didn't change anything (no hidden neurons to remove)
  // So mutateCreature should return false
  assertEquals(
    result,
    false,
    "mutateCreature should return false when mutation fails",
  );

  // Since mutation failed, fix() should NOT be called, so zero-weight synapse remains
  assertEquals(
    creature.synapses.length,
    2,
    "fix() should not be called when mutation fails",
  );

  // UUID should still match start because mutation didn't change the creature
  const endUUID = CreatureUtil.makeUUID(creature);
  assertEquals(
    startUUID,
    endUUID,
    "UUID should not change when mutation fails",
  );
});
