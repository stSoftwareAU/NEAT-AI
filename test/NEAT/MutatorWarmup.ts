import { assert } from "@std/assert";
import { Creature } from "@creature";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";
import {
  createSeededRng,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

/** Mutations excluded during seed warm-up (structural reduction / squash change). */
const WARMUP_BLOCKED = new Set([
  Mutation.SUB_NODE.name,
  Mutation.SUB_CONN.name,
  Mutation.MOD_SQUASH.name,
  Mutation.SWAP_NODES.name,
  Mutation.ADD_SELF_CONN.name,
  Mutation.SUB_SELF_CONN.name,
  Mutation.ADD_BACK_CONN.name,
  Mutation.SUB_BACK_CONN.name,
]);

Deno.test("MutatorWarmup: no gating when warm-up is disabled", () => {
  setRandomNumberGenerator(createSeededRng(42));
  const config = createNeatConfig({
    populationSize: 10,
    mutation: [Mutation.SUB_NODE],
  });
  const mutator = new Mutator(config);
  const creature = new Creature(3, 2, { layers: [{ count: 8 }] });

  const method = mutator.selectMutationMethod(creature);
  assert(method.name === Mutation.SUB_NODE.name);
});

Deno.test("MutatorWarmup: blocks structural/squash mutations during warm-up", () => {
  setRandomNumberGenerator(createSeededRng(99));
  const config = createNeatConfig({
    populationSize: 10,
    mutation: [
      ...Mutation.FFW,
      ...Mutation.ALL.filter((m) =>
        !Mutation.FFW.some((f) => f.name === m.name)
      ),
    ],
    feedbackLoop: true,
  });
  const mutator = new Mutator(config);
  mutator.setWarmupContext(10, 3);
  const creature = new Creature(3, 2, { layers: [{ count: 8 }] });

  for (let i = 0; i < 200; i++) {
    const method = mutator.selectMutationMethod(creature);
    assert(
      !WARMUP_BLOCKED.has(method.name),
      `warm-up must not select ${method.name}`,
    );
  }
});

Deno.test("MutatorWarmup: full mutation set after warm-up expires", () => {
  setRandomNumberGenerator(createSeededRng(7));
  const config = createNeatConfig({
    populationSize: 10,
    mutation: [Mutation.SUB_NODE],
  });
  const mutator = new Mutator(config);
  mutator.setWarmupContext(5, 6);
  const creature = new Creature(3, 2, { layers: [{ count: 8 }] });

  const method = mutator.selectMutationMethod(creature);
  assert(method.name === Mutation.SUB_NODE.name);
});
