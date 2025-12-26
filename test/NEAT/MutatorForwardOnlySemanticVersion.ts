import { assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";

/**
 * Regression test (26-Dec-2025).
 *
 * Bug: semanticVersion 4.x is a hard forward-only invariant, but some older
 * code paths only enforced forward-only when `creature.forwardOnly === true`.
 * This allowed a 4.x creature (missing the forwardOnly flag) to be mutated in
 * feedbackLoop mode, introducing recurrent connections that later crashed
 * during breeding/upgrade validation.
 *
 * Expected: Mutator must enforce forward-only for semanticVersion 4.x creatures
 * even when the `forwardOnly` flag is missing.
 */
Deno.test("Mutator: semanticVersion 4.x enforces forward-only even without forwardOnly flag", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    semanticVersion: "4.0.0",
    // Intentionally omit forwardOnly: true to simulate legacy exports/state.
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

  assertThrows(
    () => mutator.mutateCreature(creature, Mutation.ADD_SELF_CONN),
    Error,
    "CRITICAL",
  );
});
