import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Synapse } from "@architecture/Synapse.ts";
import { Mutator } from "@neat/Mutator.ts";
import { Mutation } from "@neat/Mutation.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";

Deno.test("Forward-only: mutated creatures remove legacy self/back connections", () => {
  // feedbackLoop is unset/false => forward-only mutation selection.
  const config = createNeatConfig({
    feedbackLoop: false,
    mutationRate: 1,
    mutationAmount: 1,
    mutation: [Mutation.MOD_WEIGHT],
    log: 0,
  });
  const mutator = new Mutator(config);

  const creature = new Creature(2, 2, { layers: [{ count: 2 }] });

  const hiddenIndex = creature.input;
  const beforeSelfCount =
    creature.synapses.filter((s) =>
      s.from === hiddenIndex && s.to === hiddenIndex
    ).length;
  assertEquals(beforeSelfCount, 0);

  // Inject a legacy self connection (as seen in older populations).
  creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.5));
  creature.synapses.sort((
    a,
    b,
  ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

  const legacySelfCount =
    creature.synapses.filter((s) =>
      s.from === hiddenIndex && s.to === hiddenIndex
    ).length;
  assertEquals(legacySelfCount, 1);

  // Mutating in forward-only mode should strip self/back connections on changed creatures.
  // (The original fittest creature remains unchanged until it is mutated/replaced.)
  mutator.mutate([creature]);

  const afterSelfCount =
    creature.synapses.filter((s) =>
      s.from === hiddenIndex && s.to === hiddenIndex
    ).length;
  assertEquals(afterSelfCount, 0);
});
