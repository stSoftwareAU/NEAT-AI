import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

Deno.test("Forward-only: violation is logged and repaired on mutate", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-0", weight: 0.25 }, // illegal self connection
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
    ],
  };

  const creature = Creature.fromJSON(json);
  assertEquals(creature.forwardOnly, true);

  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(" "));
  };

  try {
    const mutator = new Mutator(
      createNeatConfig({
        feedbackLoop: false, // forward-only run
        mutationRate: 1,
        mutationAmount: 1,
        mutation: [Mutation.MOD_WEIGHT],
        log: 0,
      }),
    );

    // Force a mutation attempt.
    mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);

    // Must remain forward-only and have no self/back connections after repair.
    assertEquals(creature.forwardOnly, true);
    creature.validate({ forwardOnly: true });

    assert(
      logged.some((line) =>
        line.includes("Forward-only violation") &&
        line.includes("SELF_CONNECTION")
      ),
      `Expected forward-only violation log, got:\n${logged.join("\n")}`,
    );
  } finally {
    console.error = originalError;
  }
});

Deno.test("FeedbackLoop enabled clears forwardOnly flag", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.forwardOnly = true;

  const mutator = new Mutator(
    createNeatConfig({
      feedbackLoop: true,
      mutationRate: 1,
      mutationAmount: 1,
      mutation: [Mutation.MOD_WEIGHT],
      log: 0,
    }),
  );

  mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);
  assertEquals(creature.forwardOnly, undefined);
});
