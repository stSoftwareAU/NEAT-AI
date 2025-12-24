import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

Deno.test("Forward-only: breeding upgrades semanticVersion 2.x.x → 3.0.0 when validation passes", () => {
  const mumJson: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    semanticVersion: "2.9.9",
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
    ],
  };
  const dadJson: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    semanticVersion: "2.9.9",
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0.1 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.2 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.7 },
      // Extra connection so crossover can create a non-clone child.
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.2 },
    ],
  };

  const mum = Creature.fromJSON(mumJson);
  const dad = Creature.fromJSON(dadJson);
  mum.validate({ forwardOnly: true });
  dad.validate({ forwardOnly: true });

  let child: Creature | undefined;
  for (let attempt = 0; attempt < 200; attempt++) {
    child = Offspring.breed(mum, dad, { forwardOnly: true });
    if (child) break;
  }
  assert(child, "Expected child");

  // The child is confirmed forward-only via validate({ forwardOnly: true }) inside breed().
  assertEquals(child.forwardOnly, true);
  assertEquals(child.semanticVersion, "4.0.0");
});

Deno.test("Forward-only: mutation upgrades semanticVersion 2.x.x → 3.0.0 when validation passes", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.forwardOnly = true;
  creature.semanticVersion = "2.9.9";
  creature.validate({ forwardOnly: true });

  const mutator = new Mutator(
    createNeatConfig({
      feedbackLoop: false,
      mutationRate: 1,
      mutationAmount: 1,
      mutation: [Mutation.MOD_WEIGHT],
      log: 0,
    }),
  );

  let mutated = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (mutator.mutateCreature(creature, Mutation.MOD_WEIGHT)) {
      mutated = true;
      break;
    }
  }
  assert(mutated, "Expected creature to mutate");
  assertEquals(creature.forwardOnly, true);
  assertEquals(creature.semanticVersion, "4.0.0");
});

Deno.test("Forward-only: semanticVersion is never downgraded (e.g. 4.1.2 stays 4.1.2)", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.forwardOnly = true;
  creature.semanticVersion = "4.1.2";
  creature.validate({ forwardOnly: true });

  const mutator = new Mutator(
    createNeatConfig({
      feedbackLoop: false,
      mutationRate: 1,
      mutationAmount: 1,
      mutation: [Mutation.MOD_WEIGHT],
      log: 0,
    }),
  );

  let mutated = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (mutator.mutateCreature(creature, Mutation.MOD_WEIGHT)) {
      mutated = true;
      break;
    }
  }
  assert(mutated, "Expected creature to mutate");
  assertEquals(creature.semanticVersion, "4.1.2");
});
