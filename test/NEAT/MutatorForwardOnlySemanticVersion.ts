import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutator } from "@neat/Mutator.ts";
import { Mutation } from "@neat/Mutation.ts";

/**
 * Regression test (26-Dec-2025).
 *
 * Forward-only mutation filtering and repair use `creature.forwardOnly === true`
 * as the source of truth (not semantic version alone).
 *
 * Issue #1583: repairAfterMutation() runs fix({ forwardOnly: true }) when enforcing
 * forward-only. ADD_SELF_CONN is a no-op when forwardOnly is true; the creature
 * must stay valid forward-only after repair.
 */
Deno.test("Mutator: forwardOnly true blocks self-connection mutation and keeps topology valid", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    semanticVersion: "4.0.0",
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
    ],
  };

  const creature = Creature.fromJSON(json);

  const config = createNeatConfig({
    // feedbackLoop=true makes this an easy reproduction: without enforcing
    // semanticVersion 4.x, mutations like ADD_SELF_CONN can introduce
    // recurrent synapses into a 4.x creature.
    feedbackLoop: true,
    mutationRate: 1,
    mutationAmount: 1,
  });
  const mutator = new Mutator(config);

  const changed = mutator.mutateCreature(creature, Mutation.ADD_SELF_CONN);
  assert(!changed, "ADD_SELF_CONN must not apply when forwardOnly is true");
  mutator.repairAfterMutation(creature);

  creature.validate({ forwardOnly: true });
  for (const synapse of creature.synapses) {
    assert(
      synapse.from !== synapse.to,
      `self-connection must not be present: ${synapse.from}`,
    );
  }
});
